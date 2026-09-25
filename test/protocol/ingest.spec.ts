import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { jsonResponse, MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 2, 9, 10, 11, 12, 13, 16: registration counts, DSN/key-id routing and the
// host-mismatch diagnostic, the ingest-specific status mapping, several-keys validation,
// token/secret safety, malformed responses, and the wait_seconds verification poll.

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';
const KEYS_URL = `${API}/projects/acme/web/keys/`;
const STORE_URL = `${GLITCHTIP}/api/42/store/`;
const SECURITY_URL = `${GLITCHTIP}/api/42/security/`;

const KEY = {
  name: null,
  label: 'Prod',
  dateCreated: '2026-01-01T00:00:00Z',
  id: '11111111-1111-4111-8111-111111111111',
  dsn: { public: 'https://bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb@glitchtip.test/42' },
  public: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  projectID: 42,
};

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
  vi.restoreAllMocks();
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    {
      GLITCHTIP_TOKEN: TOKEN,
      GLITCHTIP_TOOLSETS: 'ingest',
      GLITCHTIP_READ_ONLY: 'false',
      ...env,
    },
    mock,
  );
  return booted.client;
}

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>, env = {}) {
  const client = await boot(mock, env);
  const result = await client.callTool({ name, arguments: args });
  return { result, text: resultText(result), isError: result.isError === true };
}

function keysMock(...keys: (typeof KEY)[]) {
  return new MockGlitchTip().json('GET', KEYS_URL, keys);
}

describe('ingest toolset registration', () => {
  it('read-only: whoami only, ingest contributes nothing', async () => {
    booted = await bootInMemory(
      { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'ingest', GLITCHTIP_READ_ONLY: 'true' },
      new MockGlitchTip(),
    );
    const { tools } = await booted.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['whoami']);
  });

  it('writes enabled: whoami plus exactly the 2 tools, not readOnly, not destructive, not idempotent', async () => {
    booted = await bootInMemory(
      { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'ingest', GLITCHTIP_READ_ONLY: 'false' },
      new MockGlitchTip(),
    );
    const { tools } = await booted.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['send_test_event', 'send_test_security_report', 'whoami'].sort(),
    );
    for (const tool of tools.filter((t) => t.name !== 'whoami')) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
    }
  });

  it('billing,ingest with writes enabled: whoami plus 12', async () => {
    booted = await bootInMemory(
      {
        GLITCHTIP_TOKEN: TOKEN,
        GLITCHTIP_TOOLSETS: 'billing,ingest',
        GLITCHTIP_READ_ONLY: 'false',
      },
      new MockGlitchTip(),
    );
    const { tools } = await booted.client.listTools();
    expect(tools).toHaveLength(13);
  });
});

