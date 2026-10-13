import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Review gate "registration" (this item's roadmap row): with GLITCHTIP_TOOLSETS=issues pinned,
// read-only mode lists exactly whoami plus the 8 read tools; GLITCHTIP_READ_ONLY=false adds the
// 10 write tools (acceptance 2).

const READ_TOOLS = [
  'get_issue',
  'get_issues_stats',
  'list_issue_comments',
  'list_issue_commits',
  'list_issue_hashes',
  'list_issue_tags',
  'list_issue_user_reports',
  'list_issues',
];

const WRITE_TOOLS = [
  'add_issue_comment',
  'assign_issue',
  'bulk_delete_issues',
  'bulk_update_issues',
  'delete_issue',
  'delete_issue_comment',
  'merge_issues',
  'unmerge_issue_hashes',
  'update_issue_comment',
  'update_issue_status',
];

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function toolsWith(env: NodeJS.ProcessEnv) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'issues', ...env },
    new MockGlitchTip(),
  );
  const { tools } = await booted.client.listTools();
  return tools;
}

describe('tools/list with GLITCHTIP_TOOLSETS=issues (acceptance 2)', () => {
  it('read-only mode lists whoami plus exactly the 8 read tools', async () => {
    const tools = await toolsWith({ GLITCHTIP_READ_ONLY: 'true' });
    expect(tools.map((t) => t.name).sort()).toEqual(['whoami', ...READ_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it('GLITCHTIP_READ_ONLY=false lists whoami plus all 18 tools', async () => {
    const tools = await toolsWith({ GLITCHTIP_READ_ONLY: 'false' });
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['whoami', ...READ_TOOLS, ...WRITE_TOOLS].sort(),
    );
  });

  it('destructive write tools carry destructiveHint: true', async () => {
    const tools = await toolsWith({ GLITCHTIP_READ_ONLY: 'false' });
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of [
      'delete_issue',
      'bulk_delete_issues',
      'merge_issues',
      'delete_issue_comment',
    ]) {
      expect(byName.get(name)?.annotations, name).toMatchObject({ destructiveHint: true });
    }
    for (const name of READ_TOOLS) {
      expect(byName.get(name)?.annotations, name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
  });

  it('a write tool answers -32602 Unknown tool when read-only', async () => {
    await toolsWith({ GLITCHTIP_READ_ONLY: 'true' });
    await expect(
      booted?.client.callTool({
        name: 'delete_issue',
        arguments: { issue_id: 1, confirm: '1' },
      }),
    ).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('Unknown tool') });
  });
});
