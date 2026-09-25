import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Review gate "registration" (acceptance 2): with GLITCHTIP_TOOLSETS=logs pinned, tools/list
// shows whoami plus exactly the 4 read tools, identical in read-only mode and with
// GLITCHTIP_READ_ONLY=false (no write tools exist). Every tool readOnly, idempotent, not
// destructive.

const READ_TOOLS = ['get_log', 'get_log_stats', 'list_log_resources', 'list_logs'];

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function toolsWith(env: NodeJS.ProcessEnv) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'logs', ...env },
    new MockGlitchTip(),
  );
  const { tools } = await booted.client.listTools();
  return tools;
}

describe('tools/list with GLITCHTIP_TOOLSETS=logs (acceptance 2)', () => {
  it('read-only mode lists whoami plus exactly the 4 read tools', async () => {
    const tools = await toolsWith({ GLITCHTIP_READ_ONLY: 'true' });
    expect(tools.map((t) => t.name).sort()).toEqual(['whoami', ...READ_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
  });

  it('GLITCHTIP_READ_ONLY=false lists the identical set (no write tools exist)', async () => {
    const tools = await toolsWith({ GLITCHTIP_READ_ONLY: 'false' });
    expect(tools.map((t) => t.name).sort()).toEqual(['whoami', ...READ_TOOLS].sort());
  });
});
