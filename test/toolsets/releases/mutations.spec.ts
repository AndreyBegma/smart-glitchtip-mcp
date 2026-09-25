import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { jsonResponse, MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 5-9: update_release's read-merge-write, add_release_commits' merge, create_release's
// omit/null handling and "already existed" note, create_deploy's datetime validation, and the
// destructive tools' confirm guard.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const RELEASE = {
  ref: 'main',
  dateReleased: '2026-01-02T03:04:05Z',
  version: '1.0.0',
  dateCreated: '2026-01-01T00:00:00Z',
  shortVersion: '1.0.0',
  projects: [{ slug: 'web', name: 'Web' }],
  commitCount: 0,
  deployCount: 0,
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
      GLITCHTIP_TOOLSETS: 'releases',
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

describe('create_release', () => {
  it('omits dateReleased when not given and sends the given projects', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/releases/`,
      jsonResponse(RELEASE, 201),
    );
    await call(mock, 'create_release', {
      organization: 'acme',
      version: '1.0.0',
      projects: ['web'],
    });
    const body = JSON.parse(mock.requests[0].body);
    expect(body).toEqual({ version: '1.0.0', projects: ['web'] });
    expect(body).not.toHaveProperty('dateReleased');
  });

  it('sends dateReleased: null when given null', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/releases/`,
      jsonResponse({ ...RELEASE, dateReleased: null }, 201),
    );
    await call(mock, 'create_release', {
      organization: 'acme',
      version: '1.0.0',
      projects: ['web'],
      date_released: null,
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({
      version: '1.0.0',
      projects: ['web'],
      dateReleased: null,
    });
  });

  it('rejects duplicate projects before any request', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'create_release', {
      organization: 'acme',
      version: '1.0.0',
      projects: ['web', 'web'],
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('adds the "already existed" note when the response ref differs from the request', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/releases/`,
      jsonResponse({ ...RELEASE, ref: 'old-ref' }, 201),
    );
    const { text } = await call(mock, 'create_release', {
      organization: 'acme',
      version: '1.0.0',
      projects: ['web'],
      ref: 'new-ref',
    });
    expect(text).toContain(
      'The release already existed; its ref and release date were not changed — use update_release.',
    );
  });

  it('adds no note when the response matches the request', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/releases/`,
      jsonResponse({ ...RELEASE, ref: 'new-ref' }, 201),
    );
    const { text } = await call(mock, 'create_release', {
      organization: 'acme',
      version: '1.0.0',
      projects: ['web'],
      ref: 'new-ref',
    });
    expect(text).not.toContain('already existed');
  });

  it('rejects a version rejected by the path-segment rule before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'create_release', {
      organization: 'acme',
      version: 'a/b',
      projects: ['web'],
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it('does not add the note when the response date is the same instant in a different format', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/releases/`,
      jsonResponse({ ...RELEASE, dateReleased: '2026-01-02T03:04:05+00:00' }, 201),
    );
    const { text } = await call(mock, 'create_release', {
      organization: 'acme',
      version: '1.0.0',
      projects: ['web'],
      date_released: '2026-01-02T03:04:05Z',
    });
    expect(text).not.toContain('already existed');
  });

  it('adds the note when the response date is a genuinely different instant', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/releases/`,
      jsonResponse({ ...RELEASE, dateReleased: '2025-01-01T00:00:00Z' }, 201),
    );
    const { text } = await call(mock, 'create_release', {
      organization: 'acme',
      version: '1.0.0',
      projects: ['web'],
      date_released: '2026-01-02T03:04:05Z',
    });
    expect(text).toContain('already existed');
  });
});

