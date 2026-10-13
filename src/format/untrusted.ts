import { neutralise } from './sanitize';

/**
 * Where fenced text came from (D-18). When one value mixes origins, the most
 * exposed wins: glitchtip-event over external over glitchtip-user over
 * glitchtip-config.
 *
 * - `glitchtip-event`: anything that can arrive through a DSN — written by
 *   whoever holds a public key (titles, frames, tags, release versions…).
 * - `glitchtip-user`: what an account holder writes as themself (names,
 *   e-mails, comments).
 * - `glitchtip-config`: configuration a member or CI job sets (monitor URLs,
 *   release refs, commits, repositories…).
 * - `external`: text a third party produced and GlitchTip relays.
 */
export const UNTRUSTED_SOURCES = [
  'glitchtip-event',
  'glitchtip-user',
  'glitchtip-config',
  'external',
] as const;
export type UntrustedSource = (typeof UNTRUSTED_SOURCES)[number];

/** Exactly the opening tag `untrusted()` writes, and nothing else that looks like it. */
export const UNTRUSTED_OPEN_TAG = new RegExp(
  `<untrusted source="(?:${UNTRUSTED_SOURCES.join('|')})" field="[A-Za-z0-9_.-]*">`,
  'g',
);
export const UNTRUSTED_CLOSE_TAG = '</untrusted>';

/**
 * Fences text that came from GlitchTip (D-18). It is marked as data: the
 * agent reading the result must not follow instructions or URLs inside it.
 * Control and invisible characters are neutralised first (BUG-20260925-016)
 * so they cannot hide or reorder the fenced text; every `<` inside is
 * escaped so the payload cannot close the fence or open a fence of its own.
 */
export function untrusted(
  field: string,
  text: string,
  source: UntrustedSource = 'glitchtip-event',
): string {
  return fence(field, neutralise(text, { keepNewlines: true }), source);
}

/**
 * Fences a JSON payload (D-18), for `ToolOutput`'s json path. Like
 * `untrusted()`, but a run of line/paragraph separators always becomes a
 * space, never a raw newline: `JSON.stringify` may leave U+2028/U+2029
 * unescaped inside a string value, and turning one into `\n` there would
 * leave an unescaped control character inside a JSON string, which RFC 8259
 * does not allow. The JSON's own pretty-printed newlines are untouched
 * either way.
 */
export function untrustedJson(
  field: string,
  json: string,
  source: UntrustedSource = 'glitchtip-event',
): string {
  return fence(
    field,
    neutralise(json, { keepNewlines: true, separatorsBecomeNewlines: false }),
    source,
  );
}

function fence(field: string, body: string, source: UntrustedSource): string {
  const safeField = field.replace(/[^A-Za-z0-9_.-]/g, '');
  const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<untrusted source="${source}" field="${safeField}">${escaped}${UNTRUSTED_CLOSE_TAG}`;
}
