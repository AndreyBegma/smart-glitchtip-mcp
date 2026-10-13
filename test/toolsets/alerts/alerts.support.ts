import { afterEach, expect } from 'vitest';
import alerts from '../../fixtures/alerts/alerts.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import type { MockGlitchTip, RecordedRequest } from '../../support/mock-glitchtip';

// Shared by every alerts test file. Acceptance 6 (last sentence): every boot
// made through `call` is checked on close — the captured log (stderr) never
// contains the Discord webhook secret, its path or the Zulip key.

export const API = `${GLITCHTIP}/api/0`;
export const TOKEN = 'tok_TEST';
export const ALERTS_URL = `${API}/projects/acme/web/alerts/`;
export const alertUrl = (id: number) => `${ALERTS_URL}${id}/`;

export const WEBHOOK_SECRET = 'WEBHOOK_SECRET_TOKEN';
export const WEBHOOK_URL = `https://discord.com/api/webhooks/1/${WEBHOOK_SECRET}`;
export const WEBHOOK_PATH = `/api/webhooks/1/${WEBHOOK_SECRET}`;
export const ZULIP_KEY = 'ZULIP_SECRET_KEY_0123456789';
export const SECRETS = [WEBHOOK_SECRET, WEBHOOK_PATH, ZULIP_KEY];

export interface FixtureRecipient {
  id: number;
  recipientType: string;
  url: string | null;
  config: Record<string, unknown> | null;
  tagsToAdd: string[] | null;
}
export interface Alert {
  id: number;
  name: string | null;
  timespanMinutes: number | null;
  quantity: number | null;
  uptime: boolean;
  alertRecipients: FixtureRecipient[];
}
/** Fresh copies, so a test may change a fixture without leaking into the next. */
export function fixtureAlerts(): Alert[] {
  return structuredClone(alerts) as Alert[];
}
export function alert7(): Alert {
  return fixtureAlerts()[0];
}

let booted: Booted | undefined;
afterEach(closeBoot);

/** Closes the current boot, if any, and checks what it logged. */
async function closeBoot(): Promise<void> {
  if (!booted) return;
  const logs = booted.logs();
  await booted.close();
  booted = undefined;
  for (const secret of SECRETS) expect(logs, 'captured log').not.toContain(secret);
}

/** What the current boot has logged so far (stderr). */
export function capturedLogs(): string {
  return booted?.logs() ?? '';
}

export interface CallResult {
  readonly text: string;
  readonly isError: boolean;
}

/** Boots with GLITCHTIP_TOOLSETS=alerts (writes enabled by default) and calls one tool. */
export async function call(
  mock: MockGlitchTip,
  name: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
): Promise<CallResult> {
  await closeBoot();
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'alerts', GLITCHTIP_READ_ONLY: 'false', ...env },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

export function bodyOf(request: RecordedRequest): unknown {
  return JSON.parse(request.body);
}

export function expectNoSecrets(text: string): void {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

/** The JSON inside a fenced `format: "json"` result. */
export function unfence(text: string): unknown {
  return JSON.parse(text.replace(/^<untrusted[^>]*>/, '').replace(/<\/untrusted>$/, ''));
}
