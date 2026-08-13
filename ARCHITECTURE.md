# Architecture

## Structure

```
mobile/                 Expo (React Native + TypeScript) customer app, expo-router
admin/                  Next.js admin app — currently just the Menu Sync section
supabase/migrations/    SQL migrations, applied in order, single source of truth for the schema
services/menu-sync/     Automated menu ingestion pipeline (Node, standalone deployable)
```

Backend is Supabase end to end — Postgres + Auth + RLS + Realtime. No
separate API server for the customer/courier apps; `services/menu-sync` is
the one piece of backend logic that lives outside Postgres, because it
needs to make outbound HTTP calls (restaurant sites, Google Places, the
Claude API) that don't belong inside a database function.

Security model throughout: RLS denies by default, an `is_admin()` helper
(checks `profiles.role`) gates admin policies, and anything that would leak
margin (`pricing_settings`, `menu_items.base_price`, `orders.food_cost`/
`gross_margin`) is additionally locked down via column-level `REVOKE`/
`GRANT` or has no RLS policy granting client access at all — see comments
in the migrations for the specifics and reasoning per table.

## Menu sync

**Goal:** menus stay accurate with zero manual data entry after initial
setup, without ever risking a bad parse silently costing real margin.

### Sources

Allowed: Google Places API, a restaurant's own website (HTML or PDF menu),
and Toast/Square/Clover/ChowNow online-ordering pages (structured JSON
payloads or documented partner APIs).

Never: DoorDash/Uber Eats/Grubhub/Postmates/Yelp menu data, any source
whose ToS prohibits automated access, or any form of bot-detection evasion
(header spoofing, proxy rotation, CAPTCHA solving, browser fingerprint
masking). If a target site blocks automated access, that's logged and
surfaced for manual handling — never worked around.

**As verified 2026-08-13, before any adapter code was written** (rather
than assumed): `order.toasttab.com` sits behind a Cloudflare managed
challenge (403 + JS interstitial, even for `robots.txt`).
`clover.com/online-ordering` and `eat.chownow.com` both serve an empty
client-rendered SPA shell — no server-side menu data in the initial fetch,
it loads afterward via each platform's internal (undocumented) API once
their JS runs. `square.site` does embed server-side JSON
(`window.__BOOTSTRAP_STATE__`), but it's Square's own internal
site-builder state, not a documented menu format.

None of the four are plainly scrapable today without either (a) executing
their JS with a real browser to reach an undocumented internal endpoint —
which starts edging toward the fingerprinting/evasion this project
explicitly avoids — or (b) integrating each platform's actual OAuth
partner/developer API, which needs per-restaurant credential storage this
schema doesn't have yet (a real, separate decision, not made here).
`toast.ts`/`square.ts`/`clover.ts`/`chownow.ts` reflect this honestly:
each fetches, then throws a clear error naming what was verified and what
the real integration path would be, rather than faking a schema. In
practice `detect.ts` only routes those four exact hostnames to them, so
`generic.ts` (Claude vision, extracting from whatever HTML or PDF a
restaurant's own site actually has) is what runs for Point Loma Eats' real
target restaurants — small independent places, not enterprise POS ordering
pages.

### Pipeline

```
1. Places lookup           -> website URL, hours, phone, coords          (places.ts)
2. Fetch site               respects robots.txt, honest User-Agent,      (fetch.ts)
                             >=1 req/sec/domain, throws FetchBlockedError
                             on a bot-challenge response — never retried
                             past
3. Platform detection      -> toast | square | clover | chownow | generic (detect.ts)
4. Adapter                 -> AdapterResult (adapter-native shape)        (adapters/*.ts)
5. Normalize                validates + canonicalizes -> NormalizedMenu   (normalize.ts)
                             prices, drops unparseable items rather than
                             guessing, discounts run confidence by drop rate
6. Diff                    -> ProposedChange[] vs current menu_items      (diff.ts)
                             (price / availability / new / delete)
7. Apply                    auto_applied vs pending_review per rules      (apply.ts)
                             below; writes base_price only, never
                             display_price (that stays trigger-derived)
8. Log                     -> menu_sync_runs + menu_item_changes rows     (index.ts)
```

`index.ts` orchestrates this per restaurant and never throws — every
outcome (`success` / `partial` / `failed` / `blocked`) is recorded as a
`menu_sync_runs` row instead, so one restaurant's failure can't take down
the nightly batch. 3 consecutive `failed`/`blocked` runs for a restaurant
sets `sync_status = 'needs_attention'` and stops retrying it.

### Auto-apply rules

We display marked-up prices and are committed to them at checkout, so a
bad parse costs real margin:

| Change | Outcome |
|---|---|
| Price decrease (any size) | auto-applied |
| Price increase ≤ 5% | auto-applied |
| New item | auto-applied |
| Availability change | auto-applied |
| Price increase > 5% | queued for review |
| Item deletion | queued for review |
| Category restructuring | queues the entire run |
| Run confidence < 0.85 | queues the entire run |
| > 30% of items changed | queues the entire run |

The three run-level conditions override every individual change's own
rule — a parse that's mostly wrong can still contain individually
plausible-looking price decreases, so a low-confidence or high-churn run
gets queued wholesale rather than cherry-picked.

`manual_override = true` on a `menu_items` row means sync never touches
it, enforced at both the read layer (excluded from the diff entirely in
`index.ts`, so the rest of the pipeline never sees it) and the write layer
(`apply.ts` re-guards with `.eq('manual_override', false)` on every
update).

### Scheduling

Nightly via Supabase `pg_cron` + `pg_net` (`0005_menu_sync_cron.sql`),
POSTing to `services/menu-sync/http-server.ts`'s `/trigger` endpoint —
`pg_cron` only speaks SQL, it can't invoke a Node process directly.
Sequential, not parallel; skips `sync_enabled = false`. The service's
actual deployment target (where that HTTP endpoint lives) isn't decided
yet — the trigger URL is an unset placeholder until it is.

### Known gaps

Toast/Square/Clover/ChowNow adapters don't parse real data yet (see
above) — they need either a confirmed page structure or, more likely, an
OAuth partner API integration with per-restaurant credential storage,
which is a real architectural addition (encrypted secret storage, token
refresh) not built here. `generic.ts`'s Claude API cost per restaurant per
nightly run isn't sized or budgeted. Admin approve/reject currently
soft-deletes (`is_available = false`) rather than hard-deleting on an
approved `delete` change, so it's reversible — there's no hard-delete path
from the admin UI yet.
