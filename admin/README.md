# admin

Founder-only internal admin app. Currently just the Menu Sync section —
review the sync pipeline in `services/menu-sync/` produces (pending price/
availability/new/delete changes), approve/reject/bulk-approve, trigger a
manual sync per restaurant, and see run history.

Not built: the rest of the Phase 7 admin dashboard from the project brief
(Orders, Customers, Pricing, Analytics, Payments, Refunds, Support,
Incidents, Settings) — those land when their own phase does, not
speculatively alongside this.

## Auth

HTTP Basic Auth (`proxy.ts`), single shared founder credential — not real
per-user auth. See `lib/supabase-admin.ts` for why: this app has exactly one
real user, and it uses the Supabase service role key server-side (bypasses
RLS entirely) rather than session-based auth built for multiple admins.
Revisit both if that ever changes.

## Local dev

```
cp .env.example .env.local
npm install
npm run dev
```

Requires the Supabase migrations through `0004_menu_sync.sql` to be applied
for the Menu Sync page to show real data.
