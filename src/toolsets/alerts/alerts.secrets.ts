// Recipient secrets (spec "Recipient secrets"): a webhook URL is a credential
// and a Zulip recipient's `config.api_key` is one outright. Masking keeps them
// out of rendered output; this module removes them from the two places text
// can carry them back unmasked — GlitchTip error details and the messages of
// a test delivery.

/** The exact strings to remove, longest first. Built by `secretsFrom`. */
export type Secrets = readonly string[];

/** What replaces each occurrence. */
export const REDACTED = '[redacted]';

/** Forms shorter than this (a bare `/`) are too common to scrub. */
const MIN_SECRET_LENGTH = 8;

/**
 * The scrub list for recipient URLs and Zulip keys. For every URL: its full
 * value, its path + query, its path, and its host + path — requests-style
 * messages quote them apart (`HTTPSConnectionPool(host='discord.com', …)
 * … with url: /api/webhooks/1/SECRET`). Values that are not strings are
 * ignored, so a malformed GlitchTip payload can be passed as it is.
 */
export function secretsFrom(urls: readonly unknown[], keys: readonly unknown[]): Secrets {
  const forms = new Set<string>();
  for (const url of urls) {
    if (typeof url !== 'string') continue;
    for (const form of urlForms(url)) forms.add(form);
  }
  for (const key of keys) {
    if (typeof key === 'string') forms.add(key);
  }
  return [...forms]
    .filter((form) => form.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
}

/** Two scrub lists as one, still longest first. */
export function mergeSecrets(a: Secrets, b: Secrets): Secrets {
  return [...new Set([...a, ...b])].sort((x, y) => y.length - x.length);
}

/** Replaces every occurrence of every secret with `[redacted]`, longest first. */
export function scrub(text: string, secrets: Secrets): string {
  let result = text;
  for (const secret of secrets) result = result.split(secret).join(REDACTED);
  return result;
}

function urlForms(url: string): string[] {
  if (!URL.canParse(url)) return [url];
  const parsed = new URL(url);
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  return [
    url,
    parsed.href,
    pathAndQuery,
    parsed.pathname,
    `${parsed.host}${parsed.pathname}`,
    `${parsed.host}${pathAndQuery}`,
  ];
}
