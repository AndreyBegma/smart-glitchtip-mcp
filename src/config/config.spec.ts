import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  it('parses GLITCHTIP_API_REQUEST_ALLOW_WRITE like read-only, default false', () => {
    expect(loadConfig(STDIO).apiRequestAllowWrite).toBe(false);
    expect(
      loadConfig({ ...STDIO, GLITCHTIP_API_REQUEST_ALLOW_WRITE: 'TRUE' }).apiRequestAllowWrite,
    ).toBe(true);
    expect(
      loadConfig({ ...STDIO, GLITCHTIP_API_REQUEST_ALLOW_WRITE: '0' }).apiRequestAllowWrite,
    ).toBe(false);
    expect(problemsOf({ ...STDIO, GLITCHTIP_API_REQUEST_ALLOW_WRITE: 'maybe' })).toEqual([
      expect.stringMatching(/^GLITCHTIP_API_REQUEST_ALLOW_WRITE: /),
    ]);
  });

  it('expands toolsets=all (uploads needs an upload root, see below)', () => {
    expect(loadConfig({ ...STDIO, GLITCHTIP_TOOLSETS: 'all' }).toolsets).toEqual(
      TOOLSET_NAMES.filter((name) => name !== 'uploads'),
    );
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

describe('uploads (D-22)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sgm-config-'));
    mkdirSync(join(dir, 'root'));
    writeFileSync(join(dir, 'file'), 'x');
    symlinkSync(join(dir, 'root'), join(dir, 'link'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const root = () => join(dir, 'root');
  const HTTP = { MCP_TRANSPORT: 'http' };
  const withRoot = (env: NodeJS.ProcessEnv, toolsets: string) =>
    loadConfig({ ...env, GLITCHTIP_TOOLSETS: toolsets, GLITCHTIP_UPLOAD_ROOT: root() });

  it('defaults the size cap to 256 MiB and leaves the root unset', () => {
    expect(loadConfig(STDIO).uploads).toEqual({ root: undefined, maxBytes: 268_435_456 });
  });

  it('stores the root as its realpath', () => {
    const config = loadConfig({ ...STDIO, GLITCHTIP_UPLOAD_ROOT: join(dir, 'link') });
    expect(config.uploads.root).toBe(realpathSync(root()));
  });

  it.each([
    ['relative', () => 'root', 'must be an absolute path'],
    ['missing', () => join(dir, 'nope'), 'must be an existing directory'],
    ['a file', () => join(dir, 'file'), 'must be a directory, not a file'],
    ['the filesystem root', () => '/', 'must not be the filesystem root'],
  ])('refuses a root that is %s, whatever the toolsets', (_, value, reason) => {
    const problems = problemsOf({ ...STDIO, GLITCHTIP_UPLOAD_ROOT: value() });
    expect(problems).toEqual([`GLITCHTIP_UPLOAD_ROOT: ${reason}`]);
  });

  it.each([
    ['0', false],
    ['1', true],
    ['2147483648', true],
    ['2147483649', false],
  ])('bounds GLITCHTIP_UPLOAD_MAX_BYTES (%s)', (value, ok) => {
    const env = { ...STDIO, GLITCHTIP_UPLOAD_MAX_BYTES: value };
    if (ok) expect(loadConfig(env).uploads.maxBytes).toBe(Number(value));
    else expect(problemsOf(env)[0]).toMatch(/^GLITCHTIP_UPLOAD_MAX_BYTES: /);
  });

  it('records how the toolsets were chosen', () => {
    expect(withRoot(STDIO, 'uploads')).toMatchObject({
      toolsetsMode: 'explicit',
      toolsetsExplicit: true,
    });
    expect(loadConfig({ ...STDIO, GLITCHTIP_TOOLSETS: 'all' })).toMatchObject({
      toolsetsMode: 'all',
      toolsetsExplicit: false,
    });
    expect(loadConfig(STDIO)).toMatchObject({ toolsetsMode: 'default', toolsetsExplicit: false });
  });

  it('refuses uploads named explicitly in http mode', () => {
    expect(problemsOf({ ...HTTP, GLITCHTIP_TOOLSETS: 'issues,uploads' })).toEqual([
      'GLITCHTIP_TOOLSETS: The uploads toolset reads local files and is available in stdio mode only (D-06). Remove it from GLITCHTIP_TOOLSETS.',
    ]);
  });

  it('refuses uploads named explicitly in stdio without a root, naming the key', () => {
    expect(problemsOf({ ...STDIO, GLITCHTIP_TOOLSETS: 'uploads' })).toEqual([
      'GLITCHTIP_UPLOAD_ROOT: required when GLITCHTIP_TOOLSETS names uploads',
    ]);
  });

  it('keeps uploads named explicitly in stdio with a root', () => {
    const config = withRoot(STDIO, 'uploads');
    expect(config.toolsets).toEqual(['uploads']);
    expect(configWarnings(config)).toEqual([]);
  });

  it('includes uploads in all, in stdio, with a root', () => {
    const config = withRoot(STDIO, 'all');
    expect(config.toolsets).toEqual([...TOOLSET_NAMES]);
    expect(configWarnings(config)).toEqual([]);
  });

  it('leaves uploads out of all in http mode, with one warning', () => {
    const config = withRoot(HTTP, 'all');
    expect(config.toolsets).not.toContain('uploads');
    expect(config.toolsets).toHaveLength(TOOLSET_NAMES.length - 1);
    expect(configWarnings(config)).toEqual([
      'GLITCHTIP_TOOLSETS=all leaves out the uploads toolset: it reads local files and is available in stdio mode only (D-06).',
    ]);
  });

  it('leaves uploads out of all in stdio without a root, with one warning', () => {
    const config = loadConfig({ ...STDIO, GLITCHTIP_TOOLSETS: 'all' });
    expect(config.toolsets).not.toContain('uploads');
    expect(configWarnings(config)).toEqual([
      'GLITCHTIP_TOOLSETS=all leaves out the uploads toolset: GLITCHTIP_UPLOAD_ROOT is not set.',
    ]);
  });

  it.each([
    ['http', { MCP_TRANSPORT: 'http' }, 'stdio mode only'],
    ['stdio without a root', STDIO, 'GLITCHTIP_UPLOAD_ROOT: required'],
  ])('treats all,uploads as naming uploads explicitly (%s)', (_, env, problem) => {
    const problems = problemsOf({ ...env, GLITCHTIP_TOOLSETS: 'all,uploads' });
    expect(problems).toEqual([expect.stringContaining(problem)]);
    expect(withRoot(STDIO, 'all,uploads')).toMatchObject({
      toolsets: [...TOOLSET_NAMES],
      toolsetsMode: 'explicit',
      toolsetsExplicit: true,
    });
  });

  it('warns when GLITCHTIP_UPLOAD_ROOT is set but uploads is not enabled', () => {
    expect(configWarnings(withRoot(STDIO, 'issues'))).toEqual([
      'GLITCHTIP_UPLOAD_ROOT is set but the uploads toolset is not enabled, so it has no effect; add uploads to GLITCHTIP_TOOLSETS.',
    ]);
    const unset = loadConfig({ ...STDIO, GLITCHTIP_UPLOAD_ROOT: root() });
    expect(configWarnings(unset)).toHaveLength(1);
  });

  it('does not warn about uploads when the toolsets are the defaults', () => {
    const config = loadConfig({ ...HTTP, MCP_AUTH_TOKEN: 'a'.repeat(16), GLITCHTIP_TOKEN: 't' });
    expect(configWarnings(config)).toEqual([]);
  });
});

describe('GLITCHTIP_API_REQUEST_ALLOW_WRITE warnings (FEAT-20260925-015)', () => {
  const allow = { ...STDIO, GLITCHTIP_API_REQUEST_ALLOW_WRITE: 'true' };

  it('warns that the flag has no effect while read-only', () => {
    const config = loadConfig({ ...allow, GLITCHTIP_TOOLSETS: 'api_request' });
    expect(configWarnings(config)).toEqual([
      expect.stringContaining('GLITCHTIP_API_REQUEST_ALLOW_WRITE has no effect while read-only'),
    ]);
  });

  it('warns that the flag has no effect while the toolset is disabled', () => {
    const config = loadConfig({ ...allow, GLITCHTIP_READ_ONLY: 'false' });
    expect(configWarnings(config)).toEqual([
      expect.stringContaining('api_request toolset is not enabled'),
    ]);
  });

  it('does not warn when the flag takes effect, or is off', () => {
    const on = { ...allow, GLITCHTIP_READ_ONLY: 'false', GLITCHTIP_TOOLSETS: 'api_request' };
    expect(configWarnings(loadConfig(on))).toEqual([]);
    expect(configWarnings(loadConfig({ ...STDIO, GLITCHTIP_TOOLSETS: 'api_request' }))).toEqual([]);
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
