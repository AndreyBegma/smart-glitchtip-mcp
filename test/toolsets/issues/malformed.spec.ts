import { afterEach, describe, expect, it } from 'vitest';
import malformedComment from '../../fixtures/issues/malformed-comment.json';
import malformedCommit from '../../fixtures/issues/malformed-commit.json';
import malformedHash from '../../fixtures/issues/malformed-hash.json';
import malformedIssue from '../../fixtures/issues/malformed-issue.json';
import malformedStats from '../../fixtures/issues/malformed-stats.json';
import malformedTag from '../../fixtures/issues/malformed-tag.json';
import malformedUserReport from '../../fixtures/issues/malformed-user-report.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Should-fix 8: a malformed/partial GlitchTip response degrades the text output instead of
// throwing (which the tool-error filter would otherwise turn into an opaque "Internal error").
// Every case here asserts isError: false and a sensible fallback string, not a thrown exception.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'issues', GLITCHTIP_READ_ONLY: 'false' },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('list_issues', () => {
  it('renders an issue missing project and title without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/issues/`, [
      malformedIssue,
    ]);
    const { text, isError } = await call(mock, 'list_issues', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toContain('PROJ-1');
    expect(text).toContain('-'); // project column falls back to '-'
  });

  it('falls back to "-" for a missing lastSeen instead of printing "undefined"', async () => {
    const { lastSeen: _lastSeen, ...issueWithoutLastSeen } = malformedIssue;
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/issues/`, [
      issueWithoutLastSeen,
    ]);
    const { text, isError } = await call(mock, 'list_issues', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).not.toContain('undefined');
  });
});

describe('get_issue', () => {
  it('renders an issue missing project and with a null title without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/issues/1/`,
      malformedIssue,
    );
    const { text, isError } = await call(mock, 'get_issue', { organization: 'acme', issue_id: 1 });
    expect(isError).toBe(false);
    expect(text).toContain('shortId: PROJ-1');
  });
});

describe('get_issues_stats', () => {
  it('renders a row missing stats without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/issues-stats/`,
      malformedStats,
    );
    const { text, isError } = await call(mock, 'get_issues_stats', {
      organization: 'acme',
      issue_ids: [1],
    });
    expect(isError).toBe(false);
    expect(text).toContain('1');
  });
});

describe('list_issue_tags', () => {
  it('renders a tag missing topValues and with a null key without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/issues/1/tags/`,
      malformedTag,
    );
    const { text, isError } = await call(mock, 'list_issue_tags', {
      organization: 'acme',
      issue_id: 1,
    });
    expect(isError).toBe(false);
    expect(text).toContain('unique, 1 total');
  });
});

describe('list_issue_commits', () => {
  it('renders a commit missing id/author/message without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/issues/1/commits/`,
      malformedCommit,
    );
    const { text, isError } = await call(mock, 'list_issue_commits', {
      organization: 'acme',
      issue_id: 1,
    });
    expect(isError).toBe(false);
    expect(text).toContain('-');
  });
});

describe('list_issue_comments', () => {
  it('renders a comment missing data without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/issues/1/comments/`,
      malformedComment,
    );
    const { text, isError } = await call(mock, 'list_issue_comments', {
      organization: 'acme',
      issue_id: 1,
    });
    expect(isError).toBe(false);
    expect(text).toContain('a@b.test');
    expect(text).toContain('<untrusted source="glitchtip-event" field="comment.text"></untrusted>');
  });
});

describe('list_issue_user_reports', () => {
  it('renders a report with null name/email/comments without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/issues/1/user-reports/`,
      malformedUserReport,
    );
    const { text, isError } = await call(mock, 'list_issue_user_reports', {
      organization: 'acme',
      issue_id: 1,
    });
    expect(isError).toBe(false);
    expect(text).toContain('event evt1');
  });
});

describe('list_issue_hashes', () => {
  it('renders a hash whose latest event has a null title without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/issues/1/hashes/`,
      malformedHash,
    );
    const { text, isError } = await call(mock, 'list_issue_hashes', {
      organization: 'acme',
      issue_id: 1,
    });
    expect(isError).toBe(false);
    expect(text).toContain('hash-1');
    expect(text).toContain('<untrusted source="glitchtip-event" field="event.title"></untrusted>');
  });
});
