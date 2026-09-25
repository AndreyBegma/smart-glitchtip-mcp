import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { jsonResponse, MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 2a, 3, 4a, 5 and 7: create/update/delete project against a mocked GlitchTip, the
// update merge, the create-time DSN fetch (and its failure path), and the delete confirmation.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const CURRENT_PROJECT = {
  id: '1',
  slug: 'web',
  name: 'Web',
  platform: 'python',
  eventThrottleRate: 5,
  dateCreated: '2026-01-02T03:04:05Z',
  firstEvent: null,
  scrubIPAddresses: false,
  isPublic: false,
  isBookmarked: false,
  organization: { slug: 'acme' },
};

const CREATED_PROJECT = {
  id: '2',
  slug: 'new-service',
  name: 'New Service',
  platform: 'javascript-react',
  eventThrottleRate: 0,
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

describe('create_project', () => {
  it('posts to the team, and returns the DSN fetched right after (acceptance 5)', async () => {
    const mock = new MockGlitchTip()
      .on('POST', `${API}/teams/acme/core/projects/`, jsonResponse(CREATED_PROJECT, 201))
      .json('GET', `${API}/projects/acme/new-service/keys/`, [
        { id: 'k1', dsn: { public: 'https://public@glitchtip.test/2' } },
      ]);
    const { text, isError } = await call(mock, 'create_project', {
      organization: 'acme',
      team: 'core',
      name: 'New Service',
      platform: 'javascript-react',
    });
    expect(isError).toBe(false);
    expect(text).toContain('Created project new-service (New Service).');
    expect(text).toContain('dsn.public: https://public@glitchtip.test/2');
    expect(JSON.parse(mock.requests[0].body)).toEqual({
      name: 'New Service',
      platform: 'javascript-react',
    });
  });

  it('still succeeds when the DSN follow-up fails (acceptance 2a)', async () => {
    const mock = new MockGlitchTip()
      .on('POST', `${API}/teams/acme/core/projects/`, jsonResponse(CREATED_PROJECT, 201))
      .json('GET', `${API}/projects/acme/new-service/keys/`, {}, { status: 401 });
    const { text, isError } = await call(mock, 'create_project', {
      organization: 'acme',
      team: 'core',
      name: 'New Service',
    });
    expect(isError).toBe(false);
    expect(text).toContain('Created project new-service (New Service).');
    expect(text).toContain(
      'DSN fetch failed: The GlitchTip token was rejected (401). Check the token.; call list_project_keys(project)',
    );
  });

  it('maps 403 to the write scopes', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/teams/acme/core/projects/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'create_project', {
      organization: 'acme',
      team: 'core',
      name: 'New Service',
    });
    expect(text).toContain('It needs one of: project:write, project:admin.');
  });
});

describe('update_project', () => {
  it('with only platform changed, re-sends the current name/slug/eventThrottleRate (acceptance 4a)', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/`, CURRENT_PROJECT)
      .json('PUT', `${API}/projects/acme/web/`, { ...CURRENT_PROJECT, platform: 'go' });
    const { text } = await call(mock, 'update_project', {
      organization: 'acme',
      project: 'web',
      platform: 'go',
    });
    expect(text).toContain('Updated project web.');
    expect(mock.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      name: 'Web',
      slug: 'web',
      platform: 'go',
      eventThrottleRate: 5,
    });
  });

  // BUG-20260925-017: ProjectIn is full-replace, so a field the GET left out would be cleared.
  for (const [field, param] of [
    ['name', 'name'],
    ['slug', 'new_slug'],
    ['platform', 'platform'],
    ['eventThrottleRate', 'event_throttle_rate'],
  ] as const) {
    it(`refuses, without a PUT, when the GET did not return ${field} and it was not given`, async () => {
      const { [field]: _omitted, ...partial } = CURRENT_PROJECT;
      const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/`, partial);
      const changed =
        field === 'eventThrottleRate' ? { platform: 'go' } : { event_throttle_rate: 1 };
      const { text, isError } = await call(mock, 'update_project', {
        organization: 'acme',
        project: 'web',
        ...changed,
      });
      expect(isError).toBe(true);
      expect(text).toContain(`GlitchTip's response did not include ${field}`);
      expect(text).toContain(`pass \`${param}\` explicitly`);
      expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
    });
  }

  it('sends a field the GET left out when the caller gives it', async () => {
    const { platform: _omitted, ...partial } = CURRENT_PROJECT;
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/`, partial)
      .json('PUT', `${API}/projects/acme/web/`, { ...CURRENT_PROJECT, platform: 'go' });
    const { isError } = await call(mock, 'update_project', {
      organization: 'acme',
      project: 'web',
      platform: 'go',
    });
    expect(isError).toBe(false);
    expect(JSON.parse(mock.requests[1].body).platform).toBe('go');
  });

  it('re-sends a null the GET returned as null', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/`, { ...CURRENT_PROJECT, platform: null })
      .json('PUT', `${API}/projects/acme/web/`, { ...CURRENT_PROJECT, platform: null });
    await call(mock, 'update_project', { organization: 'acme', project: 'web', name: 'Web 2' });
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      name: 'Web 2',
      slug: 'web',
      platform: null,
      eventThrottleRate: 5,
    });
  });

  it('refuses when no field is given, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'update_project', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('maps 403 on the PUT to the write scopes', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/`, CURRENT_PROJECT)
      .json('PUT', `${API}/projects/acme/web/`, {}, { status: 403 });
    const { text } = await call(mock, 'update_project', {
      organization: 'acme',
      project: 'web',
      platform: 'go',
    });
    expect(text).toContain('It needs one of: project:write, project:admin.');
  });
});

describe('delete_project', () => {
  it('refuses a wrong confirm without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'delete_project', {
      organization: 'acme',
      project: 'web',
      confirm: 'web-prod',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the project slug "web"');
    expect(mock.requests).toHaveLength(0);
  });

  it('deletes when confirm matches', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/projects/acme/web/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'delete_project', {
      organization: 'acme',
      project: 'web',
      confirm: 'web',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Deleted project web.');
  });

  it('maps 403 to project:admin', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/projects/acme/web/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'delete_project', {
      organization: 'acme',
      project: 'web',
      confirm: 'web',
    });
    expect(text).toContain('It needs one of: project:admin.');
  });
});
