import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { jsonResponse, MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 11 and 12: each tool against a mocked GlitchTip, its error path,
// default-organization resolution and the delete confirmation.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const ORG_DETAIL = {
  id: '1',
  slug: 'acme',
  name: 'Acme',
  dateCreated: '2026-01-02T03:04:05Z',
  status: { id: 'active', name: 'active' },
  avatar: {},
  isEarlyAdopter: false,
  require2fa: false,
  isAcceptingEvents: true,
  eventThrottleRate: 0,
  openMembership: true,
  access: ['org:read', 'project:read'],
  projects: [
    { slug: 'web', name: 'Web', teams: [] },
    { slug: 'api', name: 'API', teams: [] },
  ],
  teams: [
    { id: '1', slug: 'core', dateCreated: '2026-01-02T03:04:05Z', isMember: true, memberCount: 3 },
  ],
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
      GLITCHTIP_TOOLSETS: 'organizations',
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

describe('whoami', () => {
  it('shows instance, version, user, scopes and the auto-selected organization', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/`, {
        version: '6.2.6',
        user: { id: '1', email: 'me@example.com', name: 'Me' },
        auth: {
          id: 9,
          label: 'mcp',
          scopes: ['org:read', 'event:read'],
          token: TOKEN,
          created: 'x',
        },
      })
      .json('GET', `${API}/organizations/`, [{ slug: 'acme' }]);
    const { text, isError } = await call(mock, 'whoami', {});
    expect(isError).toBe(false);
    expect(text).toContain(`instance: ${GLITCHTIP}`);
    expect(text).toContain('version: 6.2.6');
    expect(text).toContain('user: Me <me@example.com>');
    expect(text).toContain('token scopes: org:read, event:read');
    expect(text).toContain('default organization: acme');
    expect(text).not.toContain(TOKEN);
  });

  it('never returns the token GlitchTip echoes in the API root, even as json', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/`, {
        version: '6.2.6',
        user: null,
        auth: { id: 9, label: 'mcp', scopes: [], token: TOKEN, created: 'x' },
      })
      .json('GET', `${API}/organizations/`, []);
    const { text } = await call(mock, 'whoami', { format: 'json' });
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toMatchObject({ user: null, scopes: [] });
  });

  it('still answers when the default organization is ambiguous', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/`, { version: '6.2.6', user: null, auth: null })
      .json('GET', `${API}/organizations/`, [{ slug: 'a' }, { slug: 'b' }]);
    const { text, isError } = await call(mock, 'whoami', {});
    expect(isError).toBe(false);
    expect(text).toContain('default organization: none — 2 visible, pass organization');
    expect(text).toContain('token scopes: no token in use');
  });

  it('reports the lookup failure without failing', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/`, { version: '6.2.6', user: null, auth: null })
      .json('GET', `${API}/organizations/`, {}, { status: 401 });
    const { text, isError } = await call(mock, 'whoami', {});
    expect(isError).toBe(false);
    expect(text).toContain(
      'default organization: unavailable (The GlitchTip token was rejected (401)',
    );
  });
});

describe('list_organizations', () => {
  it('renders a table with the next cursor and sends limit/cursor', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/`,
      [
        { slug: 'acme', name: 'Acme', dateCreated: '2026-01-02T03:04:05Z' },
        { slug: 'beta', name: 'Beta Corp', dateCreated: '2026-02-03T00:00:00Z' },
      ],
      {
        headers: {
          link: `<${API}/organizations/?cursor=n>; rel="next"; results="true"; cursor="0:2:0"`,
        },
      },
    );
    const { text } = await call(mock, 'list_organizations', { limit: 2, cursor: 'c0' });
    expect(text).toBe(
      [
        'slug  name       created',
        'acme  Acme       2026-01-02',
        'beta  Beta Corp  2026-02-03',
        'next cursor: 0:2:0',
      ].join('\n'),
    );
    expect(mock.requests[0].url.searchParams.get('limit')).toBe('2');
    expect(mock.requests[0].url.searchParams.get('cursor')).toBe('c0');
  });

  it('says so when the list is empty, without isError', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, []);
    const { text, isError } = await call(mock, 'list_organizations', {});
    expect(isError).toBe(false);
    expect(text).toBe('No organizations visible to this token.');
  });

  it('returns projected json', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, [
      { slug: 'acme', name: 'Acme', dateCreated: '2026-01-02T03:04:05Z', isEarlyAdopter: true },
    ]);
    const { text } = await call(mock, 'list_organizations', { format: 'json' });
    expect(JSON.parse(text)).toEqual({
      organizations: [{ slug: 'acme', name: 'Acme', dateCreated: '2026-01-02T03:04:05Z' }],
      nextCursor: null,
    });
  });

  it('turns a 401 into an actionable tool error', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, {}, { status: 401 });
    const { text, isError } = await call(mock, 'list_organizations', {});
    expect(isError).toBe(true);
    expect(text).toBe('The GlitchTip token was rejected (401). Check the token.');
  });

  it('refuses an out-of-range limit before calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'list_organizations', { limit: 500 });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });
});

describe('get_organization', () => {
  it('shows projects, teams and access', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/`, ORG_DETAIL);
    const { text } = await call(mock, 'get_organization', { organization: 'acme' });
    expect(text).toContain('slug: acme');
    expect(text).toContain('your access: org:read, project:read');
    expect(text).toContain('projects: 2 (web, api)');
    expect(text).toContain('teams: 1 (core)');
  });

  it('auto-selects the only visible organization', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/`, [{ slug: 'acme' }])
      .json('GET', `${API}/organizations/acme/`, ORG_DETAIL);
    const { text, isError } = await call(mock, 'get_organization', {});
    expect(isError).toBe(false);
    expect(text).toContain('slug: acme');
  });

  it('lists the slugs when several organizations are visible', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, [
      { slug: 'acme' },
      { slug: 'beta' },
    ]);
    const { text, isError } = await call(mock, 'get_organization', {});
    expect(isError).toBe(true);
    expect(text).toBe(
      'Several organizations are visible to this token (acme, beta); pass `organization`.',
    );
  });

  it('uses GLITCHTIP_DEFAULT_ORG without a lookup', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/`, ORG_DETAIL);
    await call(mock, 'get_organization', {}, { GLITCHTIP_DEFAULT_ORG: 'acme' });
    expect(mock.requests.map((r) => r.url.pathname)).toEqual(['/api/0/organizations/acme/']);
  });

  it('maps 404 to a not-found message naming the organization', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/nope/`, {}, { status: 404 });
    const { text, isError } = await call(mock, 'get_organization', { organization: 'nope' });
    expect(isError).toBe(true);
    expect(text).toBe('Organization nope was not found.');
  });

  it('maps 403 to the scopes it needs', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/`, {}, { status: 403 });
    const { text } = await call(mock, 'get_organization', { organization: 'acme' });
    expect(text).toBe(
      'The token lacks permission for get organization. It needs one of: org:read, org:write, org:admin.',
    );
  });
});

