import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolOutput } from '../../src/format/tool-output';
import {
  type Booted,
  type BootedHttp,
  bootHttp,
  bootInMemory,
  GLITCHTIP,
  resultText,
} from '../support/boot';
import { jsonResponse, MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 9, review gate "token-safety" (AGENTS.md rule 1): with the token
// tok_SECRET_123, every error kind is forced; neither the tool result nor the
// captured log (what reaches stderr) contains the token or the header value.

const TOKEN = 'tok_SECRET_123';
const HEADER = `Bearer ${TOKEN}`;
const API = `${GLITCHTIP}/api/0`;
const ORG = `${API}/organizations/acme/`;

interface Case {
  readonly kind: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly arrange: (mock: MockGlitchTip) => void;
  readonly expected: RegExp;
}

// Mutations are used where a GET would spend seconds in retry backoff; the
// mapping under test is the same.
const CASES: readonly Case[] = [
  {
    kind: 'invalid (GlitchTip echoes the token in detail)',
    tool: 'update_organization',
    args: { organization: 'acme', name: 'x' },
    arrange: (m) =>
      m.json('PUT', ORG, { detail: `bad token ${TOKEN} / ${HEADER}` }, { status: 400 }),
    expected: /^GlitchTip rejected the request: /,
  },
  {
    kind: 'unauthenticated',
    tool: 'get_organization',
    args: { organization: 'acme' },
    arrange: (m) => m.json('GET', ORG, { detail: `Invalid token ${TOKEN}` }, { status: 401 }),
    expected: /^The GlitchTip token was rejected \(401\)/,
  },
  {
    kind: 'forbidden',
    tool: 'get_organization',
    args: { organization: 'acme' },
    arrange: (m) => m.json('GET', ORG, { detail: TOKEN }, { status: 403 }),
    expected: /^The token lacks permission for get organization/,
  },
  {
    kind: 'not_found',
    tool: 'get_organization',
    args: { organization: 'acme' },
    arrange: (m) => m.json('GET', ORG, { detail: TOKEN }, { status: 404 }),
    expected: /^Organization acme was not found\.$/,
  },
  {
    kind: 'rate_limited',
    tool: 'get_organization',
    args: { organization: 'acme' },
    arrange: (m) =>
      m.json('GET', ORG, { detail: TOKEN }, { status: 429, headers: { 'retry-after': '0' } }),
    expected: /^GlitchTip is rate-limiting; retry after 0s\.$/,
  },
  {
    kind: 'upstream',
    tool: 'update_organization',
    args: { organization: 'acme', name: 'x' },
    arrange: (m) => m.json('PUT', ORG, { detail: TOKEN }, { status: 502 }),
    expected: /^GlitchTip returned 502\.$/,
  },
  {
    kind: 'upstream (redirect)',
    tool: 'get_organization',
    args: { organization: 'acme' },
    arrange: (m) =>
      m.on(
        'GET',
        ORG,
        new Response(null, { status: 302, headers: { location: `https://evil.test/?t=${TOKEN}` } }),
      ),
    expected: /redirect \(302\)/,
  },
  {
    kind: 'upstream (not JSON)',
    tool: 'get_organization',
    args: { organization: 'acme' },
    arrange: (m) => m.on('GET', ORG, new Response(`<html>${TOKEN}</html>`, { status: 200 })),
    expected: /not valid JSON/,
  },
  {
    kind: 'timeout',
    tool: 'update_organization',
    args: { organization: 'acme', name: 'x' },
    arrange: (m) => m.on('PUT', ORG, () => new Promise<Response>(() => undefined)),
    expected: /^GlitchTip did not answer within 100 ms\.$/,
  },
  {
    kind: 'unreachable',
    tool: 'update_organization',
    args: { organization: 'acme', name: 'x' },
    arrange: () => undefined,
    expected: new RegExp(`^Could not reach ${GLITCHTIP}\\.$`),
  },
  {
    kind: 'no default organization',
    tool: 'get_organization',
    args: {},
    arrange: (m) =>
      m.on('GET', `${API}/organizations/`, jsonResponse([{ slug: 'a' }, { slug: 'b' }])),
    expected: /^Several organizations are visible/,
  },
  {
    kind: 'confirmation refused',
    tool: 'delete_organization',
    args: { organization: 'acme', confirm: TOKEN },
    arrange: () => undefined,
    expected: /^Not deleted: confirm must equal/,
  },
  {
    kind: 'invalid parameters',
    tool: 'list_organizations',
    args: { limit: TOKEN },
    arrange: () => undefined,
    expected: /^Invalid parameters/,
  },
  {
    kind: 'whoami, GlitchTip refuses the token and echoes it',
    tool: 'whoami',
    args: {},
    arrange: (m) => m.json('GET', `${API}/`, { detail: `Invalid token ${TOKEN}` }, { status: 401 }),
    expected: /^The GlitchTip token was rejected \(401\)/,
  },
];

const MCP_SECRET = 'mcp-shared-secret-value';

/** GlitchTip's API root returns the token itself in `auth.token`. */
const API_ROOT_WITH_TOKEN = {
  version: '6.2.6',
  user: { id: '1', email: 'me@example.com', name: 'Me' },
  auth: { id: 9, label: 'mcp', scopes: ['org:read'], token: TOKEN, created: '2026-01-01' },
};

function assertClean(label: string, text: string): void {
  expect(text, label).not.toContain(TOKEN);
  expect(text, label).not.toContain(HEADER);
}

/**
 * A clean log proves nothing unless the sink was receiving: each boot must
 * show its own lines (see test/support/harness.spec.ts).
 */
function assertLive(logs: string, marker: string): void {
  expect(logs, 'the captured log must be receiving this boot').toContain(marker);
}

/** Makes the next tool render throw a defect whose message carries the raw token. */
/**
 * Makes rendering throw with the token in the message. `Error` is an
 * internal defect; `TypeError` is what a malformed GlitchTip response looks
 * like (BUG-20260925-006) — both are logged, and neither may carry the token.
 */
function defectCarryingToken(kind: 'internal' | 'malformed' = 'internal'): void {
  const Thrown = kind === 'internal' ? Error : TypeError;
  vi.spyOn(ToolOutput.prototype, 'render').mockImplementation(() => {
    throw new Thrown(`unexpected state for token ${TOKEN} (no Bearer prefix)`);
  });
}

const MALFORMED =
  /^GlitchTip returned a response this server did not expect for list_organizations \([0-9a-f-]{36}\)\./;

// The mock never answers a timed-out request, so the client's own
// AbortSignal must fire; make the mock honour it the way fetch does.
function withAbort(mock: MockGlitchTip): MockGlitchTip {
  const original = mock.fetch;
  Object.defineProperty(mock, 'fetch', {
    value: (request: Request) =>
      Promise.race([
        original(request),
        new Promise<Response>((_, reject) =>
          request.signal.addEventListener('abort', () => reject(request.signal.reason)),
        ),
      ]),
  });
  return mock;
}

const COMMON_ENV = {
  GLITCHTIP_TOOLSETS: 'organizations',
  GLITCHTIP_READ_ONLY: 'false',
  GLITCHTIP_TIMEOUT_MS: '100',
  LOG_LEVEL: 'trace',
};

const STDIO_MARKER = 'Nest microservice successfully started';
const HTTP_MARKER = 'request completed';

describe('token safety — stdio path (env token)', () => {
  let booted: Booted | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    await booted?.close();
    booted = undefined;
  });

  it.each(CASES)('$kind', async ({ tool, args, arrange, expected }) => {
    const mock = withAbort(new MockGlitchTip());
    arrange(mock);
    booted = await bootInMemory({ ...COMMON_ENV, GLITCHTIP_TOKEN: TOKEN }, mock);
    const result = await booted.client.callTool({ name: tool, arguments: args });
    const text = resultText(result);
    expect(result.isError).toBe(true);
    expect(text).toMatch(expected);
    assertClean('tool result', text);
    assertLive(booted.logs(), STDIO_MARKER);
    assertClean('log', booted.logs());
    if (mock.requests.length > 0)
      expect(mock.requests[0].headers.get('authorization')).toBe(HEADER);
    expect(mock.followingRedirects).toEqual([]);
  });

  it('whoami success: the token GlitchTip returns in auth.token is not in result or log', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/`, API_ROOT_WITH_TOKEN)
      .json('GET', `${API}/organizations/`, [{ slug: 'acme' }]);
    booted = await bootInMemory({ ...COMMON_ENV, GLITCHTIP_TOKEN: TOKEN }, mock);
    for (const format of ['text', 'json']) {
      const result = await booted.client.callTool({ name: 'whoami', arguments: { format } });
      expect(result.isError).not.toBe(true);
      assertClean(`whoami ${format}`, resultText(result));
    }
    assertLive(booted.logs(), STDIO_MARKER);
    assertClean('log', booted.logs());
  });

  it('an internal defect carrying the raw env token is logged without it', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, []);
    booted = await bootInMemory({ ...COMMON_ENV, GLITCHTIP_TOKEN: TOKEN }, mock);
    defectCarryingToken();
    const result = await booted.client.callTool({ name: 'list_organizations', arguments: {} });
    expect(resultText(result)).toMatch(/^Internal error in smart-glitchtip-mcp \(/);
    assertLive(booted.logs(), 'unexpected state for token [redacted]');
    assertClean('result', resultText(result));
    assertClean('log', booted.logs());
  });

  it('a malformed response error carrying the raw env token is logged without it', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, []);
    booted = await bootInMemory({ ...COMMON_ENV, GLITCHTIP_TOKEN: TOKEN }, mock);
    defectCarryingToken('malformed');
    const result = await booted.client.callTool({ name: 'list_organizations', arguments: {} });
    expect(resultText(result)).toMatch(MALFORMED);
    assertLive(booted.logs(), 'unexpected state for token [redacted]');
    assertClean('result', resultText(result));
    assertClean('log', booted.logs());
  });
});

describe('token safety — http path', () => {
  let server: BootedHttp | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    await server?.close();
    server = undefined;
  });

  it.each(CASES)('pass-through token: $kind', async ({ tool, args, arrange, expected }) => {
    const mock = withAbort(new MockGlitchTip());
    arrange(mock);
    server = await bootHttp({ ...COMMON_ENV, GLITCHTIP_URL: GLITCHTIP }, mock);
    const client = await server.connect({ authorization: HEADER });
    const result = await client.callTool({ name: tool, arguments: args });
    const text = resultText(result);
    expect(result.isError).toBe(true);
    expect(text).toMatch(expected);
    assertClean('tool result', text);
    assertLive(server.logs(), HTTP_MARKER);
    assertClean('log', server.logs());
    expect(mock.followingRedirects).toEqual([]);
  });

  it('whoami success with a pass-through token: auth.token is not in result or log', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/`, API_ROOT_WITH_TOKEN)
      .json('GET', `${API}/organizations/`, [{ slug: 'acme' }]);
    server = await bootHttp({ ...COMMON_ENV, GLITCHTIP_URL: GLITCHTIP }, mock);
    const client = await server.connect({ authorization: HEADER });
    for (const format of ['text', 'json']) {
      const result = await client.callTool({ name: 'whoami', arguments: { format } });
      expect(result.isError).not.toBe(true);
      assertClean(`whoami ${format}`, resultText(result));
    }
    assertLive(server.logs(), HTTP_MARKER);
    assertClean('log', server.logs());
  });

  it('X-GlitchTip-Url carrying credentials is logged as its origin only', async () => {
    const mock = new MockGlitchTip();
    server = await bootHttp({ ...COMMON_ENV, GLITCHTIP_URL: GLITCHTIP }, mock);
    const client = await server.connect({
      authorization: HEADER,
      'x-glitchtip-url': `https://u:${TOKEN}@evil.test/p?token=${TOKEN}`,
    });
    const result = await client.callTool({ name: 'list_organizations', arguments: {} });
    expect(resultText(result)).toMatch(/^instance URL not allowed: https:\/\/evil\.test\/p\./);
    assertLive(server.logs(), '"x-glitchtip-url":"https://evil.test"');
    assertClean('result', resultText(result));
    assertClean('log', server.logs());
  });

  it('an internal defect carrying the raw pass-through token is logged without it', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, []);
    server = await bootHttp({ ...COMMON_ENV, GLITCHTIP_URL: GLITCHTIP }, mock);
    const client = await server.connect({ authorization: HEADER });
    defectCarryingToken();
    const result = await client.callTool({ name: 'list_organizations', arguments: {} });
    expect(resultText(result)).toMatch(/^Internal error in smart-glitchtip-mcp \(/);
    assertLive(server.logs(), 'unexpected state for token [redacted]');
    assertClean('result', resultText(result));
    assertClean('log', server.logs());
  });

  it('a malformed response error carrying the raw pass-through token is logged without it', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, []);
    server = await bootHttp({ ...COMMON_ENV, GLITCHTIP_URL: GLITCHTIP }, mock);
    const client = await server.connect({ authorization: HEADER });
    defectCarryingToken('malformed');
    const result = await client.callTool({ name: 'list_organizations', arguments: {} });
    expect(resultText(result)).toMatch(MALFORMED);
    assertLive(server.logs(), 'unexpected state for token [redacted]');
    assertClean('result', resultText(result));
    assertClean('log', server.logs());
  });

  it('server token: env token never surfaces, and a refused URL does not leak either', async () => {
    const mock = withAbort(new MockGlitchTip());
    mock.json('GET', ORG, { detail: TOKEN }, { status: 401 });
    server = await bootHttp(
      {
        ...COMMON_ENV,
        GLITCHTIP_URL: GLITCHTIP,
        GLITCHTIP_TOKEN: TOKEN,
        MCP_AUTH_TOKEN: MCP_SECRET,
      },
      mock,
    );
    const client = await server.connect({ authorization: `Bearer ${MCP_SECRET}` });
    const unauthorized = await client.callTool({
      name: 'get_organization',
      arguments: { organization: 'acme' },
    });
    const refused = await (
      await server.connect({
        authorization: HEADER,
        'x-glitchtip-url': `https://u:${TOKEN}@evil.test`,
      })
    ).callTool({ name: 'list_organizations', arguments: {} });
    expect(resultText(unauthorized)).toMatch(/^The GlitchTip token was rejected/);
    expect(resultText(refused)).toMatch(/^instance URL not allowed/);
    assertLive(server.logs(), HTTP_MARKER);
    for (const text of [resultText(unauthorized), resultText(refused), server.logs()]) {
      assertClean('result or log', text);
      expect(text).not.toContain(MCP_SECRET);
    }
  });

  it('an internal defect with the server token strips the env token and MCP_AUTH_TOKEN', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, []);
    server = await bootHttp(
      {
        ...COMMON_ENV,
        GLITCHTIP_URL: GLITCHTIP,
        GLITCHTIP_TOKEN: TOKEN,
        MCP_AUTH_TOKEN: MCP_SECRET,
      },
      mock,
    );
    const client = await server.connect({ authorization: `Bearer ${MCP_SECRET}` });
    vi.spyOn(ToolOutput.prototype, 'render').mockImplementation(() => {
      throw new Error(`state ${TOKEN} / ${MCP_SECRET}`);
    });
    await client.callTool({ name: 'list_organizations', arguments: {} });
    assertLive(server.logs(), 'state [redacted] / [redacted]');
    assertClean('log', server.logs());
    expect(server.logs()).not.toContain(MCP_SECRET);
  });

  it('a 401 from the server itself does not echo the bearer', async () => {
    server = await bootHttp({ ...COMMON_ENV, GLITCHTIP_URL: GLITCHTIP }, new MockGlitchTip());
    const response = await fetch(server.mcpUrl, {
      method: 'POST',
      headers: { authorization: `Basic ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
    assertClean('401 body', await response.text());
    assertLive(server.logs(), '"statusCode":401');
    assertClean('log', server.logs());
  });
});
