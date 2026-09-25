/**
 * Canonical form of a GlitchTip instance URL: origin plus an optional path
 * prefix, no trailing slash, no credentials, query or fragment. The allowlist
 * and the env URL are compared in this form only, so `https://g.example.com/`
 * and `https://G.example.com` are the same instance.
 *
 * Returns undefined for anything that is not a plain http(s) base URL.
 */
export function normalizeInstanceUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}
