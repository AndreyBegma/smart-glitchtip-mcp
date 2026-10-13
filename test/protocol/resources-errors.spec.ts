import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory } from '../support/boot';
import { jsonResponse, MockGlitchTip } from '../support/mock-glitchtip';
import {
  API,
  bootResources,
  EVENT,
  eventUrl,
  HEX_EVENT_ID,
  ISSUE,
  issueUrl,
  latestEventUrl,
  mockIssueAndEvents,
  readResource,
  TOKEN,
} from './resources.support';

// FEAT-20260925-019, acceptance 5 and 6. Resource reads have no `isError`
// result: every failure is a JSON-RPC error. Validation and a GlitchTip 404
// are `-32602`; every other failure keeps the tools' message as `-32603`.

const BOTH = { GLITCHTIP_TOOLSETS: 'issues,events' };

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function bootBoth(mock = mockIssueAndEvents()) {
  booted = await bootResources(BOTH, mock);
  return { client: booted.client, mock };
}

describe('validation, before any request (acceptance 5)', () => {
  it.each([
    ['glitchtip://issues/0', 'issue_id must be a positive integer'],
    ['glitchtip://issues/-1', 'issue_id must be a positive integer'],
    ['glitchtip://issues/abc', 'issue_id must be a positive integer'],
    ['glitchtip://issues/1.5', 'issue_id must be a positive integer'],
    ['glitchtip://issues/99999999999999999999', 'issue_id must be a positive integer'],
    ['glitchtip://issues/5%2F..', 'issue_id must be a positive integer'],
    ['glitchtip://issues/42/events/not-an-id', 'event_id must be an event id'],
    ['glitchtip://issues/42/events/..', 'event_id must be an event id'],
    ['glitchtip://issues/42?organization=a%2Fb', 'organization must be an organization slug'],
    [
      'glitchtip://issues/42/events/latest?organization=',
      'organization must be an organization slug',
    ],
  ])('%s is -32602 and calls nothing', async (uri, message) => {
    const { client, mock } = await bootBoth();
    await expect(readResource(client, uri)).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining(message),
    });
    expect(mock.requests).toEqual([]);
  });

  it("a path no template has is mcp-nest's -32602 Unknown resource", async () => {
    const { client, mock } = await bootBoth();
    await expect(readResource(client, 'glitchtip://issues/42/comments')).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining('Unknown resource: glitchtip://issues/42/comments'),
    });
    expect(mock.requests).toEqual([]);
  });

  it.each([
    'https://issues/42',
    'GLITCHTIP://ISSUES/42',
    'glitchtip://issues/42/',
    'glitchtip://issues/42/events/latest/',
    'glitchtip://issues/42/?organization=acme',
  ])('the non-canonical %s is -32602 Unknown resource and calls nothing', async (uri) => {
    const { client, mock } = await bootBoth();
    await expect(readResource(client, uri)).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining(`Unknown resource: ${uri}`),
    });
    expect(mock.requests).toEqual([]);
  });

  it('echoes a long URI with a line break flattened and capped at 200 characters', async () => {
    const { client } = await bootBoth();
    const uri = `https://issues/42?x=${'a\nb'.repeat(100)}`;
    expect(uri.length).toBeGreaterThan(300);
    const error = await readResource(client, uri).then(
      () => undefined,
      (e: { code: number; message: string }) => e,
    );
    expect(error?.code).toBe(-32602);
    const echoed = error?.message.split('Unknown resource: ')[1] ?? '';
    expect(echoed).not.toMatch(/[\r\n]/);
    expect(echoed).toHaveLength(200);
    expect(echoed.endsWith('…')).toBe(true);
  });

  it("a malformed percent-encoding is mcp-nest's -32603 URI malformed, calling nothing (accepted)", async () => {
    const { client, mock } = await bootBoth();
    await expect(readResource(client, 'glitchtip://issues/%E0%A4%A')).rejects.toMatchObject({
      code: -32603,
      message: expect.stringContaining('URI malformed'),
    });
    expect(mock.requests).toEqual([]);
  });
});

