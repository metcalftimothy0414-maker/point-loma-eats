# admin

Founder-only internal admin app.

| Section | What it does |
|---|---|
| Dashboard | Today's orders/revenue/avg order value/avg tip/cancellations, avg delivery time, orders & revenue per hour (today), repeat-customer rate. |
| Analytics | Same shape as Dashboard but over a selectable date range: most popular restaurants/delivery points, peak ordering hour (in the installation's actual timezone), gross + contribution margin (nets out real Stripe processing fees), total/new users. No vehicle-cost or CAC figures — nothing here tracks either, so it says that plainly instead of estimating. |
| Orders | List (filterable by status), detail with items/status history/admin-only food_cost/gross_margin, set any status directly, issue a refund. |
| Restaurants | CRUD, plus nested menu category/item management (base_price only — display_price stays trigger-derived). |
| Customers | List with lifetime order stats, detail with full order + support ticket history. |
| Installations | Installation + delivery zone + delivery point CRUD, all inline on one page. |
| Pricing | Current effective rate + history, form to version in a new rate (never edits in place — see `lib/pricing-actions.ts`). |
| Payments | Read-only list, for reconciliation. |
| Refunds | Queue of orders awaiting refund + recently refunded, with the actual "issue refund" action (calls Stripe via `refund-payment`). |
| Support | Log/resolve tickets. No customer self-service intake yet — tickets are logged here after a customer calls/texts. |
| Menu Sync | Review the automated sync pipeline's proposed changes, approve/reject/bulk-approve, trigger a manual sync, run history. |

**Deliberately not built:** Incidents and Settings — the brief lists both in
its table of sections but never defines what either would actually contain
beyond what Support and env vars already cover; building placeholder pages
with nothing real in them seemed worse than leaving them out and saying so.

## Auth

HTTP Basic Auth (`proxy.ts`), single shared founder credential — not real
per-user auth. See `lib/supabase-admin.ts` for why: this app has exactly one
real user, and it uses the Supabase service role key server-side (bypasses
RLS entirely) rather than session-based auth built for multiple admins.
Revisit both if that ever changes. One concrete consequence: support ticket
resolutions have no `resolved_by` — there's no per-admin identity to
attribute it to.

## Local dev

```
cp .env.example .env.local
npm install
npm run dev
```

Requires the Supabase migrations through `0010_analytics.sql` to be applied
for these pages to show real data. `REFUND_PAYMENT_URL`/
`MENU_SYNC_TRIGGER_URL` are unset by default (nothing's deployed yet) —
those specific actions fail with a clear error rather than doing nothing
silently; everything else works without them.
