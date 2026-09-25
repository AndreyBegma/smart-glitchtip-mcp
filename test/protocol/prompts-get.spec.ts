import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// D-27, acceptance 3 and 4: `prompts/get` renders one user-role text message,
// with every argument entering it only as a JSON literal through the shared
// `json()` helper — nothing else from an argument reaches the text raw.

interface GetPromptResult {
  readonly description?: string;
  readonly messages: readonly { role: string; content: { type: string; text: string } }[];
}

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function bootWith(env: NodeJS.ProcessEnv) {
  booted = await bootInMemory({ GLITCHTIP_TOKEN: 'tok', ...env }, new MockGlitchTip());
  return booted;
}

async function getPrompt(
  server: Booted,
  name: string,
  args: Record<string, unknown>,
): Promise<GetPromptResult> {
  return server.client.request({
    method: 'prompts/get',
    params: { name, arguments: args },
  }) as Promise<GetPromptResult>;
}

describe('prompts/get triage-issue (acceptance 3)', () => {
  it('renders one user text message with the six steps, in order, each carrying issue_id', async () => {
    const server = await bootWith({});
    const result = await getPrompt(server, 'triage-issue', { issue_id: '42' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content.type).toBe('text');
    const text = result.messages[0].content.text;

    const stepOrder = [
      'get_issue {"issue_id":42',
      'get_latest_event {"issue_id":42',
      'list_issue_events {"issue_id":42',
      'list_issue_tags {"issue_id":42',
      'list_issue_commits {"issue_id":42',
      'list_issue_user_reports {"issue_id":42',
    ];
    let cursor = -1;
    for (const marker of stepOrder) {
      const at = text.indexOf(marker);
      expect(at, marker).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(text).toContain(
      "No organization was given: the tools use the server's default organization.",
    );
    expect(text).toContain('Rules for this task:');
    expect(text).toContain('<untrusted …> … </untrusted>');
  });

  it('carries "organization":"acme" in every step when given', async () => {
    const server = await bootWith({});
    const text = (await getPrompt(server, 'triage-issue', { issue_id: '42', organization: 'acme' }))
      .messages[0].content.text;
    expect(text).toContain('Pass "organization":"acme" as shown in every step.');
    const steps = text.split('\n').filter((line) => /^[1-6]\./.test(line));
    expect(steps).toHaveLength(6);
    for (const line of steps) expect(line).toContain('"organization":"acme"');
  });

  it('treats "organization":"" as absent', async () => {
    const server = await bootWith({});
    const withEmpty = (
      await getPrompt(server, 'triage-issue', { issue_id: '42', organization: '' })
    ).messages[0].content.text;
    const withoutIt = (await getPrompt(server, 'triage-issue', { issue_id: '42' })).messages[0]
      .content.text;
    expect(withEmpty).toBe(withoutIt);
  });
});

describe('prompts/get release-health-report (acceptance 4)', () => {
  it('carries version and project through steps 1-7, and the release: query, with no whitespace', async () => {
    const server = await bootWith({ GLITCHTIP_TOOLSETS: 'releases,issues' });
    const text = (
      await getPrompt(server, 'release-health-report', { version: '1.4.0', project: 'web' })
    ).messages[0].content.text;

    expect(text).toContain('release "1.4.0"');
    expect(text).toContain('"query":"release:1.4.0"');
    expect(text).toMatch(/^1\. get_release \{.*"project":"web".*\}:/m);
    for (const marker of [
      'list_issues {"query":"release:1.4.0","sort":"count"',
      'list_issues {"query":"release:1.4.0","sort":"first_seen"',
    ]) {
      expect(text).toContain(marker);
      expect(text.split(marker)[1].split('\n')[0]).toContain('"project":"web"');
    }
    const deploysLine = text.split('\n').find((l) => l.startsWith('2. list_release_deploys'));
    const commitsLine = text.split('\n').find((l) => l.startsWith('3. list_release_commits'));
    expect(deploysLine).not.toContain('project');
    expect(commitsLine).not.toContain('project');
    expect(text).toContain('7. For up to 5 issues from step 5');
    expect(text).not.toContain('This version contains whitespace');
  });

  it('uses the whitespace variant for a version with a space, with no step 7', async () => {
    const server = await bootWith({ GLITCHTIP_TOOLSETS: 'releases,issues' });
    const text = (await getPrompt(server, 'release-health-report', { version: '1.4 beta' }))
      .messages[0].content.text;
    expect(text).toContain('4. This version contains whitespace');
    expect(text).toContain('"query":""');
    expect(text).toContain('at most 5 of the largest of them');
    expect(text).not.toMatch(/^7\. /m);
    expect(text).not.toContain('release:1.4 beta');
  });

  it('escapes a version with quotes and angle brackets, and never emits a raw < or >', async () => {
    const server = await bootWith({ GLITCHTIP_TOOLSETS: 'releases,issues' });
    const text = (await getPrompt(server, 'release-health-report', { version: 'a"b<c>' }))
      .messages[0].content.text;
    expect(text).toContain('"a\\"b\\u003cc\\u003e"');
    expect(text).toContain('"query":"release:a\\"b\\u003cc\\u003e"');
    const argumentAngleBrackets = text
      .split('\n')
      .filter((line) => !line.includes('<untrusted') && !line.includes('</untrusted'))
      .join('\n');
    expect(argumentAngleBrackets).not.toMatch(/[<>]/);
    expect(JSON.parse(`"${text.match(/"a\\"b\\u003cc\\u003e"/)?.[0].slice(1, -1)}"`)).toBe(
      'a"b<c>',
    );
  });
});
