/**
 * Fences text that came from an event payload (D-18). Anyone holding a DSN
 * can write it, so it is marked as data: the agent reading the result must
 * not follow instructions or URLs inside it. Every `<` inside is escaped so
 * the payload cannot close the fence or open a fence of its own.
 */
export function untrusted(field: string, text: string): string {
  const safeField = field.replace(/[^A-Za-z0-9_.-]/g, '');
  const body = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<untrusted source="glitchtip-event" field="${safeField}">${body}</untrusted>`;
}
