import { describe, expect, it } from 'vitest';
import { RELEASE_HEALTH_TOOLS } from '../../src/prompts/release-health-report.prompt';
import { TRIAGE_ISSUE_TOOLS } from '../../src/prompts/triage-issue.prompt';
import { bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// D-27, acceptance 6 and 7. Tool coverage: every tool name a prompt's text
// can mention is in that prompt's exported list, and every tool in that list
// is a real, registered tool when exactly its `requires` toolsets are
// enabled. No mutating tool: none of a prompt's text mentions a tool whose
// `readOnlyHint` is `false`.

interface GetPromptResult {
  readonly messages: readonly { content: { text: string } }[];
}

async function textOf(name: string, args: Record<string, unknown>): Promise<string> {
  const server = await bootInMemory(
    { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'all', GLITCHTIP_READ_ONLY: 'false' },
    new MockGlitchTip(),
  );
  try {
    const result = (await server.client.request({
      method: 'prompts/get',
      params: { name, arguments: args },
    })) as GetPromptResult;
    return result.messages[0].content.text;
  } finally {
    await server.close();
  }
}

function wordsOf(text: string): string[] {
  return text.match(/[a-z0-9_]+/g) ?? [];
}

describe('tool coverage (acceptance 6)', () => {
  it('every word in triage-issue matching a real tool name is in TRIAGE_ISSUE_TOOLS', async () => {
    const text = await textOf('triage-issue', { issue_id: '42', organization: 'acme' });
    const server = await bootInMemory(
      {
        GLITCHTIP_TOKEN: 'tok',
        GLITCHTIP_TOOLSETS: 'all',
        GLITCHTIP_READ_ONLY: 'false',
        GLITCHTIP_API_REQUEST_ALLOW_WRITE: 'true',
      },
      new MockGlitchTip(),
    );
    const toolNames = new Set((await server.client.listTools()).tools.map((t) => t.name));
    await server.close();
    for (const word of new Set(wordsOf(text))) {
      if (toolNames.has(word)) expect(TRIAGE_ISSUE_TOOLS, word).toContain(word);
    }
  });

  it('every word in release-health-report matching a real tool name is in RELEASE_HEALTH_TOOLS', async () => {
    const text = await textOf('release-health-report', { version: '1.0.0', organization: 'acme' });
    const server = await bootInMemory(
      {
        GLITCHTIP_TOKEN: 'tok',
        GLITCHTIP_TOOLSETS: 'all',
        GLITCHTIP_READ_ONLY: 'false',
        GLITCHTIP_API_REQUEST_ALLOW_WRITE: 'true',
      },
      new MockGlitchTip(),
    );
    const toolNames = new Set((await server.client.listTools()).tools.map((t) => t.name));
    await server.close();
    for (const word of new Set(wordsOf(text))) {
      if (toolNames.has(word)) expect(RELEASE_HEALTH_TOOLS, word).toContain(word);
    }
  });

  it('every tool triage-issue names is registered with exactly its requires toolsets (plus whoami)', async () => {
    const server = await bootInMemory(
      { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'issues,events' },
      new MockGlitchTip(),
    );
    const toolNames = new Set((await server.client.listTools()).tools.map((t) => t.name));
    await server.close();
    for (const name of TRIAGE_ISSUE_TOOLS) expect(toolNames, name).toContain(name);
  });

  it('every tool release-health-report names is registered with exactly its requires toolsets (plus whoami)', async () => {
    const server = await bootInMemory(
      { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'releases,issues' },
      new MockGlitchTip(),
    );
    const toolNames = new Set((await server.client.listTools()).tools.map((t) => t.name));
    await server.close();
    for (const name of RELEASE_HEALTH_TOOLS) expect(toolNames, name).toContain(name);
  });
});

describe('no mutating tool in either prompt (acceptance 7)', () => {
  it('names no tool with readOnlyHint: false', async () => {
    const server = await bootInMemory(
      {
        GLITCHTIP_TOKEN: 'tok',
        GLITCHTIP_TOOLSETS: 'all',
        GLITCHTIP_READ_ONLY: 'false',
        GLITCHTIP_API_REQUEST_ALLOW_WRITE: 'true',
      },
      new MockGlitchTip(),
    );
    const mutating = (await server.client.listTools()).tools
      .filter((t) => t.annotations?.readOnlyHint === false)
      .map((t) => t.name);
    await server.close();
    expect(mutating.length).toBeGreaterThan(0);

    const triage = await textOf('triage-issue', { issue_id: '42' });
    const release = await textOf('release-health-report', { version: '1.0.0' });
    for (const name of mutating) {
      expect(wordsOf(triage), name).not.toContain(name);
      expect(wordsOf(release), name).not.toContain(name);
    }
  });
});
