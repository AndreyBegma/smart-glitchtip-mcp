/** One page of a GlitchTip list and the cursor of the next, if there is one. */
export interface Page<T> {
  readonly items: T[];
  readonly nextCursor?: string;
  /** The list response's headers, for list headers other than `Link` (e.g. `X-Hits`). */
  readonly headers: Headers;
}

/**
 * Reads the next-page cursor from GlitchTip's Sentry-style `Link` header:
 * `<url>; rel="previous"; results="false"; cursor="…", <url>; rel="next"; results="true"; cursor="…"`.
 * A next page exists only when `rel="next"` carries `results="true"`.
 */
export function parseNextCursor(link: string | null | undefined): string | undefined {
  if (!link) return undefined;
  for (const part of splitLinks(link)) {
    const attrs = linkAttributes(part);
    if (attrs.rel === 'next' && attrs.results === 'true' && attrs.cursor) return attrs.cursor;
  }
  return undefined;
}

// Commas separate links but may also appear inside the <url>; split only on
// commas that are followed by the start of another link.
function splitLinks(header: string): string[] {
  return header.split(/,\s*(?=<)/);
}

function linkAttributes(link: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of link.matchAll(/;\s*([a-zA-Z]+)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}
