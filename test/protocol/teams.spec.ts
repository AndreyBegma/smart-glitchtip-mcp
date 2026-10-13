import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 1, 2: the teams toolset registers `available: true` with read and write classes,
// and read-only/write registration is pinned through the MCP protocol.

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function toolsWith(env: NodeJS.ProcessEnv) {
  booted = await bootInMemory({ GLITCHTIP_TOKEN: 'tok', ...env }, new MockGlitchTip());
  const { tools } = await booted.client.listTools();
  return tools;
}

describe('teams toolset registration', () => {
  it('lists exactly whoami and the two teams reads, with read-only annotations', async () => {
    const tools = await toolsWith({ GLITCHTIP_TOOLSETS: 'teams' });
    expect(tools.map((t) => t.name).sort()).toEqual(['get_team', 'list_teams', 'whoami']);
    for (const tool of tools) expect(tool.annotations).toMatchObject(READ);
  });

  it('lists whoami plus 7 tools when writes are enabled', async () => {
    const tools = await toolsWith({ GLITCHTIP_TOOLSETS: 'teams', GLITCHTIP_READ_ONLY: 'false' });
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_member_to_team',
      'create_team',
      'delete_team',
      'get_team',
      'list_teams',
      'remove_member_from_team',
      'rename_team',
      'whoami',
    ]);
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('create_team')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(byName.get('rename_team')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(byName.get('delete_team')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(byName.get('add_member_to_team')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(byName.get('remove_member_from_team')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it('answers -32602 Unknown tool for delete_team when read-only', async () => {
    const tools = await toolsWith({ GLITCHTIP_TOOLSETS: 'teams', GLITCHTIP_READ_ONLY: 'true' });
    expect(tools.map((t) => t.name)).not.toContain('delete_team');
    await expect(
      booted?.client.callTool({
        name: 'delete_team',
        arguments: { organization: 'acme', team: 'core', confirm: 'core' },
      }),
    ).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('Unknown tool') });
  });
});
