import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 4: `project` switches list_releases/get_release/list_release_files/delete_release/
// delete_release_file to the project-scoped path; a version with reserved characters is percent-
// encoded as one path segment; the path-segment rule rejects unsafe versions before any request,
// on a read tool and on delete_release.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const REJECTED_VERSIONS = ['', '.', '..', '...', 'a/b', 'a\\b', 'a%2Fb', '1.0%', 'a\u0000b'];

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'releases', GLITCHTIP_READ_ONLY: 'false' },
    mock,
  );
  return booted.client;
}

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>) {
  const client = await boot(mock);
  const result = await client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('path-segment rule (acceptance 4)', () => {
  for (const version of REJECTED_VERSIONS) {
    it(`rejects ${JSON.stringify(version)} on a read tool (get_release) without a request`, async () => {
      const mock = new MockGlitchTip();
      const { isError } = await call(mock, 'get_release', { organization: 'acme', version });
      expect(isError).toBe(true);
      expect(mock.requests).toHaveLength(0);
    });

    it(`rejects ${JSON.stringify(version)} on delete_release without a request`, async () => {
      const mock = new MockGlitchTip();
      const { isError } = await call(mock, 'delete_release', {
        organization: 'acme',
        version,
        confirm: version,
      });
      expect(isError).toBe(true);
      expect(mock.requests).toHaveLength(0);
    });
  }

  it('sends a version with reserved characters percent-encoded as one path segment', async () => {
    const version = '1.0.0+build 5';
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/${encodeURIComponent(version)}/`,
      { version, dateCreated: 'x', dateReleased: null, shortVersion: version, projects: [] },
    );
    const { isError } = await call(mock, 'get_release', { organization: 'acme', version });
    expect(isError).toBe(false);
    expect(mock.requests).toHaveLength(1);
    const segments = mock.requests[0].url.pathname.split('/');
    expect(segments).toHaveLength('/api/0/organizations/acme/releases/x/'.split('/').length);
    expect(decodeURIComponent(segments[6])).toBe(version);
  });
});
