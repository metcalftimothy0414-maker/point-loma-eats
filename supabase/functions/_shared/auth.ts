/**
 * Shared-secret check for the internal-only Edge Functions (called by a
 * Postgres trigger via pg_net, or by admin/'s server actions — never
 * directly by a customer/courier client, so a shared secret is enough;
 * no user-facing signature scheme like Stripe's is needed here).
 *
 * Fails closed: an unset `configuredSecret` must deny every request, not
 * admit them. `configuredSecret && provided !== configuredSecret` looks
 * equivalent but isn't — when `configuredSecret` is falsy that whole
 * condition is simply false for every request, so a function that forgot
 * to have its secret configured would silently accept unauthenticated
 * calls. That was a real bug here (fixed), not a hypothetical one.
 */
export function isAuthorized(configuredSecret: string | undefined, providedSecret: string | null): boolean {
  return Boolean(configuredSecret) && providedSecret === configuredSecret;
}
