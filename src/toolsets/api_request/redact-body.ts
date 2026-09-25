import { REDACTED, type Redactor } from '../../glitchtip/redactor';

// Redaction of every escape-hatch response body (FEAT-20260925-015
// "Redaction", AGENTS.md rule 1). It runs before a body is fenced, budgeted or
// returned, so a cut can never split a secret into pieces that escape it.

/** Keys whose values are secrets, compared case-insensitively. */
const SECRET_KEYS = new Set(
  [
    'token',
    'authToken',
    'clientSecret',
    'client_secret',
    'secret',
    'apiKey',
    'api_key',
    'password',
    'sentry_key',
    'privateKey',
    'inviteLink',
    'chatwootIdentifierHash',
    'heartbeatEndpoint',
  ].map((key) => key.toLowerCase()),
);

/** Deeper than this, a subtree is replaced whole: no stack is spent on a hostile body. */
const MAX_DEPTH = 100;
const TOO_DEEP = '[redacted: nested too deep]';
const FRAGMENT = '#[redacted]';
const UNPARSABLE = 'unparsable URL (masked)';

/** Who resolves the token-and-extras redactor, once the extras are known. */
export type RedactorFor = (extraSecrets: readonly string[]) => Redactor;

/**
 * A parsed JSON body with every rule applied: secret keys at any depth, URL
 * fragments and passwords, alert recipient URLs by shape — and then every
 * value those rules caught, plus the token, removed wherever else it appears.
 */
export function redactJson(value: unknown, redactorFor: RedactorFor): unknown {
  const secrets: string[] = [];
  const shaped = byShape(value, secrets, 0);
  return byValue(shaped, redactorFor(secrets));
}

/**
 * A text body (`text/*`, or JSON that did not parse): the token and secrets
 * removed by value, `"secretKey": "…"` pairs blanked, and every http(s) URL
 * stripped of its fragment and password.
 */
export function redactText(text: string, redactor: Redactor): string {
  return redactor
    .redact(text)
    .replace(SECRET_PAIR, (_, key: string) => `"${key}": "${REDACTED}"`)
    .replace(URL_IN_TEXT, (url) => cleanUrl(url, []));
}

const SECRET_PAIR = new RegExp(
  `"(${[...SECRET_KEYS].join('|')})"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`,
  'gi',
);
const URL_IN_TEXT = /https?:\/\/[^\s"'<>\\]+/g;

function byShape(value: unknown, secrets: string[], depth: number): unknown {
  if (typeof value === 'string') return cleanUrl(value, secrets);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) {
    collectStrings(value, secrets);
    return TOO_DEEP;
  }
  if (Array.isArray(value)) return value.map((item) => byShape(item, secrets, depth + 1));
  const record = value as Record<string, unknown>;
  const recipient = 'recipientType' in record && typeof record.url === 'string';
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      result[key] = secretReplacement(item, secrets);
    } else if (recipient && key === 'url') {
      secrets.push(item as string);
      result[key] = maskUrl(item as string);
    } else {
      result[key] = byShape(item, secrets, depth + 1);
    }
  }
  return result;
}

/** A secret key's value: absent stays absent (null), anything else is replaced. */
function secretReplacement(value: unknown, secrets: string[]): unknown {
  if (value === null) return null;
  collectStrings(value, secrets);
  return REDACTED;
}

/** Every string inside a value, iteratively (the value may be arbitrarily deep). */
function collectStrings(value: unknown, secrets: string[]): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === 'string') secrets.push(next);
    else if (next !== null && typeof next === 'object') {
      for (const item of Object.values(next)) stack.push(item);
    }
  }
}

function byValue(value: unknown, redactor: Redactor): unknown {
  if (typeof value === 'string') return redactor.redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => byValue(item, redactor));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [redactor.redact(key), byValue(item, redactor)]),
  );
}

/**
 * A string that is a URL loses its fragment (client-side secrets such as a
 * license key, `#sub=…`) and its password; both are recorded as secrets.
 */
function cleanUrl(text: string, secrets: string[]): string {
  if (!URL.canParse(text)) return text;
  let result = text;
  const hash = result.indexOf('#');
  if (hash !== -1 && hash < result.length - 1) {
    secrets.push(result.slice(hash + 1));
    result = `${result.slice(0, hash)}${FRAGMENT}`;
  }
  const password = new URL(text).password;
  if (password) {
    secrets.push(password, safeDecode(password));
    result = result.replace(USERINFO_PASSWORD, `$1:${REDACTED}@`);
  }
  return result;
}

const USERINFO_PASSWORD = /^([a-z][a-z0-9+.-]*:\/\/[^/?#:@]*):[^/?#@]*@/i;

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * An alert recipient's URL as FEAT-20260925-009 shows it: the origin, plus
 * `/…` when it has more. A webhook URL is a credential.
 */
function maskUrl(url: string): string {
  if (!URL.canParse(url)) return UNPARSABLE;
  const parsed = new URL(url);
  if (parsed.origin === 'null') return UNPARSABLE;
  const hasMore =
    (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash;
  return hasMore ? `${parsed.origin}/…` : parsed.origin;
}
