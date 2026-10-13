import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { jsonResponse, MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 3 and 6: each client-key tool against a mocked GlitchTip, its error path, and that
// list_project_keys shows dsn.public but never a dsn.secret line.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';
const KEY_ID = '11111111-1111-4111-8111-111111111111';

const KEY = {
  id: KEY_ID,
  name: 'Default',
  label: 'Default',
  dateCreated: '2026-01-02T03:04:05Z',
  rateLimit: { window: 60, count: 100 },
  dsn: {
    public: 'https://public@glitchtip.test/1',
    secret: 'https://secret@glitchtip.test/1',
    security: 'https://glitchtip.test/api/1/security/',
  },
  public: 'abc',
  projectID: 1,
};

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    {
      GLITCHTIP_TOKEN: TOKEN,
      GLITCHTIP_TOOLSETS: 'projects',
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

describe('list_project_keys', () => {
  it('shows dsn.public and dsn.security, never a dsn.secret line', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/keys/`, [KEY]);
    const { text } = await call(mock, 'list_project_keys', {
      organization: 'acme',
      project: 'web',
    });
    expect(text).toContain('dsn.public: https://public@glitchtip.test/1');
    expect(text).toContain('dsn.security: https://glitchtip.test/api/1/security/');
    expect(text).not.toContain('dsn.secret');
    expect(text).not.toContain('secret@glitchtip.test');
  });

  it('says so when there are none', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/keys/`, []);
    const { text, isError } = await call(mock, 'list_project_keys', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(false);
    expect(text).toBe('No client keys for this project.');
  });

  it('maps 404 to the project', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/projects/acme/gone/keys/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'list_project_keys', {
      organization: 'acme',
      project: 'gone',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Project gone was not found in acme.');
  });
});

describe('get_project_key', () => {
  it('shows the key detail', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/keys/${KEY_ID}/`, KEY);
    const { text } = await call(mock, 'get_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
    });
    expect(text).toContain('dsn.public: https://public@glitchtip.test/1');
    expect(text).not.toContain('dsn.secret');
  });

  it('maps 404 to the key', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/projects/acme/web/keys/${KEY_ID}/`,
      {},
      { status: 404 },
    );
    const { text } = await call(mock, 'get_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
    });
    expect(text).toBe(`Key ${KEY_ID} was not found in acme.`);
  });
});

