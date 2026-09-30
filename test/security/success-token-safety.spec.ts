import type { Client } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Booted,
  type BootedHttp,
  bootHttp,
  bootInMemory,
  GLITCHTIP,
  resultText,
} from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// BUG-20260930-021, gate token-safety: the token — the env one over stdio,
// the per-request Bearer one over HTTP — echoed in GlitchTip *success*
// content never reaches a tool result, in text or json, and no start of it
// (4+ characters) survives a view's field cap or the response budget.

const TOKEN = 'Zq9x_S3CR3T_1234567890abcdef';
/** The shortest start of the token that counts as a leak; cannot occur by chance here. */
const PREFIX = TOKEN.slice(0, 4);
const API = `${GLITCHTIP}/api/0`;
const ORG = 'acme';

/** The exception value cap in the event parser; the token straddles it. */
const EXCEPTION_VALUE_LIMIT = 1000;
const STRADDLE_AT = EXCEPTION_VALUE_LIMIT - 25;

const ISSUE = {
  id: '42',
  shortId: 'WEB-42',
  title: `leaked ${TOKEN} here`,
  culprit: `handler ${TOKEN}`,
  count: '7',
  userCount: 3,
  numComments: 0,
  type: 'error',
  level: 'error',
  status: 'unresolved',
  metadata: { value: TOKEN },
  project: { id: '1', slug: 'web', name: 'Web' },
  firstSeen: '2026-01-01T00:00:00Z',
  lastSeen: '2026-01-02T00:00:00Z',
  assignedTo: null,
  stats: { '24h': [] },
  permalink: 'Not implemented',
};

const EVENT = {
  id: 'evt-1',
  eventID: 'ab'.repeat(16),
  projectID: 1,
  groupID: '42',
  dateCreated: '2026-01-02T03:04:05Z',
  dateReceived: '2026-01-02T03:04:06Z',
  type: 'error',
  message: `message ${TOKEN}`,
  tags: [{ key: 'auth', value: TOKEN }],
  title: `ValueError: ${TOKEN}`,
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'ValueError',
            value: `${'v'.repeat(STRADDLE_AT)}${TOKEN}${'w'.repeat(50)}`,
            stacktrace: {
              frames: [
                {
                  filename: 'app.py',
                  function: 'run',
                  lineno: 3,
                  in_app: true,
                  pre_context: [`token = "${TOKEN}"`],
                  context_line: `connect(${TOKEN})`,
                  post_context: ['return'],
                },
              ],
            },
          },
        ],
      },
    },
    { type: 'message', data: { formatted: `formatted ${TOKEN}` } },
    {
      type: 'breadcrumbs',
      data: {
        values: [
          {
            timestamp: '2026-01-02T03:04:00Z',
            level: 'info',
            category: 'http',
            message: `GET /?token=${TOKEN}`,
          },
        ],
      },
    },
  ],
  userReport: null,
};

const RELEASE = {
  ref: `refs/${TOKEN}`,
  dateReleased: '2026-01-02T03:04:05Z',
  version: '1.0.0',
  dateCreated: '2026-01-01T00:00:00Z',
  shortVersion: '1.0.0',
  projects: [{ slug: 'web', name: 'Web' }],
  repository: { id: '1', name: 'acme/web' },
  url: `https://ci.example/build/1?t=${TOKEN}`,
  commitCount: 2,
  deployCount: 1,
};

const LOG = {
  id: '018f2a3b-0000-7000-8000-000000000001',
  timestamp: '2026-01-01T00:00:00Z',
  level: 'error',
  body: `connection refused for ${TOKEN}`,
  service: 'checkout-api',
  environment: 'production',
  host: 'pod-7',
  traceID: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanID: '00f067aa0ba902b7',
  severityNumber: 17,
  data: { 'http.method': 'GET', authorization: TOKEN },
  projectId: 1,
};

interface Case {
  readonly name: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  /** Evidence the view rendered the field, so a clean result is not an empty one. */
  readonly rendered: string;
}

