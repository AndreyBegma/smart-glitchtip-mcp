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
 * Every `<` inside is escaped so the payload cannot close the fence or open
 * a fence of its own.
 */
export function untrusted(
  field: string,
  text: string,
  source: UntrustedSource = 'glitchtip-event',
): string {
  const safeField = field.replace(/[^A-Za-z0-9_.-]/g, '');
  const body = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<untrusted source="${source}" field="${safeField}">${body}${UNTRUSTED_CLOSE_TAG}`;
}
