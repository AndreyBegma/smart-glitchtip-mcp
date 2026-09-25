import { describe, expect, it } from 'vitest';
import { TOOLSET_NAMES } from '../toolsets/toolset';
import { ConfigError, configWarnings, loadConfig } from './config';
import { normalizeInstanceUrl } from './instance-url';

const STDIO = { GLITCHTIP_URL: 'https://glitchtip.test', GLITCHTIP_TOKEN: 'tok_SECRET_123' };

function problemsOf(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected loadConfig to fail');
}

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig(STDIO);
    expect(config).toMatchObject({
      transport: 'stdio',
      http: { port: 8080, path: '/mcp' },
      glitchtip: { url: 'https://glitchtip.test', allowedUrls: [], timeoutMs: 15_000 },
      toolsets: ['organizations', 'issues', 'events', 'projects'],
      readOnly: true,
      responseBudget: 20_000,
      logLevel: 'info',
    });
  });

  it('normalises URLs and the allowlist', () => {
    const config = loadConfig({
      ...STDIO,
      GLITCHTIP_URL: 'https://GlitchTip.test/',
      GLITCHTIP_ALLOWED_URLS: 'https://a.test/, https://b.test/prefix/',
    });
    expect(config.glitchtip.url).toBe('https://glitchtip.test');
    expect(config.glitchtip.allowedUrls).toEqual(['https://a.test', 'https://b.test/prefix']);
  });

  it('treats empty variables as unset', () => {
    expect(loadConfig({ ...STDIO, MCP_HTTP_PORT: '', GLITCHTIP_READ_ONLY: ' ' }).readOnly).toBe(
      true,
    );
  });

  it('parses read-only as a boolean', () => {
    expect(loadConfig({ ...STDIO, GLITCHTIP_READ_ONLY: 'false' }).readOnly).toBe(false);
    expect(problemsOf({ ...STDIO, GLITCHTIP_READ_ONLY: 'maybe' })[0]).toMatch(
      /^GLITCHTIP_READ_ONLY: /,
    );
  });

  it('expands toolsets=all', () => {
    expect(loadConfig({ ...STDIO, GLITCHTIP_TOOLSETS: 'all' }).toolsets).toEqual([
      ...TOOLSET_NAMES,
    ]);
  });

  it('refuses an unknown toolset and lists the valid names', () => {
    const [problem] = problemsOf({ ...STDIO, GLITCHTIP_TOOLSETS: 'organizations,bogus' });
    expect(problem).toContain('GLITCHTIP_TOOLSETS');
    expect(problem).toContain('bogus');
    for (const name of TOOLSET_NAMES) expect(problem).toContain(name);
  });

  it('requires GLITCHTIP_URL in stdio mode', () => {
    expect(problemsOf({})).toContain('GLITCHTIP_URL: required when MCP_TRANSPORT is stdio');
  });

  it('accepts a strong MCP_AUTH_TOKEN', () => {
    const config = loadConfig({ MCP_TRANSPORT: 'http', MCP_AUTH_TOKEN: 'a'.repeat(16) });
    expect(config.http.authToken).toHaveLength(16);
  });

  it('refuses http with an env token and no MCP_AUTH_TOKEN', () => {
    const problems = problemsOf({ ...STDIO, MCP_TRANSPORT: 'http' });
    expect(problems.join('\n')).toMatch(/^MCP_AUTH_TOKEN: required/);
  });

  it.each([
    ['short', 'must be at least 16 characters'],
    ['has white space in it 0123', 'must not contain whitespace'],
  ])('refuses a weak MCP_AUTH_TOKEN (%s) without echoing it', (secret, reason) => {
    const problems = problemsOf({ MCP_TRANSPORT: 'http', MCP_AUTH_TOKEN: secret });
    expect(problems).toEqual([`MCP_AUTH_TOKEN: ${reason}`]);
    expect(problems.join('\n')).not.toContain(secret);
  });

  it('allows http without any URL or token (pure pass-through)', () => {
    expect(loadConfig({ MCP_TRANSPORT: 'http' }).glitchtip.url).toBeUndefined();
  });

  it('reports every problem at once, naming variables and never their values', () => {
    const secret = 'tok_SECRET_123';
    const problems = problemsOf({
      MCP_TRANSPORT: 'carrier-pigeon',
      MCP_HTTP_PORT: secret,
      GLITCHTIP_URL: `https://user:${secret}@glitchtip.test`,
      GLITCHTIP_TIMEOUT_MS: '-1',
    });
    expect(problems.map((p) => p.split(':')[0]).sort()).toEqual([
      'GLITCHTIP_TIMEOUT_MS',
      'GLITCHTIP_URL',
      'MCP_HTTP_PORT',
      'MCP_TRANSPORT',
    ]);
    expect(problems.join('\n')).not.toContain(secret);
  });
});

describe('configWarnings', () => {
  it('warns about stdio without a token', () => {
    const config = loadConfig({ GLITCHTIP_URL: 'https://glitchtip.test' });
    expect(configWarnings(config)).toEqual([expect.stringContaining('GLITCHTIP_TOKEN is not set')]);
  });

  it('warns about a server token with no env GlitchTip token', () => {
    const config = loadConfig({ MCP_TRANSPORT: 'http', MCP_AUTH_TOKEN: 'shared-secret-0123456' });
    expect(configWarnings(config)).toEqual([
      expect.stringContaining('MCP_AUTH_TOKEN is set but GLITCHTIP_TOKEN is not'),
    ]);
  });

  it('is silent for a complete configuration', () => {
    expect(configWarnings(loadConfig(STDIO))).toEqual([]);
  });
});

describe('normalizeInstanceUrl', () => {
  it.each([
    ['https://g.test', 'https://g.test'],
    ['https://g.test/', 'https://g.test'],
    ['HTTPS://G.TEST:443/', 'https://g.test'],
    ['http://g.test:8000/base//', 'http://g.test:8000/base'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeInstanceUrl(raw)).toBe(expected);
  });

  it.each([
    'ftp://g.test',
    'file:///etc/passwd',
    'https://u:p@g.test',
    'https://g.test/?a=1',
    'https://g.test/#x',
    'not a url',
  ])('refuses %s', (raw) => {
    expect(normalizeInstanceUrl(raw)).toBeUndefined();
  });
});
