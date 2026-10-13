import { describe, expect, it } from 'vitest';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import { API, TOKEN, useApiServer } from './api_request.support';

// Acceptance 5 (gate: token-safety): every body is redacted before it is shown,
// in text and json, on success and on error.

const call = useApiServer();
const FORMATS = ['text', 'json'] as const;

async function get(body: unknown, format: (typeof FORMATS)[number], path = 'things') {
  const mock = new MockGlitchTip().json('GET', `${API}/${path}/`, body);
  return call(mock, 'api_get', { path, format });
}

describe.each(FORMATS)('redaction, format %s (acceptance 5)', (format) => {
  it('removes the token in use from the API root (auth.token)', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/`, {
      version: '5.0',
      user: { id: 1 },
      auth: { id: 3, token: TOKEN, scopes: ['org:read'] },
    });
    const { text, isError, logs } = await call(mock, 'api_get', { path: '', format });
    expect(isError).toBe(false);
    expect(text).toContain('[redacted');
    expect(text).not.toContain(TOKEN);
    expect(logs).not.toContain(TOKEN);
  });

  it.each([
    ['clientSecret', { a: { clientSecret: 's3cr3t_value' } }, 's3cr3t_value'],
    ['client_secret', { a: { client_secret: 'CLIENT_SECRET_2' } }, 'CLIENT_SECRET_2'],
    ['api_key (nested config)', { config: { api_key: 'ZULIP_KEY_1' } }, 'ZULIP_KEY_1'],
    ['secret at depth 3', { a: { b: { secret: 'DEEP_SECRET_3' } } }, 'DEEP_SECRET_3'],
    ['inviteLink', { inviteLink: 'https://g.test/accept/5/INVITE_TOKEN/' }, 'INVITE_TOKEN'],
    ['chatwootIdentifierHash', { chatwootIdentifierHash: 'HMAC_VALUE' }, 'HMAC_VALUE'],
    [
      'dsn.secret',
      { dsn: { public: 'https://pub@g.test/1', secret: 'https://pub:DSN_SECRET@g.test/1' } },
      'DSN_SECRET',
    ],
    [
      'heartbeatEndpoint',
      { heartbeatEndpoint: 'https://g.test/api/0/heartbeat/HEARTBEAT_ID_9/' },
      'HEARTBEAT_ID_9',
    ],
    ['password (mixed case key)', { PassWord: 'PASSWORD_VALUE' }, 'PASSWORD_VALUE'],
    [
      'endpointID (a monitor heartbeat UUID)',
      { monitor: { id: 1, endpointID: '0f1e2d3c-heartbeat-uuid' } },
      '0f1e2d3c-heartbeat-uuid',
    ],
    ['endpoint_id', { endpoint_id: 'ENDPOINT_UUID_2' }, 'ENDPOINT_UUID_2'],
    ['auth_token', { auth_token: 'AUTH_TOKEN_3' }, 'AUTH_TOKEN_3'],
    ['private_key', { private_key: 'PRIVATE_KEY_4' }, 'PRIVATE_KEY_4'],
    ['access_token', { access_token: 'ACCESS_TOKEN_5' }, 'ACCESS_TOKEN_5'],
    ['accessToken', { accessToken: 'ACCESS_TOKEN_6' }, 'ACCESS_TOKEN_6'],
    ['refresh_token', { refresh_token: 'REFRESH_TOKEN_7' }, 'REFRESH_TOKEN_7'],
    ['refreshToken', { refreshToken: 'REFRESH_TOKEN_8' }, 'REFRESH_TOKEN_8'],
    [
      'a caught secret echoed under another key',
      { token: 'ECHOED_SECRET_7', message: 'your token is ECHOED_SECRET_7' },
      'ECHOED_SECRET_7',
    ],
  ])('removes %s', async (_, body, secret) => {
    const { text, isError } = await get(body, format);
    expect(isError).toBe(false);
    expect(text).not.toContain(secret);
    expect(text).toContain('[redacted]');
  });

  it('keeps dsn.public', async () => {
    const { text } = await get({ dsn: { public: 'https://pub@g.test/1', secret: 'x' } }, format);
    expect(text).toContain('https://pub@g.test/1');
  });

  it('strips a URL fragment and keeps the URL up to #', async () => {
    const { text } = await get(
      { link: 'https://glitchtip.com/support#sub=LICENSE-KEY-123' },
      format,
    );
    expect(text).not.toContain('LICENSE-KEY-123');
    expect(text).toContain('https://glitchtip.com/support#[redacted]');
  });

  it('strips a URL fragment inside a longer string value', async () => {
    const { text } = await get(
      { message: 'open https://glitchtip.com/support#sub=LICENSE-KEY-999 to renew' },
      format,
    );
    expect(text).not.toContain('LICENSE-KEY-999');
    expect(text).toContain('https://glitchtip.com/support#[redacted] to renew');
  });

  it('masks an alert recipient URL (projects/acme/web/alerts/)', async () => {
    const body = [
      {
        id: 1,
        alertRecipients: [
          {
            id: 2,
            recipientType: 'discord',
            url: 'https://discord.com/api/webhooks/1/WEBHOOK_SECRET',
          },
        ],
      },
    ];
    const { text } = await get(body, format, 'projects/acme/web/alerts');
    expect(text).toContain('https://discord.com/…');
    expect(text).not.toContain('WEBHOOK_SECRET');
  });

  it('masks a recipient-shaped object nested in another route', async () => {
    const body = {
      deep: { list: [{ recipientType: 'webhook', url: 'https://hooks.test/p/HOOK_SECRET?x=1' }] },
    };
    const { text } = await get(body, format, 'organizations/acme/anything');
    expect(text).toContain('https://hooks.test/…');
    expect(text).not.toContain('HOOK_SECRET');
  });
});

describe('redaction of text and error bodies (acceptance 5)', () => {
  it('strips a fragment inside a text/plain body, and the token', async () => {
    const mock = new MockGlitchTip().on(
      'GET',
      `${API}/notes/`,
      new Response(`see https://glitchtip.com/support#sub=LICENSE-KEY-123 and ${TOKEN}`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    );
    for (const format of FORMATS) {
      const { text } = await call(mock, 'api_get', { path: 'notes', format });
      expect(text).not.toContain('LICENSE-KEY-123');
      expect(text).not.toContain(TOKEN);
      expect(text).toContain('https://glitchtip.com/support#[redacted]');
    }
  });

  it('blanks secret pairs in a JSON-declared body that does not parse', async () => {
    const mock = new MockGlitchTip().on(
      'GET',
      `${API}/broken/`,
      new Response('{"clientSecret": "BROKEN_SECRET", "a": ', {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { text, isError } = await call(mock, 'api_get', { path: 'broken' });
    expect(isError).toBe(false);
    expect(text).toContain('did not parse');
    expect(text).not.toContain('BROKEN_SECRET');
  });

  it('blanks number, object and array values of secret keys in an unparsed body', async () => {
    const raw =
      '{"endpointID": 90817263, "secret": {"a": "OBJ_SECRET", "b": {"c": "}"}}, ' +
      '"api_key": ["ARR_SECRET", "x"], "after": "KEPT_VALUE", "token": "cut-off';
    const mock = new MockGlitchTip().on(
      'GET',
      `${API}/broken/`,
      new Response(raw, { headers: { 'content-type': 'application/json' } }),
    );
    const { text } = await call(mock, 'api_get', { path: 'broken' });
    for (const secret of ['90817263', 'OBJ_SECRET', 'ARR_SECRET', 'cut-off']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('"after": "KEPT_VALUE"');
    expect(text).toContain('"api_key": "[redacted]"');
  });

  it('removes the token from a 400 whose detail echoes it', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/things/`,
      { detail: `bad token ${TOKEN}` },
      { status: 400 },
    );
    const { text, isError, logs } = await call(mock, 'api_request', {
      method: 'POST',
      path: 'things',
      body: { a: 1 },
      confirm: 'POST /api/0/things/',
    });
    expect(isError).toBe(true);
    expect(text).toContain('GlitchTip rejected POST /api/0/things/ (400)');
    expect(text).not.toContain(TOKEN);
    expect(logs).not.toContain(TOKEN);
  });

  it('removes key-scrubbed secrets from an error detail', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/things/`,
      { detail: { clientSecret: 'ERR_SECRET_42', field: 'x' } },
      { status: 422 },
    );
    const { text, isError } = await call(mock, 'api_get', { path: 'things' });
    expect(isError).toBe(true);
    expect(text).not.toContain('ERR_SECRET_42');
  });

  it('never echoes the request body in a result or an error', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/things/`,
      { detail: 'nope' },
      { status: 400 },
    );
    const { text } = await call(mock, 'api_request', {
      method: 'POST',
      path: 'things',
      body: { note: 'BODY_MARKER_1' },
      confirm: 'POST /api/0/things/',
    });
    expect(text).not.toContain('BODY_MARKER_1');
    expect(mock.requests[0].body).toContain('BODY_MARKER_1');
  });

  it.each([
    ['401', 401],
    ['403', 403],
    ['404', 404],
    ['429', 429],
    ['500', 500],
    ['503', 503],
    ['302', 302],
  ])('keeps the token out of results and logs on a %s', async (_, status) => {
    const mock = new MockGlitchTip().on(
      'GET',
      `${API}/things/`,
      () =>
        new Response(JSON.stringify({ detail: `echo ${TOKEN} Bearer ${TOKEN}` }), {
          status,
          headers: { 'content-type': 'application/json', location: `https://x.test/?t=${TOKEN}` },
        }),
    );
    const { text, isError, logs } = await call(mock, 'api_get', { path: 'things' });
    expect(isError).toBe(true);
    expect(text).not.toContain(TOKEN);
    expect(logs).not.toContain(TOKEN);
  });

  it('keeps the token out on a timeout and on an unreachable instance', async () => {
    const unreachable = new MockGlitchTip();
    const first = await call(unreachable, 'api_get', { path: 'nowhere' });
    expect(first.isError).toBe(true);
    expect(`${first.text}${first.logs}`).not.toContain(TOKEN);

    const slow = new MockGlitchTip().on('GET', `${API}/slow/`, (request) => {
      void request;
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });
    const second = await call(slow, 'api_get', { path: 'slow' });
    expect(second.isError).toBe(true);
    expect(second.text).toContain('did not answer');
    expect(`${second.text}${second.logs}`).not.toContain(TOKEN);
  });
});