describe('create_project_key', () => {
  it('posts label and rate_limit as name/rateLimit, returns the DSN', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/projects/acme/web/keys/`,
      jsonResponse(KEY, 201),
    );
    const { text } = await call(mock, 'create_project_key', {
      organization: 'acme',
      project: 'web',
      label: 'Default',
      rate_limit: { window: 60, count: 100 },
    });
    expect(text).toContain(`Created client key ${KEY_ID}.`);
    expect(text).toContain('dsn.public: https://public@glitchtip.test/1');
    expect(JSON.parse(mock.requests[0].body)).toEqual({
      name: 'Default',
      rateLimit: { window: 60, count: 100 },
    });
  });

  it('maps 403 to the write scopes', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/projects/acme/web/keys/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'create_project_key', {
      organization: 'acme',
      project: 'web',
    });
    expect(text).toContain('It needs one of: project:write, project:admin.');
  });
});

describe('update_project_key', () => {
  it('with only label changed, re-sends the current rateLimit (GET then PUT)', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/keys/${KEY_ID}/`, KEY)
      .json('PUT', `${API}/projects/acme/web/keys/${KEY_ID}/`, { ...KEY, name: 'Renamed' });
    const { text } = await call(mock, 'update_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      label: 'Renamed',
    });
    expect(text).toContain(`Updated client key ${KEY_ID}.`);
    expect(mock.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      name: 'Renamed',
      rateLimit: { window: 60, count: 100 },
    });
  });

  it('rate_limit: null clears the current rate limit', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/keys/${KEY_ID}/`, KEY)
      .json('PUT', `${API}/projects/acme/web/keys/${KEY_ID}/`, { ...KEY, rateLimit: null });
    await call(mock, 'update_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      rate_limit: null,
    });
    expect(JSON.parse(mock.requests[1].body)).toEqual({ name: 'Default', rateLimit: null });
  });

  // BUG-20260925-017: the key's canonical field is `label`; `name` may be absent.
  it('keeps the label on a rate-limit-only update when the GET carries only label', async () => {
    const { name: _omitted, ...labelOnly } = KEY;
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/keys/${KEY_ID}/`, labelOnly)
      .json('PUT', `${API}/projects/acme/web/keys/${KEY_ID}/`, KEY);
    await call(mock, 'update_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      rate_limit: { window: 60, count: 5 },
    });
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      name: 'Default',
      rateLimit: { window: 60, count: 5 },
    });
  });

  it('refuses, without a PUT, when the GET has neither name nor label and no label is given', async () => {
    const { name: _n, label: _l, ...nameless } = KEY;
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/projects/acme/web/keys/${KEY_ID}/`,
      nameless,
    );
    const { text, isError } = await call(mock, 'update_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      rate_limit: null,
    });
    expect(isError).toBe(true);
    expect(text).toContain("GlitchTip's response did not include label");
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('refuses, without a PUT, when the GET has a label and a name of the wrong type', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/keys/${KEY_ID}/`, {
      ...KEY,
      name: 7,
      label: ['Default'],
    });
    const { text, isError } = await call(mock, 'update_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      rate_limit: null,
    });
    expect(isError).toBe(true);
    expect(text).toContain("GlitchTip's response returned label as something other than");
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('uses label when name has the wrong type', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/keys/${KEY_ID}/`, { ...KEY, name: 7 })
      .json('PUT', `${API}/projects/acme/web/keys/${KEY_ID}/`, KEY);
    await call(mock, 'update_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      rate_limit: null,
    });
    expect(JSON.parse(mock.requests[1].body)).toEqual({ name: 'Default', rateLimit: null });
  });

  it('refuses, without a PUT, when the GET has a malformed rateLimit and none is given', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/keys/${KEY_ID}/`, {
      ...KEY,
      rateLimit: { window: '60' },
    });
    const { text, isError } = await call(mock, 'update_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      label: 'Renamed',
    });
    expect(isError).toBe(true);
    expect(text).toContain("GlitchTip's response returned rateLimit as something other than");
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('refuses, without a PUT, when the GET has no rateLimit and none is given', async () => {
    const { rateLimit: _omitted, ...partial } = KEY;
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/projects/acme/web/keys/${KEY_ID}/`,
      partial,
    );
    const { text, isError } = await call(mock, 'update_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      label: 'Renamed',
    });
    expect(isError).toBe(true);
    expect(text).toContain("GlitchTip's response did not include rateLimit");
    expect(text).toContain('pass `rate_limit` explicitly');
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('maps 403 to the write scopes', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/keys/${KEY_ID}/`, KEY)
      .json('PUT', `${API}/projects/acme/web/keys/${KEY_ID}/`, {}, { status: 403 });
    const { text } = await call(mock, 'update_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      label: 'x',
    });
    expect(text).toContain('It needs one of: project:write, project:admin.');
  });
});

describe('delete_project_key', () => {
  it('refuses a wrong confirm without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'delete_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      confirm: 'not-the-key-id',
    });
    expect(isError).toBe(true);
    expect(text).toContain(`confirm must equal the key id "${KEY_ID}"`);
    expect(mock.requests).toHaveLength(0);
  });

  it('deletes when confirm matches', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/projects/acme/web/keys/${KEY_ID}/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'delete_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      confirm: KEY_ID,
    });
    expect(isError).toBe(false);
    expect(text).toBe(`Deleted client key ${KEY_ID}.`);
  });

  it('maps 403 to project:admin', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/projects/acme/web/keys/${KEY_ID}/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'delete_project_key', {
      organization: 'acme',
      project: 'web',
      key_id: KEY_ID,
      confirm: KEY_ID,
    });
    expect(text).toContain('It needs one of: project:admin.');
  });
});
