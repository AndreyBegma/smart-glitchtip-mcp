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
  /** The URL without its fragment, or undefined when the response had no URL. */
  readonly url?: string;
  /** Every form of the key found, for the redactor. Never rendered. */
  readonly secrets: readonly string[];
}

export function parseSupportLink(body: unknown): SupportLink {
  const raw = isFields(body) ? body.url : undefined;
  if (typeof raw !== 'string') return { license: 'unknown', secrets: [] };
  const hash = raw.indexOf('#');
  if (hash < 0) return { license: 'not configured', url: raw, secrets: [] };
  const fragment = raw.slice(hash + 1);
  const key = new URLSearchParams(fragment).get('sub') ?? '';
  return {
    license: key === '' ? 'not configured' : 'configured',
    url: raw.slice(0, hash),
    secrets: [fragment, key, encodeURIComponent(key)].filter((s) => s !== ''),
  };
}