describe('send_test_event', () => {
  it('routes to the resolved instance with sentry_key and projectID from the keys response', async () => {
    const mock = keysMock(KEY).on('POST', STORE_URL, jsonResponse({ event_id: 'evt123' }, 200));
    const { text, isError } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(false);
    expect(text).toBe(`Accepted: event evt123 via key ${KEY.id} (project 42).`);
    const store = mock.requests.find((r) => r.url.pathname === '/api/42/store/');
    expect(store?.url.searchParams.get('sentry_key')).toBe(KEY.public);
    const body = JSON.parse(store?.body ?? '{}');
    expect(body.logger).toBe('smart-glitchtip-mcp');
    expect(body.tags).toEqual({ 'smart-glitchtip-mcp': 'test' });
    expect(body.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('selects the key by key_id', async () => {
    const other = {
      ...KEY,
      id: 'other',
      label: 'Other',
      public: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    };
    const mock = keysMock(KEY, other).on(
      'POST',
      STORE_URL,
      jsonResponse({ event_id: 'evt1' }, 200),
    );
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
      key_id: KEY.id,
    });
    expect(isError).toBe(false);
    expect(text).toContain(KEY.id);
  });

  it('several keys and neither key_id nor dsn: validation error listing both, no ingest request', async () => {
    const other = { ...KEY, id: 'other-id', label: 'Other' };
    const mock = keysMock(KEY, other);
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toContain(KEY.id);
    expect(text).toContain('other-id');
    expect(text).toContain('Pass `key_id`');
    expect(mock.requests.some((r) => r.url.pathname === '/api/42/store/')).toBe(false);
  });

  it('a dsn whose key is not in the project keys makes no ingest request', async () => {
    const mock = keysMock(KEY);
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
      dsn: 'https://zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz@glitchtip.test/42',
    });
    expect(isError).toBe(true);
    expect(text).toContain('This DSN is not a key of acme/web');
    expect(mock.requests.some((r) => r.url.pathname === '/api/42/store/')).toBe(false);
  });

  it('a dsn naming another host still sends to the resolved instance, with the mismatch noted', async () => {
    const mock = keysMock(KEY).on('POST', STORE_URL, jsonResponse({ event_id: 'evt1' }, 200));
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
      dsn: `https://${KEY.public}@other-host.example/42`,
    });
    expect(isError).toBe(false);
    expect(text).toContain('The DSN names host other-host.example');
    expect(text).toContain('this server reached the instance at https://glitchtip.test');
    const store = mock.requests.find((r) => r.url.pathname === '/api/42/store/');
    expect(store?.url.host).toBe('glitchtip.test');
  });

  it('key_id and dsn together is a validation error before any request', async () => {
    const mock = keysMock(KEY);
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
      key_id: KEY.id,
      dsn: `https://${KEY.public}@glitchtip.test/42`,
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('401: the DSN-key message, which never mentions the API token', async () => {
    const mock = keysMock(KEY).on('POST', STORE_URL, jsonResponse({}, 401));
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toContain('The DSN key was rejected');
    expect(text).not.toContain('token');
  });

  it('429: the throttled message, not retried (one request)', async () => {
    const mock = keysMock(KEY).on('POST', STORE_URL, jsonResponse({}, 429, { 'retry-after': '7' }));
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toContain('throttled');
    expect(text).toContain('7');
    expect(mock.requests.filter((r) => r.url.pathname === '/api/42/store/')).toHaveLength(1);
  });

  it('503: the maintenance message', async () => {
    const mock = keysMock(KEY).on('POST', STORE_URL, jsonResponse({}, 503));
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Ingest is paused on this instance (maintenance).');
  });

  it('422: malformed, with the detail passed through', async () => {
    const mock = keysMock(KEY).on(
      'POST',
      STORE_URL,
      jsonResponse({ detail: 'timestamp is invalid' }, 422),
    );
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toBe('GlitchTip refused the event as malformed: timestamp is invalid.');
  });

  it('a 200 without a string event_id is still a success, and says so', async () => {
    const mock = keysMock(KEY).on('POST', STORE_URL, jsonResponse({}, 200));
    const { isError, text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(false);
    expect(text).toContain('Accepted');
    expect(text).toContain('not in the expected shape');
  });

  it('never leaks the API token or a legacy DSN secret', async () => {
    const mock = keysMock(KEY).on('POST', STORE_URL, jsonResponse({}, 401));
    const { text } = await call(mock, 'send_test_event', {
      organization: 'acme',
      project: 'web',
      dsn: `https://${KEY.public}:SECRET_DSN_PART@glitchtip.test/42`,
    });
    expect(text).not.toContain('tok_TEST');
    expect(text).not.toContain('SECRET_DSN_PART');
  });

  it('verifies with wait_seconds: the mock answers 404 then 200, and the result says Processed', async () => {
    vi.useFakeTimers();
    const fixedEventId = '22222222-2222-4222-8222-222222222222';
    vi.mocked(nodeRandomUUID).mockReturnValue(fixedEventId as ReturnType<typeof nodeRandomUUID>);
    const mock = keysMock(KEY)
      .on('POST', STORE_URL, jsonResponse({ event_id: 'evt1' }, 200))
      .on(
        'GET',
        `${API}/projects/acme/web/events/${fixedEventId}/`,
        new Response(null, { status: 404 }),
        jsonResponse({ groupID: 'g1' }, 200),
      );
    const client = await boot(mock);
    const promise = client.callTool({
      name: 'send_test_event',
      arguments: { organization: 'acme', project: 'web', wait_seconds: 4 },
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toContain('Processed: the event is visible (issue g1).');
    vi.useRealTimers();
  });
});

describe('send_test_security_report', () => {
  it('accepts a 201 with no body', async () => {
    const mock = keysMock(KEY).on('POST', SECURITY_URL, new Response(null, { status: 201 }));
    const { isError, text } = await call(mock, 'send_test_security_report', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(false);
    expect(text).toBe(`Accepted via key ${KEY.id}.`);
    const security = mock.requests.find((r) => r.url.pathname === '/api/42/security/');
    const body = JSON.parse(security?.body ?? '{}');
    expect(body['csp-report']['document-uri']).toBe('https://smart-glitchtip-mcp.invalid/test');
  });

  it('maps a 401 the same way as send_test_event', async () => {
    const mock = keysMock(KEY).on('POST', SECURITY_URL, jsonResponse({}, 401));
    const { isError, text } = await call(mock, 'send_test_security_report', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toContain('The DSN key was rejected');
  });
});
