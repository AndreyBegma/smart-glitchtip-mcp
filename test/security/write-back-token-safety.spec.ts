import { afterEach, describe, expect, it } from 'vitest';
import user from '../fixtures/admin/user.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// BUG-20260930-021, AGENTS.md rule 15: the six read-then-write reads take the
// body unscrubbed (`writeBack`), so a token GlitchTip stores in a re-sent field
// goes back as it was — never as `[redacted]` — while the tool result (from the
// scrubbed write response) and any error still carry no start of the token.

const TOKEN = 'Zq9x_S3CR3T_1234567890abcdef';
const PREFIX = TOKEN.slice(0, 4);
const API = `${GLITCHTIP}/api/0`;

interface Site {
  readonly name: string;
  readonly toolset: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly readUrl: string;
  readonly read: unknown;
  readonly writeMethod: string;
  readonly writeUrl: string;
  /** The write response: the stored object, token and all, as GlitchTip echoes it. */
  readonly written: unknown;
  /** The re-sent field, as the write body must carry it. */
  readonly resent: (body: unknown) => unknown;
  readonly original: unknown;
}

const ALERT = {
  id: 7,
  name: 'Errors',
  timespanMinutes: 5,
  quantity: 10,
  uptime: false,
  alertRecipients: [
    {
      id: 1,
      recipientType: 'webhook',
      url: `https://hooks.example.test/${TOKEN}`,
      config: null,
      tagsToAdd: null,
    },
  ],
};

const PROJECT = {
  id: '1',
  slug: 'web',
  name: `Web ${TOKEN}`,
  platform: 'python',
  eventThrottleRate: 5,
  dateCreated: '2026-01-02T03:04:05Z',
  firstEvent: null,
  scrubIPAddresses: false,
  isPublic: false,
  isBookmarked: false,
  organization: { slug: 'acme' },
};

const MONITOR = {
  id: 1,
  name: 'API health',
  monitorType: 'GET',
  isUp: true,
  lastChange: '2026-01-01T00:00:00Z',
  url: `https://api.example.test/health?key=${TOKEN}`,
  expectedStatus: 200,
  expectedBody: '',
  interval: 60,
  timeout: null,
  confirmationThreshold: 1,
  projectID: '9',
  projectName: 'web',
  envName: 'production',
  organizationID: 42,
  endpointID: null,
  heartbeatEndpoint: null,
  created: '2025-12-01T00:00:00Z',
  checks: [],
};

const RELEASE = {
  ref: `refs/${TOKEN}`,
  dateReleased: '2026-01-02T03:04:05Z',
  version: '1.0.0',
  dateCreated: '2026-01-01T00:00:00Z',
  shortVersion: '1.0.0',
  projects: [{ slug: 'web', name: 'Web' }],
  commitCount: 1,
  deployCount: 0,
};

const COMMITS = [
  {
    id: 'a1',
    message: `fix ${TOKEN}`,
    authorName: 'Dev',
    authorEmail: 'dev@example.test',
    dateCreated: 'x',
  },
];

const USER = { ...user, name: `Me ${TOKEN}` };

type Body = Record<string, unknown>;