describe('update_release', () => {
  it('with only ref changed: GET then PUT, dateReleased re-sent unchanged', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/releases/1.0.0/`, RELEASE)
      .json('PUT', `${API}/organizations/acme/releases/1.0.0/`, { ...RELEASE, ref: 'new' });
    await call(mock, 'update_release', { organization: 'acme', version: '1.0.0', ref: 'new' });
    expect(mock.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      ref: 'new',
      dateReleased: RELEASE.dateReleased,
    });
  });

  it('with only date_released changed: current ref is re-sent', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/releases/1.0.0/`, RELEASE)
      .json('PUT', `${API}/organizations/acme/releases/1.0.0/`, RELEASE);
    await call(mock, 'update_release', {
      organization: 'acme',
      version: '1.0.0',
      date_released: '2026-03-01T00:00:00Z',
    });
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      ref: RELEASE.ref,
      dateReleased: '2026-03-01T00:00:00Z',
    });
  });

  it('sends dateReleased: null explicitly when the current value is null', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/releases/1.0.0/`, { ...RELEASE, dateReleased: null })
      .json('PUT', `${API}/organizations/acme/releases/1.0.0/`, {
        ...RELEASE,
        ref: 'new',
        dateReleased: null,
      });
    await call(mock, 'update_release', { organization: 'acme', version: '1.0.0', ref: 'new' });
    const body = JSON.parse(mock.requests[1].body);
    expect(body).toHaveProperty('dateReleased', null);
  });

  it('refuses when neither ref nor date_released is given', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(mock, 'update_release', {
      organization: 'acme',
      version: '1.0.0',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('refuses without a PUT when the GET response omits ref and the caller did not supply one', async () => {
    const { ref: _ref, ...partial } = RELEASE;
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/`,
      partial,
    );
    const { isError, text } = await call(mock, 'update_release', {
      organization: 'acme',
      version: '1.0.0',
      date_released: '2026-03-01T00:00:00Z',
    });
    expect(isError).toBe(true);
    expect(text).toContain('did not include ref');
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe('GET');
  });

  it('refuses without a PUT when the GET response omits dateReleased and the caller did not supply one', async () => {
    const { dateReleased: _dateReleased, ...partial } = RELEASE;
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/`,
      partial,
    );
    const { isError, text } = await call(mock, 'update_release', {
      organization: 'acme',
      version: '1.0.0',
      ref: 'new-ref',
    });
    expect(isError).toBe(true);
    expect(text).toContain('did not include date_released');
    expect(mock.requests).toHaveLength(1);
  });

  it('proceeds when the caller supplies the field the GET response omits', async () => {
    const { ref: _ref, ...partial } = RELEASE;
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/releases/1.0.0/`, partial)
      .json('PUT', `${API}/organizations/acme/releases/1.0.0/`, { ...RELEASE, ref: 'new-ref' });
    const { isError } = await call(mock, 'update_release', {
      organization: 'acme',
      version: '1.0.0',
      ref: 'new-ref',
    });
    expect(isError).toBe(false);
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      ref: 'new-ref',
      dateReleased: RELEASE.dateReleased,
    });
  });
});

