import { afterEach } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import type { MockGlitchTip } from '../../support/mock-glitchtip';

// Shared by the admin toolset's tests: URLs, the boot, and the JSON unfence.

export const API = `${GLITCHTIP}/api/0`;
export const TOKEN = 'tok_ADMIN_TEST_0123456789';

export const URLS = {
  user: `${API}/users/me/`,
  emails: `${API}/users/me/emails/`,
  notifications: `${API}/users/me/notifications/`,
  alerts: `${API}/users/me/notifications/alerts/`,
  license: `${API}/instance-license/`,
  supportLink: `${API}/instance-license/support-link/`,
  socialApps: `${API}/organizations/acme/social-apps/`,
  socialApp: (id: number) => `${API}/organizations/acme/social-apps/${id}/`,
} as const;

export const MALFORMED = (tool: string) =>
  new RegExp(`^GlitchTip returned a response this server did not expect for ${tool} \\(`);

let booted: Booted | undefined;

/** Registers the afterEach that closes the app booted by `call`. */
export function closeAfterEach(): void {
  afterEach(async () => {
    await booted?.close();
    booted = undefined;
  });
}

export async function call(
  mock: MockGlitchTip,
  name: string,
  args: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = {},
) {
  await booted?.close();
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'admin', GLITCHTIP_READ_ONLY: 'false', ...env },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { result, text: resultText(result), isError: result.isError === true, logs: booted.logs };
}

/** The JSON between a json result's fence tags, parsed; throws if it is not valid JSON. */
export function unfence(text: string): unknown {
  const inner = text.replace(/^<untrusted[^>]*>/, '').replace(/<\/untrusted>$/, '');
  return JSON.parse(inner.replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
}