const SITES: readonly Site[] = [
  {
    name: 'readAlert (update_project_alert)',
    toolset: 'alerts',
    tool: 'update_project_alert',
    args: { organization: 'acme', project: 'web', alert_id: 7, name: 'Renamed' },
    readUrl: `${API}/projects/acme/web/alerts/`,
    read: [ALERT],
    writeMethod: 'PUT',
    writeUrl: `${API}/projects/acme/web/alerts/7/`,
    written: { ...ALERT, name: 'Renamed' },
    resent: (body) => ((body as Body).alertRecipients as Body[])[0].url,
    original: ALERT.alertRecipients[0].url,
  },
  {
    name: 'update_project',
    toolset: 'projects',
    tool: 'update_project',
    args: { organization: 'acme', project: 'web', platform: 'go' },
    readUrl: `${API}/projects/acme/web/`,
    read: PROJECT,
    writeMethod: 'PUT',
    writeUrl: `${API}/projects/acme/web/`,
    written: { ...PROJECT, platform: 'go' },
    resent: (body) => (body as Body).name,
    original: PROJECT.name,
  },
  {
    name: 'update_current_user',
    toolset: 'admin',
    tool: 'update_current_user',
    args: { timezone: 'UTC' },
    readUrl: `${API}/users/me/`,
    read: USER,
    writeMethod: 'PUT',
    writeUrl: `${API}/users/me/`,
    written: { ...USER, options: { ...USER.options, timezone: 'UTC' } },
    resent: (body) => (body as Body).name,
    original: USER.name,
  },
  {
    name: 'update_monitor',
    toolset: 'monitors',
    tool: 'update_monitor',
    args: { organization: 'acme', monitor_id: 1, name: 'renamed' },
    readUrl: `${API}/organizations/acme/monitors/1/`,
    read: MONITOR,
    writeMethod: 'PUT',
    writeUrl: `${API}/organizations/acme/monitors/1/`,
    written: { ...MONITOR, name: 'renamed' },
    resent: (body) => (body as Body).url,
    original: MONITOR.url,
  },
  {
    name: 'update_release',
    toolset: 'releases',
    tool: 'update_release',
    args: { organization: 'acme', version: '1.0.0', date_released: '2026-03-01T00:00:00Z' },
    readUrl: `${API}/organizations/acme/releases/1.0.0/`,
    read: RELEASE,
    writeMethod: 'PUT',
    writeUrl: `${API}/organizations/acme/releases/1.0.0/`,
    written: RELEASE,
    resent: (body) => (body as Body).ref,
    original: RELEASE.ref,
  },
  {
    name: 'add_release_commits',
    toolset: 'releases',
    tool: 'add_release_commits',
    args: { organization: 'acme', version: '1.0.0', commits: [{ id: 'a2', message: 'second' }] },
    readUrl: `${API}/organizations/acme/releases/1.0.0/commits/`,
    read: COMMITS,
    writeMethod: 'POST',
    writeUrl: `${API}/organizations/acme/releases/1.0.0/commits/`,
    written: { ...RELEASE, commitCount: 2 },
    resent: (body) => (body as Body[])[0].message,
    original: COMMITS[0].message,
  },
];

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function call(mock: MockGlitchTip, site: Site, format: string) {
  await booted?.close();
  booted = await bootInMemory(
    {
      GLITCHTIP_TOKEN: TOKEN,
      GLITCHTIP_TOOLSETS: site.toolset,
      GLITCHTIP_READ_ONLY: 'false',
    },
    mock,
  );
  const result = await booted.client.callTool({
    name: site.tool,
    arguments: { ...site.args, format },
  });
  return { text: resultText(result), isError: result.isError === true };
}

describe('read-then-write with the token in a re-sent field', () => {
  it.each(SITES)('$name re-sends the stored value and returns no token', async (site) => {
    for (const format of ['text', 'json']) {
      const mock = new MockGlitchTip()
        .json('GET', site.readUrl, site.read)
        .json(site.writeMethod, site.writeUrl, site.written);
      const { text, isError } = await call(mock, site, format);
      expect(isError, text).toBe(false);
      const write = mock.requests.find((r) => r.method === site.writeMethod);
      expect(site.resent(JSON.parse(write?.body ?? 'null'))).toBe(site.original);
      expect(text).not.toContain(PREFIX);
    }
  });

  it.each(SITES)('$name: a failed write names no token', async (site) => {
    const mock = new MockGlitchTip()
      .json('GET', site.readUrl, site.read)
      .json(
        site.writeMethod,
        site.writeUrl,
        { detail: `rejected ${site.original}` },
        { status: 400 },
      );
    const { text, isError } = await call(mock, site, 'text');
    expect(isError).toBe(true);
    expect(text).toMatch(/^GlitchTip rejected the request/);
    expect(text).not.toContain(PREFIX);
  });
});

describe('update_current_user refusal', () => {
  it('does not name an unknown option key that is the token', async () => {
    const stored = { ...user, options: { ...user.options, [TOKEN]: 1 } };
    const site = SITES.find((s) => s.tool === 'update_current_user') as Site;
    const mock = new MockGlitchTip().json('GET', site.readUrl, stored);
    const { text, isError } = await call(mock, site, 'text');
    expect(isError).toBe(true);
    expect(text).toContain('has an option this server does not know');
    expect(text).not.toContain(PREFIX);
    expect(mock.requests.filter((r) => r.method === 'PUT')).toEqual([]);
  });
});
