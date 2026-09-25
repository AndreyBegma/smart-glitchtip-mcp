import { afterEach, describe, expect, it } from 'vitest';
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
];

function assertClean(label: string, text: string): void {
  expect(text, label).not.toContain(TOKEN);
  expect(text, label).not.toContain(HEADER);
}

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

describe('token safety — stdio path (env token)', () => {
  let booted: Booted | undefined;
  afterEach(async () => {
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
    assertClean('log', booted.logs());
    if (mock.requests.length > 0)
      expect(mock.requests[0].headers.get('authorization')).toBe(HEADER);
  });
});

describe('token safety — http path', () => {
  let server: BootedHttp | undefined;
  afterEach(async () => {
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
        MCP_AUTH_TOKEN: 'mcp-secret',
      },
      mock,
    );
    const client = await server.connect({ authorization: 'Bearer mcp-secret' });
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
    expect(resultText(refused)).toMatch(/^instance URL not allowed/);
    for (const text of [resultText(unauthorized), resultText(refused), server.logs()]) {
      assertClean('result or log', text);
      expect(text).not.toContain('mcp-secret');
    }
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
    assertClean('log', server.logs());
  });
});