describe('delete_release', () => {
  it('deletes when confirm matches the version', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/organizations/acme/releases/1.0.0/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'delete_release', {
      organization: 'acme',
      version: '1.0.0',
      confirm: '1.0.0',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Deleted release 1.0.0 from acme.');
  });

  it('uses the project-scoped DELETE when project is given', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/projects/acme/web/releases/1.0.0/`,
      new Response(null, { status: 204 }),
    );
    await call(mock, 'delete_release', {
      organization: 'acme',
      version: '1.0.0',
      project: 'web',
      confirm: '1.0.0',
    });
    expect(mock.requests[0].url.pathname).toBe('/api/0/projects/acme/web/releases/1.0.0/');
  });

  it('refuses when confirm does not match, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'delete_release', {
      organization: 'acme',
      version: '1.0.0',
      confirm: '1.0.1',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the release version "1.0.0"');
    expect(mock.requests).toHaveLength(0);
  });

  it('rejects a dots-only version before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'delete_release', {
      organization: 'acme',
      version: '..',
      confirm: '..',
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('create_deploy', () => {
  it('records a deploy and confirms with the fenced environment', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/releases/1.0.0/deploys/`,
      jsonResponse(
        {
          id: 1,
          environment: 'production',
          url: '',
          dateStarted: null,
          dateFinished: null,
          dateCreated: '2026-01-01T00:00:00Z',
        },
        201,
      ),
    );
    const { text } = await call(mock, 'create_deploy', {
      organization: 'acme',
      version: '1.0.0',
      environment: 'production',
    });
    expect(JSON.parse(mock.requests[0].body)).toMatchObject({
      environment: 'production',
      url: '',
    });
    expect(text).toContain('Recorded a deploy of release 1.0.0.');
    expect(text).toContain(
      '<untrusted source="glitchtip-config" field="environment">production</untrusted>',
    );
  });

  it('rejects date_finished before date_started before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'create_deploy', {
      organization: 'acme',
      version: '1.0.0',
      environment: 'production',
      date_started: '2026-01-02T00:00:00Z',
      date_finished: '2026-01-01T00:00:00Z',
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it('rejects a non-ISO datetime before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'create_deploy', {
      organization: 'acme',
      version: '1.0.0',
      environment: 'production',
      date_started: 'not-a-date',
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('add_release_commits', () => {
  const EXISTING = [
    {
      id: 'a1',
      message: 'first',
      authorName: 'Dev',
      authorEmail: 'dev@example.test',
      dateCreated: 'x',
    },
    { id: 'a2', message: null, authorName: null, authorEmail: null, dateCreated: 'x' },
  ];

  it('performs GET then POST; unchanged commits are re-sent, null fields as "", new appended', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/releases/1.0.0/commits/`, EXISTING)
      .json('POST', `${API}/organizations/acme/releases/1.0.0/commits/`, {
        ...RELEASE,
        commitCount: 3,
      });
    const { text } = await call(mock, 'add_release_commits', {
      organization: 'acme',
      version: '1.0.0',
      commits: [{ id: 'a3', message: 'third' }],
    });
    expect(mock.requests.map((r) => r.method)).toEqual(['GET', 'POST']);
    expect(JSON.parse(mock.requests[1].body)).toEqual([
      { id: 'a1', message: 'first', authorName: 'Dev', authorEmail: 'dev@example.test' },
      { id: 'a2', message: '', authorName: '', authorEmail: '' },
      { id: 'a3', message: 'third', authorName: '', authorEmail: '' },
    ]);
    expect(text).toContain('Added 1, updated 0 commits on release 1.0.0 in acme.');
    expect(text).toContain('Release now has 3 commits.');
  });

  it('replaces an existing entry in place when the input id already exists', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/releases/1.0.0/commits/`, EXISTING)
      .json('POST', `${API}/organizations/acme/releases/1.0.0/commits/`, {
        ...RELEASE,
        commitCount: 2,
      });
    const { text } = await call(mock, 'add_release_commits', {
      organization: 'acme',
      version: '1.0.0',
      commits: [{ id: 'a1', message: 'updated message' }],
    });
    const body = JSON.parse(mock.requests[1].body);
    expect(body).toEqual([
      { id: 'a1', message: 'updated message', authorName: '', authorEmail: '' },
      { id: 'a2', message: '', authorName: '', authorEmail: '' },
    ]);
    expect(text).toContain('Added 0, updated 1 commits on release 1.0.0 in acme.');
  });

  it('rejects duplicate input ids before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'add_release_commits', {
      organization: 'acme',
      version: '1.0.0',
      commits: [{ id: 'a1' }, { id: 'a1' }],
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it('dedupes a stored list that already has a duplicate id, keeping the last occurrence', async () => {
    const duplicated = [
      { id: 'a1', message: 'stale', authorName: 'Old', authorEmail: 'old@example.test' },
      { id: 'a2', message: 'kept', authorName: 'Dev', authorEmail: 'dev@example.test' },
      { id: 'a1', message: 'fresh', authorName: 'New', authorEmail: 'new@example.test' },
    ];
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/releases/1.0.0/commits/`, duplicated)
      .json('POST', `${API}/organizations/acme/releases/1.0.0/commits/`, {
        ...RELEASE,
        commitCount: 2,
      });
    await call(mock, 'add_release_commits', {
      organization: 'acme',
      version: '1.0.0',
      commits: [{ id: 'a3', message: 'new one' }],
    });
    const body = JSON.parse(mock.requests[1].body);
    expect(body).toEqual([
      { id: 'a1', message: 'fresh', authorName: 'New', authorEmail: 'new@example.test' },
      { id: 'a2', message: 'kept', authorName: 'Dev', authorEmail: 'dev@example.test' },
      { id: 'a3', message: 'new one', authorName: '', authorEmail: '' },
    ]);
  });

  // BUG-20260925-017: the POST replaces the stored list, so a commit left out of it is deleted.
  it('refuses, without a POST, when a stored commit id is not a string (never drops it)', async () => {
    const malformed = [
      { id: 12345, message: 'numeric id', authorName: 'Dev', authorEmail: 'dev@example.test' },
      { id: 'a1', message: 'ok', authorName: 'Dev', authorEmail: 'dev@example.test' },
    ];
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/commits/`,
      malformed,
    );
    const { text, isError } = await call(mock, 'add_release_commits', {
      organization: 'acme',
      version: '1.0.0',
      commits: [{ id: 'a2', message: 'new one' }],
    });
    expect(isError).toBe(true);
    expect(text).toContain('stored commit 1 has an id that is not a string');
    expect(text).not.toContain('Skipped');
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
  });

  for (const [field, param] of [
    ['message', 'message'],
    ['authorName', 'author_name'],
    ['authorEmail', 'author_email'],
  ] as const) {
    it(`refuses, without a POST, when a stored commit has no ${field}`, async () => {
      const { [field]: _omitted, ...partial } = EXISTING[0];
      const mock = new MockGlitchTip().json(
        'GET',
        `${API}/organizations/acme/releases/1.0.0/commits/`,
        [partial, EXISTING[1]],
      );
      const { text, isError } = await call(mock, 'add_release_commits', {
        organization: 'acme',
        version: '1.0.0',
        commits: [{ id: 'a3' }],
      });
      expect(isError).toBe(true);
      expect(text).toContain(`GlitchTip's response did not include ${param} for stored commit 1`);
      expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
    });
  }

  it('accepts a partial stored commit the caller sends again, since it is replaced whole', async () => {
    const { authorEmail: _omitted, ...partial } = EXISTING[0];
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/releases/1.0.0/commits/`, [partial, EXISTING[1]])
      .json('POST', `${API}/organizations/acme/releases/1.0.0/commits/`, {
        ...RELEASE,
        commitCount: 2,
      });
    const { isError } = await call(mock, 'add_release_commits', {
      organization: 'acme',
      version: '1.0.0',
      commits: [{ id: 'a1', message: 'first', author_email: 'dev@example.test' }],
    });
    expect(isError).toBe(false);
    expect(JSON.parse(mock.requests[1].body)[0]).toEqual({
      id: 'a1',
      message: 'first',
      authorName: '',
      authorEmail: 'dev@example.test',
    });
  });

  it('refuses when the merged list would exceed 1000, after GET but before POST', async () => {
    const existing = Array.from({ length: 999 }, (_, i) => ({
      id: `e${i}`,
      message: 'm',
      authorName: null,
      authorEmail: null,
    }));
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/commits/`,
      existing,
    );
    const { text, isError } = await call(mock, 'add_release_commits', {
      organization: 'acme',
      version: '1.0.0',
      commits: [{ id: 'new1' }, { id: 'new2' }],
    });
    expect(isError).toBe(true);
    expect(text).toContain('1000');
    expect(mock.requests).toHaveLength(1);
  });
});

