import { isFields } from './admin.values';

/**
 * GlitchTip's support link, split so the license key never leaves the
 * server: GlitchTip appends the key as the fragment `#sub=<key>` [Confirmed:
 * `get_support_link` in glitchtip/api/api.py]. The key is a credential for
 * the vendor's support portal (spec "get_instance_license").
 */
export interface SupportLink {
  /** `configured` iff the fragment carries a non-empty `sub=`; `unknown` if unreadable. */
  readonly license: 'configured' | 'not configured' | 'unknown';
  /**
   * Origin and path only — no query, no fragment — so no form of the key can
   * ride along. Undefined when the response had no URL, or one that does not parse.
   */
  readonly url?: string;
  /** Every form of the key found, for the redactor. Never rendered. */
  readonly secrets: readonly string[];
}

export function parseSupportLink(body: unknown): SupportLink {
  const raw = isFields(body) ? body.url : undefined;
  if (typeof raw !== 'string') return { license: 'unknown', secrets: [] };
  const hash = raw.indexOf('#');
  const fragment = hash < 0 ? '' : raw.slice(hash + 1);
  const beforeHash = hash < 0 ? raw : raw.slice(0, hash);
  const query = beforeHash.includes('?') ? beforeHash.slice(beforeHash.indexOf('?') + 1) : '';
  const fragmentKey = subValue(fragment);
  return {
    license: fragmentKey === undefined ? 'not configured' : 'configured',
    url: originAndPath(raw),
    secrets: [
      ...(fragment === '' ? [] : [fragment]),
      ...keyForms(fragmentKey),
      ...keyForms(subValue(query)),
    ],
  };
}

/** The `sub=` value exactly as written in a `&`-separated list, or undefined when empty. */
function subValue(params: string): string | undefined {
  const pair = params.split('&').find((part) => part.startsWith('sub='));
  const value = pair?.slice('sub='.length);
  return value === undefined || value === '' ? undefined : value;
}

/**
 * The key as written, decoded (form-style: `+` is a space) and re-encoded,
 * each bare and `sub=`-prefixed. The prefixed forms are at least as long as
 * the redactor's minimum for any key of four characters or more; a shorter
 * bare form is scrubbed by the admin render itself (`renderRedacted`).
 */
function keyForms(written: string | undefined): string[] {
  if (written === undefined) return [];
  const decoded = decode(written);
  const forms = new Set([written, decoded, encodeURIComponent(decoded)]);
  return [...forms].flatMap((form) => [form, `sub=${form}`]);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function originAndPath(raw: string): string | undefined {
  if (!URL.canParse(raw)) return undefined;
  const url = new URL(raw);
  return `${url.origin}${url.pathname}`;
}
