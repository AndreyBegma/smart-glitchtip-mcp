import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 1, 2, 6, 9: registration through the protocol, a mocked-response
// and error-path test per tool, and get_event_json's path/redaction plumbing.
// The renderer itself (frame order, budget trimming, escaping) is covered in
// test/toolsets/events/.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';
const ORG = 'acme';

// get_event_json's whole result is one untrusted('payload', …) fence (D-18).
const FENCE = /^<untrusted source="glitchtip-event" field="payload">([\s\S]*)<\/untrusted>$/;
function unfence(text: string): unknown {
  const match = FENCE.exec(text);
  expect(match).not.toBeNull();
  return JSON.parse(match?.[1] ?? '');
}

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const EVENT_DETAIL = {
  id: 'evt-1',
  eventID: '1'.repeat(32),
  projectID: 1,
  groupID: 'grp-1',
  dateCreated: '2026-01-02T03:04:05Z',
  dateReceived: '2026-01-02T03:04:06Z',
  type: 'error',
  message: '',
  tags: [{ key: 'level', value: 'error' }],
  title: 'ValueError: boom',
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'ValueError',
            value: 'boom',
            stacktrace: {
              frames: [{ filename: 'app.py', function: 'run', lineno: 1, in_app: true }],
            },
          },
        ],
      },
    },
  ],
  userReport: null,
};

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'events', GLITCHTIP_DEFAULT_ORG: ORG, ...env },
    mock,
  );
  return booted.client;
}

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>, env = {}) {
  const client = await boot(mock, env);
  const result = await client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('tools/list (acceptance 1)', () => {
  it('lists whoami and the six events tools, all read-only', async () => {
    const client = await boot(new MockGlitchTip());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_event',
      'get_event_json',
      'get_latest_event',
      'get_project_event',
      'list_issue_events',
      'list_project_events',
      'whoami',
    ]);
    for (const tool of tools.filter((t) => t.name !== 'whoami')) {
      expect(tool.annotations).toMatchObject(READ);
    }
  });
});

describe('list_issue_events', () => {
  it('lists events newest first, sending limit and cursor', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/${ORG}/issues/42/events/`, [
      {
        id: 'evt-1',
        eventID: 'a',
        projectID: 1,
        groupID: 'grp-1',
        dateCreated: 'x',
        dateReceived: '2026-01-02T03:04:06Z',
        type: 'error',
        message: '',
        tags: [],
        title: 'boom',
        entries: [],
      },
    ]);
    const { text, isError } = await call(mock, 'list_issue_events', { issue_id: 42, limit: 10 });
    expect(isError).toBe(false);
    expect(text).toContain('evt-1');
    expect(text).toContain('boom');
    expect(mock.requests[0].url.searchParams.get('limit')).toBe('10');
  });

  it('maps 404 naming the issue', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'list_issue_events', { issue_id: 42 });
    expect(isError).toBe(true);
    expect(text).toBe('Issue 42 was not found in acme.');
  });
});

describe('get_latest_event', () => {
  it('renders the stack trace of the most recent event', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/latest/`,
      EVENT_DETAIL,
    );
    const { text, isError } = await call(mock, 'get_latest_event', { issue_id: 42 });
    expect(isError).toBe(false);
    expect(text).toContain('ValueError: boom');
    expect(text).toContain('at run (app.py:1');
  });

  it('maps 404 naming the issue', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/latest/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'get_latest_event', { issue_id: 42 });
    expect(isError).toBe(true);
    expect(text).toBe('Issue 42 was not found in acme.');
  });

  it('format: "json" returns the projected object directly, unfenced (review 6, final ruling)', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/latest/`,
      EVENT_DETAIL,
    );
    const { text, isError } = await call(mock, 'get_latest_event', {
      issue_id: 42,
      format: 'json',
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('<untrusted');
    const parsed = JSON.parse(text) as { header: { id: string } };
    expect(parsed.header.id).toBe('evt-1');
  });
});

describe('get_event', () => {
  it('fetches one event by id', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/evt-1/`,
      EVENT_DETAIL,
    );
    const { text, isError } = await call(mock, 'get_event', { issue_id: 42, event_id: 'evt-1' });
    expect(isError).toBe(false);
    expect(text).toContain('ValueError: boom');
  });

  it('maps 404 to a message naming the event and the issue', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/evt-x/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'get_event', { issue_id: 42, event_id: 'evt-x' });
    expect(isError).toBe(true);
    expect(text).toBe('Event evt-x was not found for issue 42.');
  });
});

