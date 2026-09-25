import { afterEach } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import type { MockGlitchTip } from '../../support/mock-glitchtip';

export const TOKEN = 'tok_SECRET_123';
export const API = `${GLITCHTIP}/api/0`;

/** Both flags: `api_request` is registered. */
export const WRITES = { GLITCHTIP_READ_ONLY: 'false', GLITCHTIP_API_REQUEST_ALLOW_WRITE: 'true' };

export interface Called {
  readonly text: string;
  readonly isError: boolean;
  readonly logs: string;
}

/**
 * A caller that boots the server (toolset `api_request` pinned, the token
 * above) for each call and closes it after the test.
 */
export function useApiServer() {
  let booted: Booted | undefined;
  afterEach(async () => {
    await booted?.close();
    booted = undefined;
  });
  return async function call(
    mock: MockGlitchTip,
    name: string,
    args: Record<string, unknown>,
    env: NodeJS.ProcessEnv = WRITES,
  ): Promise<Called> {
    await booted?.close();
    booted = await bootInMemory(
      { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'api_request', ...env },
      mock,
    );
    const result = await booted.client.callTool({ name, arguments: args });
    return { text: resultText(result), isError: result.isError === true, logs: booted.logs() };
  };
}

/** The text between the first fence's tags. */
export function fenced(text: string): string {
  const match =
    /<untrusted source="glitchtip-event" field="api\.body">([\s\S]*?)<\/untrusted>/.exec(text);
  if (!match) throw new Error(`no api.body fence in: ${text.slice(0, 200)}`);
  return match[1].replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}
