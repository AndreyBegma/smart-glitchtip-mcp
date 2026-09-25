import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 3, 5, 6: update_issue_status, assign_issue, bulk_update_issues, merge_issues,
// delete_issue, bulk_delete_issues — method/path/body assertions, confirm guards, and error paths.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const ISSUE_DETAIL = {
  id: '123',
  shortId: 'PROJ-1',
  title: 'boom',
  count: '1',
  userCount: 0,
  numComments: 0,
  numReportComments: 0,
  userReportCount: 0,
  type: 'error',
  level: 'error',
  status: 'resolved',
  metadata: {},
  project: { id: '1', slug: 'web', name: 'Web' },
  firstSeen: '2026-01-01T00:00:00Z',
  lastSeen: '2026-01-02T00:00:00Z',
  assignedTo: null,
  stats: { '24h': [] },
  permalink: 'Not implemented',
};

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'issues', GLITCHTIP_READ_ONLY: 'false', ...env },
    mock,
  );
  return booted.client;
}

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>, env = {}) {
  const client = await boot(mock, env);
  const result = await client.callTool({ name, arguments: args });
  return { result, text: resultText(result), isError: result.isError === true };
}

describe('update_issue_status', () => {
  it('sends status and statusDetails, and shows the updated issue', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/organizations/acme/issues/123/`,
      ISSUE_DETAIL,
    );
    const { text } = await call(mock, 'update_issue_status', {
      organization: 'acme',
      issue_id: 123,
      status: 'resolved',
      in_release: '1.2.3',
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({
      status: 'resolved',
      statusDetails: { inRelease: '1.2.3', inNextRelease: null },
    });
    expect(text).toContain('status: resolved');
  });

  it('refuses in_release with a non-resolved status before any request', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'update_issue_status', {
      organization: 'acme',
      issue_id: 123,
      status: 'ignored',
      in_release: '1.2.3',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('maps 404 to the enhanced issue message', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/organizations/acme/issues/999/`,
      {},
      { status: 404 },
    );
    const { text } = await call(mock, 'update_issue_status', {
      organization: 'acme',
      issue_id: 999,
      status: 'ignored',
    });
    expect(text).toBe(
      'Issue 999 was not found in acme (it may be in another organization, or deleted).',
    );
  });
});

describe('assign_issue', () => {
  it('sends assignedTo and reports the new assignee', async () => {
    const mock = new MockGlitchTip().json('PUT', `${API}/organizations/acme/issues/123/`, {
      ...ISSUE_DETAIL,
      assignedTo: { type: 'user', id: '1', name: 'Dev' },
    });
    const { text } = await call(mock, 'assign_issue', {
      organization: 'acme',
      issue_id: 123,
      assignee: 'user:1',
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({ assignedTo: 'user:1' });
    expect(text).toBe('Issue 123: assignee is now user:Dev.');
  });

  it('sends null to unassign', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/organizations/acme/issues/123/`,
      ISSUE_DETAIL,
    );
    const { text } = await call(mock, 'assign_issue', {
      organization: 'acme',
      issue_id: 123,
      assignee: null,
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({ assignedTo: null });
    expect(text).toBe('Issue 123: assignee is now unassigned.');
  });
});

describe('bulk_update_issues', () => {
  it('sends id= for every issue in the query string, never a filtered bulk call', async () => {
    const mock = new MockGlitchTip().json('PUT', `${API}/organizations/acme/issues/`, {});
    const { text } = await call(mock, 'bulk_update_issues', {
      organization: 'acme',
      issue_ids: [1, 2, 3],
      status: 'resolved',
    });
    expect(mock.requests[0].url.searchParams.getAll('id')).toEqual(['1', '2', '3']);
    expect(JSON.parse(mock.requests[0].body)).toEqual({ status: 'resolved' });
    expect(text).toBe('Updated 3 issues: 1, 2, 3.');
  });

  it('refuses when neither status nor assignee is given, without a request', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'bulk_update_issues', {
      organization: 'acme',
      issue_ids: [1],
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('refuses an empty issue_ids array before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'bulk_update_issues', {
      organization: 'acme',
      issue_ids: [],
      status: 'resolved',
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('merge_issues', () => {
  it('merges into the highest id when confirm matches', async () => {
    const mock = new MockGlitchTip().json('PUT', `${API}/organizations/acme/issues/`, {});
    const { text, isError } = await call(mock, 'merge_issues', {
      organization: 'acme',
      issue_ids: [5, 9, 3],
      confirm: '9',
    });
    expect(isError).toBe(false);
    expect(mock.requests[0].url.searchParams.getAll('id')).toEqual(['5', '9', '3']);
    expect(JSON.parse(mock.requests[0].body)).toEqual({ merge: 1 });
    expect(text).toBe('Merged 5, 3 into 9.');
  });

  it('refuses a confirm that does not equal the target id, without a request', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'merge_issues', {
      organization: 'acme',
      issue_ids: [5, 9, 3],
      confirm: '5',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the target issue id 9');
    expect(mock.requests).toHaveLength(0);
  });
});

describe('delete_issue', () => {
  it('deletes when confirm matches the issue id', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/organizations/acme/issues/123/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'delete_issue', {
      organization: 'acme',
      issue_id: 123,
      confirm: '123',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Deleted issue 123.');
  });

  it('refuses when confirm does not match, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'delete_issue', {
      organization: 'acme',
      issue_id: 123,
      confirm: '124',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the issue id "123"');
    expect(mock.requests).toHaveLength(0);
  });

  it('maps 403 to the write scopes', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/organizations/acme/issues/123/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'delete_issue', {
      organization: 'acme',
      issue_id: 123,
      confirm: '123',
    });
    expect(text).toBe(
      'The token lacks permission for delete issue. It needs one of: event:write, event:admin.',
    );
  });
});

describe('bulk_delete_issues', () => {
  it('deletes with id= for every issue when confirm matches the count', async () => {
    const mock = new MockGlitchTip().json('DELETE', `${API}/organizations/acme/issues/`, {});
    const { text, isError } = await call(mock, 'bulk_delete_issues', {
      organization: 'acme',
      issue_ids: [1, 2],
      confirm: '2',
    });
    expect(isError).toBe(false);
    expect(mock.requests[0].url.searchParams.getAll('id')).toEqual(['1', '2']);
    expect(text).toBe('Deleted 2 issues: 1, 2.');
  });

  it('refuses when confirm does not equal the count, without a request', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'bulk_delete_issues', {
      organization: 'acme',
      issue_ids: [1, 2],
      confirm: '3',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the number of issue_ids ("2")');
    expect(mock.requests).toHaveLength(0);
  });
});
