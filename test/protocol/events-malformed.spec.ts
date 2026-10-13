import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Review items 8-9 ("Defensive parsing — must degrade, never 'Internal
// error'"), verified through the actual MCP call boundary: a malformed
// response from GlitchTip is never a crash. Each tool gets a fixture that
// deviates from the generated schema the way a real payload could
// (`entries` as an object, `null` entries, `tags: null`, `title: null`, …)
// and must still answer with text, isError: false.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';
const ORG = 'acme';

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'events', GLITCHTIP_DEFAULT_ORG: ORG },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('malformed-list-item', () => {
  it('list_issue_events tolerates title: null and tags: null', async () => {
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
        tags: null,
        title: null,
        entries: [],
      },
    ]);
    const { text, isError } = await call(mock, 'list_issue_events', { issue_id: 42 });
    expect(isError).toBe(false);
    expect(text).toContain('(no title)');
  });

  it('list_project_events tolerates tags sent as an object', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/${ORG}/web/events/`, [
      {
        id: 'evt-1',
        eventID: 'a',
        projectID: 1,
        groupID: 'grp-1',
        dateCreated: 'x',
        dateReceived: '2026-01-02T03:04:06Z',
        type: 'error',
        message: '',
        tags: { level: 'error' },
        title: 'boom',
        entries: [],
      },
    ]);
    const { isError } = await call(mock, 'list_project_events', { project: 'web' });
    expect(isError).toBe(false);
  });
});

describe('malformed-entries-object', () => {
  it('get_latest_event tolerates entries sent as an object instead of an array', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/latest/`,
      {
        id: 'evt-1',
        eventID: 'a',
        projectID: 1,
        groupID: 'grp-1',
        dateCreated: 'x',
        dateReceived: 'x',
        type: 'error',
        message: '',
        tags: [],
        title: 'boom',
        entries: { 0: { type: 'exception', data: { values: [] } } },
        userReport: null,
      },
    );
    const { text, isError } = await call(mock, 'get_latest_event', { issue_id: 42 });
    expect(isError).toBe(false);
    expect(text).toContain('event id: evt-1'); // sanity: header still rendered
  });
});

describe('malformed-null-entries', () => {
  it('get_event tolerates null entries in the array', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/evt-1/`,
      {
        id: 'evt-1',
        eventID: 'a',
        projectID: 1,
        groupID: 'grp-1',
        dateCreated: 'x',
        dateReceived: 'x',
        type: 'error',
        message: '',
        tags: [],
        title: 'boom',
        entries: [null, { type: 'message', data: { formatted: 'still readable' } }],
        userReport: null,
      },
    );
    const { text, isError } = await call(mock, 'get_event', { issue_id: 42, event_id: 'evt-1' });
    expect(isError).toBe(false);
    expect(text).toContain('still readable');
  });
});

describe('malformed-raw-payload-shapes', () => {
  it('get_event_json tolerates user/request/contexts in unexpected shapes', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/${ORG}/issues/42/events/evt-1/json/`,
      { user: 'not-an-object', request: [1, 2, 3], contexts: null, title: 'boom' },
    );
    const { text, isError } = await call(mock, 'get_event_json', {
      issue_id: 42,
      event_id: 'evt-1',
    });
    expect(isError).toBe(false);
    expect(text).toContain('boom');
  });
});

describe('malformed-errors-and-tags', () => {
  it('get_project_event tolerates errors/tags sent as an object', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/${ORG}/web/events/evt-1/`, {
      id: 'evt-1',
      eventID: 'a',
      projectID: 1,
      groupID: 'grp-1',
      dateCreated: 'x',
      dateReceived: 'x',
      type: 'error',
      message: '',
      tags: { level: 'error' },
      title: 'boom',
      entries: [],
      errors: { 0: { type: 'x' } },
      userReport: null,
    });
    const { text, isError } = await call(mock, 'get_project_event', {
      project: 'web',
      event_id: 'evt-1',
    });
    expect(isError).toBe(false);
    expect(text).toContain('event id: evt-1');
  });
});
