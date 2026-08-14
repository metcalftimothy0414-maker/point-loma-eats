import { createServer } from 'node:http';
import { runNightlySync, syncOneRestaurant } from './index.ts';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const TRIGGER_SECRET = process.env.MENU_SYNC_TRIGGER_SECRET;

/**
 * Fails closed: an unset configuredSecret must deny every request, not
 * admit them. `configuredSecret && provided !== configuredSecret` looks
 * equivalent but isn't — when configuredSecret is falsy that whole
 * condition is simply false for every request, so forgetting to configure
 * MENU_SYNC_TRIGGER_SECRET would silently accept unauthenticated calls.
 * Exported for the test below; duplicated (not imported) from the same
 * check in supabase/functions/_shared/auth.ts since this is a separate
 * Node deployable, not sharing a module with the Deno functions.
 */
export function isAuthorized(configuredSecret: string | undefined, providedSecret: string | string[] | undefined): boolean {
  return Boolean(configuredSecret) && providedSecret === configuredSecret;
}

/**
 * Minimal HTTP wrapper so Supabase's pg_cron (via pg_net, see
 * ../supabase/migrations/0005_menu_sync_cron.sql) can trigger a sync run —
 * pg_cron only speaks SQL, it can't invoke this Node process directly.
 * Wherever this service actually runs (a small always-on process, a
 * container, etc.) is a deployment decision not made yet; this just gives
 * pg_net something to POST to once it is.
 *
 * Responds 202 immediately and runs the sync in the background rather than
 * holding the HTTP request open — a full nightly batch across several
 * restaurants, sequential by design, could easily outlast pg_net's request
 * timeout.
 */
const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }

  if (!isAuthorized(TRIGGER_SECRET, req.headers['x-trigger-secret'])) {
    res.writeHead(401).end();
    return;
  }

  if (req.url === '/trigger') {
    res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'started' }));
    runNightlySync().catch((err) => console.error('nightly sync failed', err));
    return;
  }

  const manualMatch = req.url?.match(/^\/trigger\/([^/]+)$/);
  if (manualMatch) {
    const restaurantId = manualMatch[1];
    res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'started', restaurantId }));
    syncOneRestaurant(restaurantId).catch((err) => console.error(`sync failed for ${restaurantId}`, err));
    return;
  }

  res.writeHead(404).end();
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, () => console.log(`menu-sync trigger listening on :${PORT}`));
}
