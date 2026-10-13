import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 3, 5, 6: add_issue_comment, update_issue_comment, delete_issue_comment,
// unmerge_issue_hashes — method/path/body assertions, confirm guards, and error paths.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

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

describe('add_issue_comment', () => {
  it('posts { data: { text } } and confirms the id', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/issues/123/comments/`,
      (req) =>
        new Response(
          JSON.stringify({
            id: 7,
            data: JSON.parse(req.body).data,
            dateCreated: '2026-01-01T00:00:00Z',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    );
    const { text } = await call(mock, 'add_issue_comment', {
      organization: 'acme',
      issue_id: 123,
      text: 'looking into it',
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({ data: { text: 'looking into it' } });
    expect(text).toBe('Added comment 7 to issue 123.');
  });

  it('maps 404 to the enhanced issue message', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/organizations/acme/issues/999/comments/`,
      {},
      { status: 404 },
    );
    const { text } = await call(mock, 'add_issue_comment', {
      organization: 'acme',
      issue_id: 999,
      text: 'x',
    });
    expect(text).toBe(
      'Issue 999 was not found in acme (it may be in another organization, or deleted).',
    );
  });

  it('degrades to a plain confirmation when GlitchTip answers with no body', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/issues/123/comments/`,
      new Response(null, { status: 201 }),
    );
    const { text, isError } = await call(mock, 'add_issue_comment', {
      organization: 'acme',
      issue_id: 123,
      text: 'x',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Requested a comment on issue 123; GlitchTip returned no body.');
  });
});

describe('update_issue_comment', () => {
  it('puts { data: { text } } and confirms', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/organizations/acme/issues/123/comments/7/`,
      { id: 7, data: { text: 'edited' }, dateCreated: '2026-01-01T00:00:00Z' },
    );
    const { text } = await call(mock, 'update_issue_comment', {
      organization: 'acme',
      issue_id: 123,
      comment_id: 7,
      text: 'edited',
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({ data: { text: 'edited' } });
    expect(text).toBe('Updated comment 7.');
  });

  it('maps 404 to the comment, not the issue (blocker: was rewritten to "issue not found")', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/organizations/acme/issues/123/comments/999/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'update_issue_comment', {
      organization: 'acme',
      issue_id: 123,
      comment_id: 999,
      text: 'edited',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Comment 999 was not found in acme.');
    expect(text).not.toContain('Issue 123 was not found');
  });

  it('degrades to a plain confirmation when GlitchTip answers with no body', async () => {
    const mock = new MockGlitchTip().on(
      'PUT',
      `${API}/organizations/acme/issues/123/comments/7/`,
      new Response(null, { status: 200 }),
    );
    const { text, isError } = await call(mock, 'update_issue_comment', {
      organization: 'acme',
      issue_id: 123,
      comment_id: 7,
      text: 'edited',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Requested an update to comment 7; GlitchTip returned no body.');
  });
});

describe('delete_issue_comment', () => {
  it('deletes when confirm matches comment_id', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/organizations/acme/issues/123/comments/7/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'delete_issue_comment', {
      organization: 'acme',
      issue_id: 123,
      comment_id: 7,
      confirm: '7',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Deleted comment 7 from issue 123.');
  });

  it('refuses when confirm does not match, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'delete_issue_comment', {
      organization: 'acme',
      issue_id: 123,
      comment_id: 7,
      confirm: '8',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the comment id "7"');
    expect(mock.requests).toHaveLength(0);
  });

  it('maps 403 to event:admin only', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/organizations/acme/issues/123/comments/7/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'delete_issue_comment', {
      organization: 'acme',
      issue_id: 123,
      comment_id: 7,
      confirm: '7',
    });
    expect(text).toBe(
      'The token lacks permission for delete issue comment. It needs one of: event:admin.',
    );
  });
});

describe('unmerge_issue_hashes', () => {
  it('sends id= for every hash and reports the async split', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/organizations/acme/issues/123/hashes/`,
      new Response(null, { status: 202 }),
    );
    const { text, isError } = await call(mock, 'unmerge_issue_hashes', {
      organization: 'acme',
      issue_id: 123,
      hash_ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    });
    expect(isError).toBe(false);
    expect(mock.requests[0].url.searchParams.getAll('id')).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    expect(text).toContain('Splitting 2 hash(es) out of issue 123');
  });

  it('refuses a non-uuid hash id before any request', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'unmerge_issue_hashes', {
      organization: 'acme',
      issue_id: 123,
      hash_ids: ['not-a-uuid'],
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('maps 404 to the enhanced issue message', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/organizations/acme/issues/999/hashes/`,
      {},
      { status: 404 },
    );
    const { text } = await call(mock, 'unmerge_issue_hashes', {
      organization: 'acme',
      issue_id: 999,
      hash_ids: ['11111111-1111-1111-1111-111111111111'],
    });
    expect(text).toBe(
      'Issue 999 was not found in acme (it may be in another organization, or deleted).',
    );
  });
});