describe('GlitchTip failures (acceptance 6)', () => {
  it('a 404 on the issue is -32602 naming the issue and organization, with data.uri', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      issueUrl(),
      { detail: 'Not found.' },
      { status: 404 },
    );
    const { client } = await bootBoth(mock);
    await expect(readResource(client, 'glitchtip://issues/42')).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining(
        'Issue 42 was not found in acme (it may be in another organization, or deleted).',
      ),
      data: { uri: 'glitchtip://issues/42' },
    });
  });

  it('a 404 on the latest event names the issue, with data.uri', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      latestEventUrl(),
      { detail: 'Not found.' },
      { status: 404 },
    );
    const { client } = await bootBoth(mock);
    await expect(readResource(client, 'glitchtip://issues/42/events/latest')).rejects.toMatchObject(
      {
        code: -32602,
        message: expect.stringContaining('Issue 42 was not found in acme'),
        data: { uri: 'glitchtip://issues/42/events/latest' },
      },
    );
  });

  it('a 404 on an event by id names the event and the issue, with data.uri', async () => {
    const uri = `glitchtip://issues/42/events/${HEX_EVENT_ID}`;
    const mock = new MockGlitchTip().json(
      'GET',
      eventUrl(HEX_EVENT_ID),
      { detail: 'Not found.' },
      { status: 404 },
    );
    const { client } = await bootBoth(mock);
    await expect(readResource(client, uri)).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining(`Event ${HEX_EVENT_ID} was not found for issue 42.`),
      data: { uri },
    });
  });

  it("a 403 is -32603 with the tools' message naming the scopes", async () => {
    const mock = new MockGlitchTip().json('GET', issueUrl(), { detail: 'nope' }, { status: 403 });
    const { client } = await bootBoth(mock);
    await expect(readResource(client, 'glitchtip://issues/42')).rejects.toMatchObject({
      code: -32603,
      message: expect.stringContaining('event:read, event:write, event:admin'),
    });
  });

  it('a malformed issue body is -32603 with the malformed message naming the resource', async () => {
    // A non-string title is what issueDetailView cannot read (a TypeError in flatten).
    const mock = new MockGlitchTip().json('GET', issueUrl(), { ...ISSUE, title: { nested: 1 } });
    const { client } = await bootBoth(mock);
    const error = await readResource(client, 'glitchtip://issues/42').then(
      () => undefined,
      (e: { code: number; message: string }) => e,
    );
    expect(error?.code).toBe(-32603);
    expect(error?.message).toContain(
      'GlitchTip returned a response this server did not expect for get_issue (resource glitchtip://issues/42)',
    );
    expect(error?.message).not.toContain('Internal error');
    const id = /\(([0-9a-f-]{36})\)/.exec(error?.message ?? '')?.[1];
    expect(booted?.logs()).toContain(`"errorId":"${id}"`);
  });

  it('a malformed event degrades like get_latest_event does, never an error', async () => {
    const mock = new MockGlitchTip().json('GET', latestEventUrl(), { ...EVENT, entries: 7 });
    const { client } = await bootBoth(mock);
    const { contents } = await readResource(client, 'glitchtip://issues/42/events/latest');
    expect(contents).toHaveLength(1);
  });

  it('with two visible organizations and no default, is -32602 naming ?organization=', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, [
      { slug: 'one', name: 'One', dateCreated: '2026-01-01' },
      { slug: 'two', name: 'Two', dateCreated: '2026-01-01' },
    ]);
    booted = await bootInMemory({ GLITCHTIP_TOKEN: TOKEN, ...BOTH }, mock);
    await expect(readResource(booted.client, 'glitchtip://issues/42')).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining('add ?organization=<slug> to the URI'),
    });
    expect(mock.requests.map((r) => r.url.pathname)).toEqual(['/api/0/organizations/']);
  });

  it('a 5xx is -32603, never an empty body', async () => {
    const mock = new MockGlitchTip().on('GET', issueUrl(), jsonResponse({ detail: 'x' }, 502));
    const { client } = await bootBoth(mock);
    await expect(readResource(client, 'glitchtip://issues/42')).rejects.toMatchObject({
      code: -32603,
    });
  });
});
