// Recipient secrets (spec "Recipient secrets"): a webhook URL is a credential
// and a Zulip recipient's `config.api_key` is one outright. Masking keeps them
// out of rendered output; this module removes them from the two places text
// can carry them back unmasked — GlitchTip error details and the messages of
// a test delivery.

/** The exact strings to remove, longest first. Built by `secretsFrom`. */
export type Secrets = readonly string[];

/** What replaces each occurrence. */
export const REDACTED = '[redacted]';

/** Keys and bare values shorter than this are too common to scrub. */
const MIN_BARE_LENGTH = 8;
/** A last path segment shorter than this is too common to scrub on its own. */
const MIN_SEGMENT_LENGTH = 8;
/** The shortest cut-off start of a secret that is still redacted at the end of a text. */
const MIN_TRAILING_PREFIX = 6;
/** What GlitchTip's error mapping appends where it cut a long detail. */
const TRUNCATION_MARK = '…';

/**
 * The scrub list for recipient URLs and Zulip keys. Every URL contributes
 * each way a message may quote it: the full value, path + query, path and
 * host + path (requests-style messages quote them apart:
 * `HTTPSConnectionPool(host='discord.com', …) … with url: /api/webhooks/1/SECRET`),
 * their percent-decoded forms, the path as written in the stored string, the
 * last path segment, and the JSON-escaped form of each. URL-derived forms are
 * kept whatever their length — an ntfy topic `/s3cr3t` is the credential —
 * except a bare `/`. Values that are not strings are ignored, so a malformed
 * GlitchTip payload can be passed as it is.
 */
export function secretsFrom(urls: readonly unknown[], keys: readonly unknown[]): Secrets {
  const forms = new Set<string>();
  for (const url of urls) {
    if (typeof url !== 'string' || url === '') continue;
    for (const form of withJsonEscapes(urlForms(url))) forms.add(form);
  }
  for (const key of keys) {
    if (typeof key !== 'string' || key.length < MIN_BARE_LENGTH) continue;
    for (const form of withJsonEscapes([key])) forms.add(form);
  }
  return sortLongestFirst(forms);
}

/** Two scrub lists as one, still longest first. */
export function mergeSecrets(a: Secrets, b: Secrets): Secrets {
  return sortLongestFirst(new Set([...a, ...b]));
}

/**
 * Replaces every occurrence of every secret with `[redacted]`, longest
 * first — and a secret cut off at the end of the text, where GlitchTip's
 * error mapping truncates a long detail (`…`): any trailing start of a secret
 * of at least 6 characters is redacted too.
 */
export function scrub(text: string, secrets: Secrets): string {
  let result = text;
  for (const secret of secrets) result = result.split(secret).join(REDACTED);
  return scrubTrailingPrefix(result, secrets);
}

function scrubTrailingPrefix(text: string, secrets: Secrets): string {
  const truncated = text.endsWith(TRUNCATION_MARK);
  const body = truncated ? text.slice(0, -TRUNCATION_MARK.length) : text;
  const mark = truncated ? TRUNCATION_MARK : '';
  let longest = 0;
  for (const secret of secrets) {
    for (let length = Math.min(secret.length - 1, body.length); length > longest; length--) {
      if (length < MIN_TRAILING_PREFIX) break;
      if (body.endsWith(secret.slice(0, length))) {
        longest = length;
        break;
      }
    }
  }
  return longest === 0 ? text : `${body.slice(0, -longest)}${REDACTED}${mark}`;
}

function urlForms(url: string): string[] {
  const forms = [url];
  if (!URL.canParse(url)) return url.length >= MIN_BARE_LENGTH ? forms : [];
  const parsed = new URL(url);
  const { host, pathname, search } = parsed;
  forms.push(parsed.href);
  if (search) forms.push(`${pathname}${search}`, decoded(`${pathname}${search}`));
  if (pathname !== '/' && pathname !== '') {
    const rawPath = rawPathOf(url);
    forms.push(
      pathname,
      decoded(pathname),
      `${pathname}${search}`,
      `${host}${pathname}`,
      `${host}${pathname}${search}`,
      rawPath,
      rawPath.split(/[?#]/)[0],
    );
    const lastSegment = pathname.split('/').filter(Boolean).pop() ?? '';
    if (lastSegment.length >= MIN_SEGMENT_LENGTH) forms.push(lastSegment, decoded(lastSegment));
  }
  return forms.filter((form) => form !== '' && form !== '/');
}

/** The path, query and fragment exactly as written in the stored URL string. */
function rawPathOf(url: string): string {
  const afterScheme = url.indexOf('//');
  const start = url.indexOf('/', afterScheme < 0 ? 0 : afterScheme + 2);
  return start < 0 ? '' : url.slice(start);
}

function decoded(form: string): string {
  try {
    return decodeURIComponent(form);
  } catch {
    return form;
  }
}

/** Each form plus the way it reads inside a JSON string (`JSON.stringify` escapes). */
function withJsonEscapes(forms: readonly string[]): string[] {
  return forms.flatMap((form) => [form, JSON.stringify(form).slice(1, -1)]);
}

function sortLongestFirst(forms: Iterable<string>): Secrets {
  return [...new Set(forms)].sort((a, b) => b.length - a.length);
}
