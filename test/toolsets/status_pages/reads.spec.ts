import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 2, 3, 8: list_status_pages — the all-organizations notice, the org-attribution URL
// rule, method/path/query assertions, error paths.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';
const NOTICE =
  'GlitchTip lists status pages from all organizations you are a member of; this list is not ' +
  'limited to acme.';

const PAGE = {
  name: 'Public status',
  isPublic: true,
  slug: 'public-status',
  monitors: [
    {
      id: 1,
      name: 'API',
      monitorType: 'GET',
      isUp: true,
      organizationID: 42,
      lastChange: null,
      heartbeatEndpoint: null,
      expectedStatus: 200,
      interval: 60,
      confirmationThreshold: 1,
      checks: [],
    },
  ],
};

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'status_pages', ...env },
    mock,
  );
  return booted.client;
}

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>, env = {}) {
  const client = await boot(mock, env);
  const result = await client.callTool({ name, arguments: args });
  return { result, text: resultText(result), isError: result.isError === true };
}

describe('list_status_pages', () => {
  it('shows the public URL when a monitor on the page matches the requested org', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/status-pages/`, [PAGE])
      .json('GET', `${API}/organizations/acme/`, { id: '42', name: 'Acme' });
    const { text } = await call(mock, 'list_status_pages', { organization: 'acme' });
    expect(text).toContain(
      '<untrusted source="glitchtip-config" field="name">Public status</untrusted>',
    );
    expect(text).toContain('slug: public-status');
    expect(text).toContain('visibility: public');
    expect(text).toContain(`url: ${GLITCHTIP}/status-pages/acme/public-status/`);
    expect(text).toContain('1');
    expect(text).toContain(NOTICE);
    expect(mock.requests[0].url.pathname).toBe('/api/0/organizations/acme/status-pages/');
  });

  it('omits the URL when no monitor on the page matches the requested org', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/status-pages/`, [PAGE])
      .json('GET', `${API}/organizations/acme/`, { id: '99', name: 'Acme' });
    const { text } = await call(mock, 'list_status_pages', { organization: 'acme' });
    expect(text).not.toContain('url:');
  });

  it('does not look up the organization id when no page has monitors', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/status-pages/`, [
      { ...PAGE, monitors: [] },
    ]);
    const { text } = await call(mock, 'list_status_pages', { organization: 'acme' });
    expect(text).not.toContain('url:');
    expect(mock.requests).toHaveLength(1);
  });

  it('carries the all-organizations notice even when there are no status pages', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/status-pages/`, []);
    const { text, isError } = await call(mock, 'list_status_pages', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toBe(`No status pages visible to this token.\n${NOTICE}`);
  });

  it('returns projected json fenced as glitchtip-config', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/status-pages/`, [PAGE])
      .json('GET', `${API}/organizations/acme/`, { id: '42', name: 'Acme' });
    const { text } = await call(mock, 'list_status_pages', {
      organization: 'acme',
      format: 'json',
    });
    expect(text).toMatch(/^<untrusted source="glitchtip-config" field="status_pages">/);
    const parsed = JSON.parse(text.replace(/^<untrusted[^>]*>/, '').replace(/<\/untrusted>$/, ''));
    expect(parsed.statusPages[0]).toMatchObject({
      name: 'Public status',
      slug: 'public-status',
      public: true,
      url: `${GLITCHTIP}/status-pages/acme/public-status/`,
    });
    expect(parsed.allOrganizationsNotice).toBe(NOTICE);
  });

  it('maps 404 to the instance-disabled hint only', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/status-pages/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'list_status_pages', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toBe(
      'If no monitor path works at all, uptime monitoring may be disabled on this instance ' +
        '(GLITCHTIP_ENABLE_UPTIME).',
    );
  });

  it('is malformed, not an empty list, when GlitchTip answers with an object', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/status-pages/`, {
      results: [],
    });
    const { text, isError } = await call(mock, 'list_status_pages', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(/^GlitchTip answered list status pages with something other than a list/);
  });
});