describe('list_organization_environments', () => {
  it('lists names and passes visibility', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/environments/`, [
      { id: 1, name: 'production' },
      { id: 2, name: 'staging' },
    ]);
    const { text } = await call(mock, 'list_organization_environments', {
      organization: 'acme',
      visibility: 'all',
    });
    expect(text).toBe('production\nstaging');
    expect(mock.requests[0].url.searchParams.get('visibility')).toBe('all');
  });

  it('says so when there are none', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/environments/`, []);
    const { text } = await call(mock, 'list_organization_environments', { organization: 'acme' });
    expect(text).toBe('No environments in acme (visibility: visible).');
  });

  it('maps 404', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/gone/environments/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'list_organization_environments', {
      organization: 'gone',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Organization gone was not found.');
  });
});

describe('create_organization', () => {
  it('posts the name and confirms', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/`,
      jsonResponse({ ...ORG_DETAIL, slug: 'new-co', name: 'New Co' }, 201),
    );
    const { text } = await call(mock, 'create_organization', { name: 'New Co' });
    expect(text).toBe('Created organization new-co (New Co).');
    expect(JSON.parse(mock.requests[0].body)).toEqual({ name: 'New Co' });
  });

  it('explains a 403 from an instance that disables creation', async () => {
    const mock = new MockGlitchTip().json('POST', `${API}/organizations/`, {}, { status: 403 });
    const { isError, text } = await call(mock, 'create_organization', { name: 'X' });
    expect(isError).toBe(true);
    expect(text).toContain('lacks permission for create organization');
  });
});

describe('update_organization', () => {
  it('renames through PUT', async () => {
    const mock = new MockGlitchTip().json('PUT', `${API}/organizations/acme/`, {
      ...ORG_DETAIL,
      name: 'Acme Inc',
    });
    const { text } = await call(mock, 'update_organization', {
      organization: 'acme',
      name: 'Acme Inc',
    });
    expect(text).toBe('Renamed organization acme to Acme Inc.');
    expect(JSON.parse(mock.requests[0].body)).toEqual({ name: 'Acme Inc' });
  });

  it('maps 403 to the write scopes', async () => {
    const mock = new MockGlitchTip().json('PUT', `${API}/organizations/acme/`, {}, { status: 403 });
    const { text } = await call(mock, 'update_organization', { organization: 'acme', name: 'n' });
    expect(text).toContain('It needs one of: org:write, org:admin.');
  });
});

describe('delete_organization', () => {
  it('deletes when confirm matches', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/organizations/acme/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'delete_organization', {
      organization: 'acme',
      confirm: 'acme',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Deleted organization acme.');
  });

  it('refuses when confirm does not equal organization, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'delete_organization', {
      organization: 'acme',
      confirm: 'acme-prod',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the organization slug "acme"');
    expect(mock.requests).toHaveLength(0);
  });

  it('requires organization: a destructive call never uses the default', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(
      mock,
      'delete_organization',
      { confirm: 'acme' },
      { GLITCHTIP_DEFAULT_ORG: 'acme' },
    );
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('maps 403 to org:admin', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/organizations/acme/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'delete_organization', {
      organization: 'acme',
      confirm: 'acme',
    });
    expect(text).toContain('It needs one of: org:admin.');
  });
});

describe('network failures', () => {
  it('become an unreachable tool error, not a crash', async () => {
    const mock = new MockGlitchTip().on('GET', `${API}/organizations/`, () => {
      throw new TypeError('fetch failed');
    });
    const { text, isError } = await call(mock, 'list_organizations', {});
    expect(isError).toBe(true);
    expect(text).toBe(`Could not reach ${GLITCHTIP}.`);
  });
});
