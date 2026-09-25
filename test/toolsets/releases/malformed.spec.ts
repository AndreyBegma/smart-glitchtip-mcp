import { afterEach, describe, expect, it } from 'vitest';
import malformedCommit from '../../fixtures/releases/malformed-commit.json';
import malformedDeploy from '../../fixtures/releases/malformed-deploy.json';
import malformedFile from '../../fixtures/releases/malformed-file.json';
import malformedRelease from '../../fixtures/releases/malformed-release.json';
import malformedReleaseFile from '../../fixtures/releases/malformed-release-file.json';
import malformedReleaseList from '../../fixtures/releases/malformed-release-list.json';
import malformedRepository from '../../fixtures/releases/malformed-repository.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 11: each read tool degrades a partial GlitchTip response (text result, gaps marked,
// isError: false) and reports a structural break as `malformed`, never "Internal error".

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>) {
  booted = await bootInMemory({ GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'releases' }, mock);
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('degraded responses (part 1 of acceptance 11)', () => {
  it('list_releases tolerates null projects/counts without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/`,
      malformedReleaseList,
    );
    const { text, isError } = await call(mock, 'list_releases', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toContain('1.0.0');
    expect(text).not.toContain('undefined');
  });

  it('get_release tolerates null ref/url/repository/counts without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/`,
      malformedRelease,
    );
    const { text, isError } = await call(mock, 'get_release', {
      organization: 'acme',
      version: '1.0.0',
    });
    expect(isError).toBe(false);
    expect(text).toContain('version:');
    expect(text).not.toContain('undefined');
  });

  it('list_release_deploys tolerates null id/environment/url/dates without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/deploys/`,
      malformedDeploy,
    );
    const { text, isError } = await call(mock, 'list_release_deploys', {
      organization: 'acme',
      version: '1.0.0',
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('undefined');
  });

  it('list_release_commits tolerates null message/author without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/commits/`,
      malformedCommit,
    );
    const { text, isError } = await call(mock, 'list_release_commits', {
      organization: 'acme',
      version: '1.0.0',
    });
    expect(isError).toBe(false);
    expect(text).toContain('abc123');
    expect(text).not.toContain('undefined');
  });

  it('list_release_files tolerates null sha1/name/size without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/files/`,
      malformedFile,
    );
    const { text, isError } = await call(mock, 'list_release_files', {
      organization: 'acme',
      version: '1.0.0',
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('undefined');
  });

  it('get_release_file tolerates null headers/name/sha1/size without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/projects/acme/web/releases/1.0.0/files/1/`,
      malformedReleaseFile,
    );
    const { text, isError } = await call(mock, 'get_release_file', {
      organization: 'acme',
      version: '1.0.0',
      project: 'web',
      file_id: 1,
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('undefined');
  });

  it('list_repositories tolerates null url/status/provider without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/repos/`,
      malformedRepository,
    );
    const { text, isError } = await call(mock, 'list_repositories', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).not.toContain('undefined');
  });
});

describe('structural breaks (part 2 of acceptance 11)', () => {
  it('list_releases: a non-array body is malformed, not an empty list', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/releases/`, {
      results: [],
    });
    const { text, isError } = await call(mock, 'list_releases', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).not.toContain('Internal error');
    expect(text).toMatch(/^GlitchTip answered list releases with something other than a list/);
  });

  it('get_release: projects sent as an object is a malformed error naming the tool', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/releases/1.0.0/`, {
      version: '1.0.0',
      dateCreated: 'x',
      dateReleased: null,
      shortVersion: '1.0.0',
      projects: {},
    });
    const { text, isError } = await call(mock, 'get_release', {
      organization: 'acme',
      version: '1.0.0',
    });
    expect(isError).toBe(true);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('get_release');
  });

  it('list_release_deploys: a non-array body is a malformed error naming the tool', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/deploys/`,
      { not: 'an array' },
    );
    const { text, isError } = await call(mock, 'list_release_deploys', {
      organization: 'acme',
      version: '1.0.0',
    });
    expect(isError).toBe(true);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('list_release_deploys');
  });

  it('list_release_commits: a non-array body is a malformed error naming the tool', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/commits/`,
      { not: 'an array' },
    );
    const { text, isError } = await call(mock, 'list_release_commits', {
      organization: 'acme',
      version: '1.0.0',
    });
    expect(isError).toBe(true);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('list_release_commits');
  });

  it('list_release_files: a non-array body is malformed, not an empty list', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/files/`,
      { results: [] },
    );
    const { text, isError } = await call(mock, 'list_release_files', {
      organization: 'acme',
      version: '1.0.0',
    });
    expect(isError).toBe(true);
    expect(text).not.toContain('Internal error');
    expect(text).toMatch(/^GlitchTip answered list release files with something other than a list/);
  });

  it('get_release_file: a non-string header value is a malformed error naming the tool', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/projects/acme/web/releases/1.0.0/files/1/`,
      {
        id: '1',
        dateCreated: 'x',
        name: 'a.map',
        size: 1,
        headers: { 'X-Weird': 123 },
      },
    );
    const { text, isError } = await call(mock, 'get_release_file', {
      organization: 'acme',
      version: '1.0.0',
      project: 'web',
      file_id: 1,
    });
    expect(isError).toBe(true);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('get_release_file');
  });

  it('list_repositories: a non-array body is malformed, not an empty list', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/repos/`, {
      results: [],
    });
    const { text, isError } = await call(mock, 'list_repositories', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).not.toContain('Internal error');
    expect(text).toMatch(/^GlitchTip answered list repositories with something other than a list/);
  });
});
