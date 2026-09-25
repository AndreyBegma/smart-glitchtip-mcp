import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/config';
import { TOOLSETS } from '../../src/mcp/toolset.registry';
import { DEFAULT_TOOLSETS, TOOLSET_NAMES } from '../../src/toolsets/toolset';
import { type Booted, bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Review gate "registration" (AGENTS.md rule 4): read-only and disabled
// toolsets are absent from tools/list, proven through the MCP protocol.

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

describe('tools/list (acceptance 2)', () => {
  it('lists exactly whoami and the three organization reads, with their annotations', async () => {
    const tools = await toolsWith({ GLITCHTIP_TOOLSETS: 'organizations' });
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_organization',
      'list_organization_environments',
      'list_organizations',
      'whoami',
    ]);
    for (const tool of tools) expect(tool.annotations).toMatchObject(READ);
  });

  it('gives every listed tool a description and an object input schema', async () => {
    const tools = await toolsWith({
      GLITCHTIP_TOOLSETS: 'organizations',
      GLITCHTIP_READ_ONLY: 'false',
    });
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toHaveProperty('format');
    }
  });
});

describe('read-only mode (acceptance 3)', () => {
  it('lists the three mutating tools only when GLITCHTIP_READ_ONLY=false', async () => {
    const tools = await toolsWith({
      GLITCHTIP_TOOLSETS: 'organizations',
      GLITCHTIP_READ_ONLY: 'false',
    });
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual([
      'create_organization',
      'delete_organization',
      'get_organization',
      'list_organization_environments',
      'list_organizations',
      'update_organization',
      'whoami',
    ]);
    expect(byName.get('create_organization')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(byName.get('update_organization')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(byName.get('delete_organization')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it('answers -32602 Unknown tool for delete_organization when read-only', async () => {
    const tools = await toolsWith({
      GLITCHTIP_TOOLSETS: 'organizations',
      GLITCHTIP_READ_ONLY: 'true',
    });
    expect(tools.map((t) => t.name)).not.toContain('delete_organization');
    await expect(
      booted?.client.callTool({
        name: 'delete_organization',
        arguments: { organization: 'acme', confirm: 'acme' },
      }),
    ).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('Unknown tool') });
  });
});

describe('read-only across every toolset', () => {
  // Guards future toolsets: whatever a later PR adds to its index.ts, a
  // read-only server with everything enabled lists read-only tools only.
  it('with GLITCHTIP_TOOLSETS=all and read-only, every listed tool is readOnlyHint: true', async () => {
    const tools = await toolsWith({ GLITCHTIP_TOOLSETS: 'all', GLITCHTIP_READ_ONLY: 'true' });
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).not.toBe(true);
    }
  });
});

describe('toolset selection (acceptance 4)', () => {
  it('starts with a not-yet-available toolset, lists only whoami, and warns', async () => {
    const pending = TOOLSETS.find((t) => !t.available);
    if (!pending) throw new Error('expected at least one toolset to still be pending');
    const tools = await toolsWith({
      GLITCHTIP_TOOLSETS: pending.name,
      GLITCHTIP_READ_ONLY: 'false',
    });
    expect(tools.map((t) => t.name)).toEqual(['whoami']);
    expect(booted?.logs()).toContain(`"toolset":"${pending.name}"`);
    expect(booted?.logs()).toContain('is enabled but not yet available.');
  });

  it('refuses startup for an unknown toolset, naming the valid ones', () => {
    let problems: readonly string[] = [];
    try {
      loadConfig({ GLITCHTIP_URL: 'https://g.test', GLITCHTIP_TOOLSETS: 'bogus' });
    } catch (error) {
      if (error instanceof ConfigError) problems = error.problems;
    }
    expect(problems).toHaveLength(1);
    for (const name of TOOLSET_NAMES) expect(problems[0]).toContain(name);
  });

  it('with the default toolsets, every available one contributes a tool and every pending one warns', async () => {
    const registryByName = new Map(TOOLSETS.map((t) => [t.name, t]));
    const toolsOf = new Map<string, readonly string[]>();
    for (const name of DEFAULT_TOOLSETS) {
      const solo = await bootInMemory(
        { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: name, GLITCHTIP_READ_ONLY: 'false' },
        new MockGlitchTip(),
      );
      const { tools: soloTools } = await solo.client.listTools();
      toolsOf.set(
        name,
        soloTools.map((t) => t.name).filter((n) => n !== 'whoami'),
      );
      await solo.close();
    }

    const tools = await toolsWith({});
    const names = new Set(tools.map((t) => t.name));
    const logs = booted?.logs() ?? '';
    const pendingWarning = 'is enabled but not yet available.';

    let anyPending = false;
    for (const name of DEFAULT_TOOLSETS) {
      if (registryByName.get(name)?.available) {
        const own = toolsOf.get(name) ?? [];
        expect(
          own.some((n) => names.has(n)),
          `${name} should contribute at least one tool`,
        ).toBe(true);
      } else {
        anyPending = true;
        expect(logs, name).toContain(`"toolset":"${name}"`);
        expect(logs, name).toContain(pendingWarning);
      }
    }
    if (!anyPending) expect(logs).not.toContain(pendingWarning);
  });
});
