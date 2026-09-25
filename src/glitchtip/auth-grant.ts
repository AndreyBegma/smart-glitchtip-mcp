/**
 * How an HTTP request authenticated (D-05):
 * - `server`: it presented MCP_AUTH_TOKEN and acts with the env GlitchTip token;
 * - `passthrough`: it presented its own GlitchTip token, which is forwarded.
 */
export type AuthGrant =
  | { readonly mode: 'server' }
  | { readonly mode: 'passthrough'; readonly token: string };

// Keyed by the request object and never attached to it, so the grant (and the
// token inside it) cannot surface through a request logger or serializer.
const grants = new WeakMap<object, AuthGrant>();

/** Recorded by the HTTP auth guard once it has let a request through. */
export function recordAuthGrant(request: object, grant: AuthGrant): void {
  grants.set(request, grant);
}

/** The grant recorded for this request, if the guard ran and let it through. */
export function authGrantOf(request: object): AuthGrant | undefined {
  return grants.get(request);
}
