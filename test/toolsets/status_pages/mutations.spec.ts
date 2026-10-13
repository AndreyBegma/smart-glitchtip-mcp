import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { jsonResponse, MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 3: create_status_page — method/path/body assertions, the "no monitors attached" line.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    {
      GLITCHTIP_TOKEN: TOKEN,
      GLITCHTIP_TOOLSETS: 'status_pages',
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
  return { text: resultText(result), isError: result.isError === true };
}

describe('create_status_page', () => {
  it('sends name and isPublic, defaulting public to false', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/status-pages/`,
      jsonResponse({ name: 'Status', isPublic: false, slug: 'status', monitors: [] }, 201),
    );
    const { text } = await call(mock, 'create_status_page', {
      organization: 'acme',
      name: 'Status',
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({ name: 'Status', isPublic: false });
    expect(text).toContain('Created status page in acme.');
    expect(text).toContain('<untrusted source="glitchtip-config" field="name">Status</untrusted>');
    expect(text).toContain(`url: ${GLITCHTIP}/status-pages/acme/status/`);
    expect(text).toContain('No monitors attached — add them in the GlitchTip UI.');
  });

  it('sends isPublic: true when public is requested', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/status-pages/`,
      jsonResponse({ name: 'Status', isPublic: true, slug: 'status', monitors: [] }, 201),
    );
    await call(mock, 'create_status_page', { organization: 'acme', name: 'Status', public: true });
    expect(JSON.parse(mock.requests[0].body)).toEqual({ name: 'Status', isPublic: true });
  });

  it('rejects an empty name before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(mock, 'create_status_page', {
      organization: 'acme',
      name: '',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });
});