describe('get_event_json', () => {
  const RAW = {
    event_id: 'evt-1',
    timestamp: 1,
    datetime: '2026-01-02T03:04:05Z',
    project: 1,
    level: 'error',
    title: 'boom',
    transaction: '',
    hashes: [],
    tags: {},
    user: { id: '1', email: 'a@b.test', ip_address: '203.0.113.9', geo: { city: 'X' } },
    request: {
      url: 'https://example.com',
      cookies: 'session=secret',
      headers: [
        ['Cookie', 'session=secret'],
        ['Authorization', 'Bearer x'],
      ],
    },
    contexts: { runtime: { name: 'CPython', version: '3.11' } },
  };

  it('redacts user IP/geo and secret request headers/cookies', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/evt-1/json/`,
      RAW,
    );
    const { text, isError } = await call(mock, 'get_event_json', {
      issue_id: 42,
      event_id: 'evt-1',
    });
    expect(isError).toBe(false);
    expect(text).toMatch(FENCE);
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain('"city"');
    expect(text).not.toContain('session=secret');
    expect(text).not.toContain('Bearer x');
    expect(text).toContain('[redacted]');
    expect(text).toContain('a@b.test');
  });

  it('format: "json" returns the redacted object directly, unfenced (review 6, final ruling)', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/evt-1/json/`,
      RAW,
    );
    const { text, isError } = await call(mock, 'get_event_json', {
      issue_id: 42,
      event_id: 'evt-1',
      format: 'json',
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('<untrusted');
    const parsed = JSON.parse(text) as {
      user: Record<string, unknown>;
      request: { cookies: unknown };
    };
    expect(typeof parsed).toBe('object');
    expect(parsed.user.ip_address).toBeUndefined();
    expect(parsed.request.cookies).toBe('[redacted]');
  });

  it('narrows the output with a JSON Pointer', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/evt-1/json/`,
      RAW,
    );
    const { text, isError } = await call(mock, 'get_event_json', {
      issue_id: 42,
      event_id: 'evt-1',
      path: '/contexts/runtime',
    });
    expect(isError).toBe(false);
    expect(unfence(text)).toEqual({ name: 'CPython', version: '3.11' });
  });

  it('refuses a pointer that matches nothing, without a second request', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/evt-1/json/`,
      RAW,
    );
    const { text, isError } = await call(mock, 'get_event_json', {
      issue_id: 42,
      event_id: 'evt-1',
      path: '/nope',
    });
    expect(isError).toBe(true);
    expect(text).toContain('nope');
  });

  it('maps 404 to a message naming the event and the issue', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/evt-1/json/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'get_event_json', {
      issue_id: 42,
      event_id: 'evt-1',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Event evt-1 was not found for issue 42.');
  });
});

describe('list_project_events', () => {
  it('lists events with the issue id included', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/${ORG}/web/events/`, [
      {
        id: 'evt-1',
        eventID: 'a',
        projectID: 1,
        groupID: 'grp-9',
        dateCreated: 'x',
        dateReceived: '2026-01-02T03:04:06Z',
        type: 'error',
        message: '',
        tags: [],
        title: 'boom',
        entries: [],
      },
    ]);
    const { text, isError } = await call(mock, 'list_project_events', { project: 'web' });
    expect(isError).toBe(false);
    expect(text).toContain('issue=grp-9');
  });

  it('maps 404 naming the project', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/projects/${ORG}/web/events/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'list_project_events', { project: 'web' });
    expect(isError).toBe(true);
    expect(text).toBe('Project web was not found in acme.');
  });
});

describe('get_project_event', () => {
  it('fetches one event of a project', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/projects/${ORG}/web/events/evt-1/`,
      EVENT_DETAIL,
    );
    const { text, isError } = await call(mock, 'get_project_event', {
      project: 'web',
      event_id: 'evt-1',
    });
    expect(isError).toBe(false);
    expect(text).toContain('ValueError: boom');
  });

  it('maps 404 to a message naming the event and the project', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/projects/${ORG}/web/events/evt-x/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'get_project_event', {
      project: 'web',
      event_id: 'evt-x',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Event evt-x was not found in project web.');
  });
});