const CASES: readonly Case[] = [
  { name: 'issue title', tool: 'get_issue', args: { issue_id: 42 }, rendered: 'leaked' },
  { name: 'issue list title', tool: 'list_issues', args: {}, rendered: 'leaked' },
  {
    name: 'event exception value across the 1000-character cap, message, breadcrumb, context',
    tool: 'get_latest_event',
    args: { issue_id: 42, include_context: true, breadcrumbs: 10 },
    rendered: 'GET /?token=',
  },
  { name: 'release ref', tool: 'get_release', args: { version: '1.0.0' }, rendered: 'refs/' },
  { name: 'log line', tool: 'list_logs', args: {}, rendered: 'connection refused' },
];

function mock(): MockGlitchTip {
  return new MockGlitchTip()
    .json('GET', `${API}/organizations/${ORG}/issues/42/`, ISSUE)
    .json('GET', `${API}/organizations/${ORG}/issues/`, [ISSUE])
    .json('GET', `${API}/organizations/${ORG}/issues/42/events/latest/`, EVENT)
    .json('GET', `${API}/organizations/${ORG}/releases/1.0.0/`, RELEASE)
    .json('GET', `${API}/organizations/${ORG}/logs/`, [LOG]);
}

const ENV = {
  GLITCHTIP_TOOLSETS: 'issues,events,releases,logs',
  GLITCHTIP_DEFAULT_ORG: ORG,
};

function assertClean(what: string, text: string): void {
  expect(text, `${what} carries the token`).not.toContain(TOKEN);
  expect(text, `${what} carries a start of the token`).not.toContain(PREFIX);
}

async function assertCaseClean(client: Client, { name, tool, args, rendered }: Case) {
  for (const format of ['text', 'json'] as const) {
    const result = await client.callTool({ name: tool, arguments: { ...args, format } });
    const text = resultText(result);
    expect(result.isError, `${tool} ${format}: ${text}`).not.toBe(true);
    expect(text).toContain(rendered);
    expect(text).toContain('[redacted]');
    assertClean(`${name} (${tool}, ${format})`, text);
  }
}

describe('token in success content — stdio (env token)', () => {
  let booted: Booted | undefined;
  afterEach(async () => {
    await booted?.close();
    booted = undefined;
  });

  it.each(CASES)('$name', async (testCase) => {
    booted = await bootInMemory({ ...ENV, GLITCHTIP_TOKEN: TOKEN }, mock());
    await assertCaseClean(booted.client, testCase);
  });

  it('leaves no start of the token at any offset across the response budget', async () => {
    // A message (capped at 2000 by the parser) longer than the 1000-character budget: the
    // token sits wherever the budget cuts, for every offset in a window around it.
    const budget = 1_000;
    let straddled = 0;
    for (let offset = 720; offset < 800; offset += 2) {
      const formatted = `${'m'.repeat(offset)}${TOKEN}${'q'.repeat(900)}`;
      const entries = [{ type: 'message', data: { formatted } }];
      const event = { ...EVENT, message: '', title: 'boom', tags: [], entries };
      const m = new MockGlitchTip().json(
        'GET',
        `${API}/organizations/${ORG}/issues/42/events/latest/`,
        event,
      );
      booted = await bootInMemory(
        { ...ENV, GLITCHTIP_TOKEN: TOKEN, MCP_RESPONSE_BUDGET: String(budget) },
        m,
      );
      for (const format of ['text', 'json']) {
        const result = await booted.client.callTool({
          name: 'get_latest_event',
          arguments: { issue_id: 42, format },
        });
        const text = resultText(result);
        expect(result.isError).not.toBe(true);
        assertClean(`get_latest_event ${format} at offset ${offset}`, text);
        // The whole run of m's survived but nothing after the token did: the cut fell in it.
        if (text.includes('m'.repeat(offset)) && !text.includes('q')) straddled++;
      }
      await booted.close();
      booted = undefined;
    }
    // The window really did put the budget cut inside the token.
    expect(straddled).toBeGreaterThan(0);
  });
});

describe('token in success content — http (per-request Bearer token)', () => {
  let server: BootedHttp | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it.each(CASES)('$name', async (testCase) => {
    server = await bootHttp({ ...ENV, GLITCHTIP_URL: GLITCHTIP }, mock());
    const client = await server.connect({ authorization: `Bearer ${TOKEN}` });
    await assertCaseClean(client, testCase);
  });
});
