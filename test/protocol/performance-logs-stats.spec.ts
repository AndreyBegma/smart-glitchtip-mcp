import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Review gate "registration" (acceptance 2): with GLITCHTIP_TOOLSETS=performance,logs,stats
// pinned, tools/list shows whoami plus all 11 read tools across the three toolsets,
// identical in read-only mode and with GLITCHTIP_READ_ONLY=false (no write tools exist).

const READ_TOOLS = [
  'get_transaction_group',
  'get_transaction_trend',
  'list_n_plus_one_patterns',
  'list_span_groups',
  'list_transaction_groups',
  'list_transaction_spans',
  'get_log',
  'get_log_stats',
  'list_log_resources',
  'list_logs',
  'get_organization_stats',
];

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function toolsWith(env: NodeJS.ProcessEnv) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'performance,logs,stats', ...env },
    new MockGlitchTip(),
  );
  const { tools } = await booted.client.listTools();
  return tools;
}

describe('tools/list with GLITCHTIP_TOOLSETS=performance,logs,stats (acceptance 2)', () => {
  it('read-only mode lists whoami plus exactly the 11 read tools', async () => {
    const tools = await toolsWith({ GLITCHTIP_READ_ONLY: 'true' });
    expect(tools.map((t) => t.name).sort()).toEqual(['whoami', ...READ_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });

  it('GLITCHTIP_READ_ONLY=false lists the identical set (no write tools exist)', async () => {
    const tools = await toolsWith({ GLITCHTIP_READ_ONLY: 'false' });
    expect(tools.map((t) => t.name).sort()).toEqual(['whoami', ...READ_TOOLS].sort());
  });
});
