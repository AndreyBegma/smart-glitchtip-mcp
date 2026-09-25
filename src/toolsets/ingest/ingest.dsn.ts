/** A DSN's public key, project id and host — never its secret (spec: "never echoed"). */
export interface ParsedDsn {
  readonly publicKey: string;
  readonly projectId: number;
  readonly host: string;
}

/**
 * Parses `scheme://<public>[:<secret>]@<host>[/<prefix>]/<projectID>` locally
 * (spec "Choosing the key"). The secret, if any, is read by the URL parser
 * and then discarded: it is never part of the return value, so nothing that
 * reads a `ParsedDsn` can echo it. Returns `undefined` for anything that does
 * not have this shape — the caller turns that into a validation error before
 * any request is made.
 */
export function parseDsn(dsn: string): ParsedDsn | undefined {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return undefined;
  }
  if (!url.username) return undefined;
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const last = segments.at(-1);
  if (!last || !/^\d+$/.test(last)) return undefined;
  const projectId = Number(last);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return undefined;
  return { publicKey: decodeURIComponent(url.username), projectId, host: url.host };
}
