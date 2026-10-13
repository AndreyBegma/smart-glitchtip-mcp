import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// D-27, acceptance 5: every invalid-argument case is `-32602`, naming the
// argument; a non-string argument value is the SDK's own `-32603` raised
// before the handler; an unknown prompt name (including one whose toolsets
// are off) is `-32602 Unknown prompt`.

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function bootWith(env: NodeJS.ProcessEnv) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'releases,issues,events', ...env },
    new MockGlitchTip(),
  );
  return booted;
}

function getPrompt(server: Booted, name: string, args: Record<string, unknown>) {
  return server.client.request({ method: 'prompts/get', params: { name, arguments: args } });
}

describe('triage-issue validation (acceptance 5)', () => {
  it.each([
    ['no arguments at all', {}, 'issue_id'],
    ['issue_id "abc"', { issue_id: 'abc' }, 'issue_id'],
    ['issue_id "0"', { issue_id: '0' }, 'issue_id'],
    ['issue_id "PROJ-12"', { issue_id: 'PROJ-12' }, 'issue_id'],
    ['issue_id "1.5"', { issue_id: '1.5' }, 'issue_id'],
    ['issue_id 20 nines', { issue_id: '99999999999999999999' }, 'issue_id'],
    ['organization "a/b"', { issue_id: '42', organization: 'a/b' }, 'organization'],
  ])('%s is -32602 naming the argument', async (_label, args, argument) => {
    const server = await bootWith({});
    await expect(getPrompt(server, 'triage-issue', args)).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining(`prompt triage-issue: ${argument} `),
    });
  });

  it('issue_id as a JSON number is -32603, from the SDK, before the handler', async () => {
    const mock = new MockGlitchTip();
    booted = await bootInMemory(
      { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'issues,events' },
      mock,
    );
    await expect(
      booted.client.request({
        method: 'prompts/get',
        params: { name: 'triage-issue', arguments: { issue_id: 42 } },
      }),
    ).rejects.toMatchObject({ code: -32603 });
    expect(mock.requests).toEqual([]);
  });

  it('issue_id null is -32603, from the SDK, before the handler', async () => {
    const mock = new MockGlitchTip();
    booted = await bootInMemory(
      { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'issues,events' },
      mock,
    );
    await expect(
      booted.client.request({
        method: 'prompts/get',
        params: { name: 'triage-issue', arguments: { issue_id: null } },
      }),
    ).rejects.toMatchObject({ code: -32603 });
    expect(mock.requests).toEqual([]);
  });
});

describe('release-health-report validation (acceptance 5)', () => {
  it.each([
    ['version ""', { version: '' }, 'version'],
    ['version ".."', { version: '..' }, 'version'],
    ['version "a/b"', { version: 'a/b' }, 'version'],
    ['version "50%"', { version: '50%' }, 'version'],
    ['version 256 characters', { version: 'v'.repeat(256) }, 'version'],
    ['version a newline', { version: 'v1\nv2' }, 'version'],
    ['version U+202E', { version: `v1${String.fromCodePoint(0x202e)}` }, 'version'],
    ['project "a b"', { version: '1.0.0', project: 'a b' }, 'project'],
  ])('%s is -32602 naming the argument', async (_label, args, argument) => {
    const server = await bootWith({});
    await expect(getPrompt(server, 'release-health-report', args)).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining(`prompt release-health-report: ${argument} `),
    });
  });
});

describe('unknown prompt name (acceptance 5)', () => {
  it('prompts/get no-such-prompt is -32602', async () => {
    const server = await bootWith({});
    await expect(getPrompt(server, 'no-such-prompt', {})).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining('Unknown prompt'),
    });
  });

  it('release-health-report is -32602 Unknown prompt when its toolsets are off', async () => {
    booted = await bootInMemory(
      { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'issues,events' },
      new MockGlitchTip(),
    );
    await expect(
      getPrompt(booted, 'release-health-report', { version: '1.0.0' }),
    ).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('Unknown prompt') });
  });
});