describe('delete_release_file', () => {
  it('deletes when confirm matches the file id', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/organizations/acme/releases/1.0.0/files/9/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'delete_release_file', {
      organization: 'acme',
      version: '1.0.0',
      file_id: 9,
      confirm: '9',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Deleted file 9 from release 1.0.0.');
  });

  it('uses the project-scoped DELETE when project is given', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/projects/acme/web/releases/1.0.0/files/9/`,
      new Response(null, { status: 204 }),
    );
    await call(mock, 'delete_release_file', {
      organization: 'acme',
      version: '1.0.0',
      project: 'web',
      file_id: 9,
      confirm: '9',
    });
    expect(mock.requests[0].url.pathname).toBe('/api/0/projects/acme/web/releases/1.0.0/files/9/');
  });

  it('refuses a wrong confirm without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(mock, 'delete_release_file', {
      organization: 'acme',
      version: '1.0.0',
      file_id: 9,
      confirm: '8',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the file id "9"');
    expect(mock.requests).toHaveLength(0);
  });

  it('maps 404 to the file-in-release message', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/organizations/acme/releases/1.0.0/files/9/`,
      {},
      { status: 404 },
    );
    const { text } = await call(mock, 'delete_release_file', {
      organization: 'acme',
      version: '1.0.0',
      file_id: 9,
      confirm: '9',
    });
    expect(text).toBe('File 9 was not found in release 1.0.0.');
  });
});
