import { describe, expect, it } from 'vitest';
import { MockGlitchTip } from '../../test/support/mock-glitchtip';
import { type AppConfig, loadConfig } from '../config/config';
import { type AuthGrant, recordAuthGrant } from './auth-grant';
import { InstanceError, InstanceResolver } from './instance.resolver';

const ENV_URL = 'https://env.test';
const ENV_TOKEN = 'tok_ENV_SECRET';
const CLIENT_TOKEN = 'tok_CLIENT_SECRET';

function httpConfig(extra: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    MCP_TRANSPORT: 'http',
    MCP_AUTH_TOKEN: 'shared-secret-0123456',
    GLITCHTIP_URL: ENV_URL,
    GLITCHTIP_TOKEN: ENV_TOKEN,
    GLITCHTIP_ALLOWED_URLS: 'https://allowed.test, https://prefixed.test/glitchtip',
    ...extra,
  });
}

function request(grant: AuthGrant | undefined, headers: Record<string, string> = {}): object {
  const req = { headers };
  if (grant) recordAuthGrant(req, grant);
  return req;
}

const passthrough: AuthGrant = { mode: 'passthrough', token: CLIENT_TOKEN };
const server: AuthGrant = { mode: 'server' };

function resolveError(resolver: InstanceResolver, raw: unknown): InstanceError {
  try {
    resolver.resolve(raw);
  } catch (error) {
    if (error instanceof InstanceError) return error;
    throw error;
  }
  throw new Error('expected an InstanceError');
}

describe('InstanceResolver.resolve', () => {
  it('uses env URL, token and org on stdio', () => {
    const resolver = new InstanceResolver(
      loadConfig({
        GLITCHTIP_URL: ENV_URL,
        GLITCHTIP_TOKEN: ENV_TOKEN,
        GLITCHTIP_DEFAULT_ORG: 'acme',
      }),
    );
    const instance = resolver.resolve(undefined);
    expect(instance.url).toBe(ENV_URL);
    expect(instance.authorizationHeader()).toBe(`Bearer ${ENV_TOKEN}`);
    expect(instance.defaultOrg).toBe('acme');
  });

  it('fails closed in http mode when no request is bound: never the env token', () => {
    const resolver = new InstanceResolver(httpConfig());
    for (const raw of [undefined, null]) {
      expect(() => resolver.resolve(raw)).toThrow(
        'No HTTP request is bound to this tool call in http mode.',
      );
      // Not agent-facing: it surfaces as an internal error with an id.
      expect(() => resolver.resolve(raw)).not.toThrow(InstanceError);
    }
  });

  it('server grant → env instance and env token, org header wins over env', () => {
    const resolver = new InstanceResolver(httpConfig({ GLITCHTIP_DEFAULT_ORG: 'env-org' }));
    const instance = resolver.resolve(request(server, { 'x-glitchtip-org': 'hdr-org' }));
    expect(instance.url).toBe(ENV_URL);
    expect(instance.authorizationHeader()).toBe(`Bearer ${ENV_TOKEN}`);
    expect(instance.defaultOrg).toBe('hdr-org');
  });

  it('server grant refuses a URL header, even an allowlisted one', () => {
    const resolver = new InstanceResolver(httpConfig());
    const error = resolveError(
      resolver,
      request(server, { 'x-glitchtip-url': 'https://allowed.test' }),
    );
    expect(error.message).toContain('X-GlitchTip-Url is not accepted with the server token');
  });

  it('server grant without an env GlitchTip token is a tool error', () => {
    const resolver = new InstanceResolver(
      loadConfig({
        MCP_TRANSPORT: 'http',
        MCP_AUTH_TOKEN: 'shared-secret-0123456',
        GLITCHTIP_URL: ENV_URL,
      }),
    );
    expect(resolveError(resolver, request(server)).message).toBe(
      'No GlitchTip token is configured on the server; send your own GlitchTip token as Bearer.',
    );
  });

  it('pass-through forwards the client token to the env URL when no header is sent', () => {
    const instance = new InstanceResolver(httpConfig()).resolve(request(passthrough));
    expect(instance.url).toBe(ENV_URL);
    expect(instance.authorizationHeader()).toBe(`Bearer ${CLIENT_TOKEN}`);
  });

  it.each([
    ['https://allowed.test', 'https://allowed.test'],
    ['https://ALLOWED.test/', 'https://allowed.test'],
    ['https://prefixed.test/glitchtip/', 'https://prefixed.test/glitchtip'],
    ['https://env.test', ENV_URL],
  ])('pass-through accepts allowlisted header URL %s', (header, expected) => {
    const resolver = new InstanceResolver(httpConfig());
    expect(resolver.resolve(request(passthrough, { 'x-glitchtip-url': header })).url).toBe(
      expected,
    );
  });

  it.each([
    'https://evil.test',
    'https://allowed.test.evil.test',
    'https://allowed.test:8443',
    'http://allowed.test',
    'https://prefixed.test/other',
    'http://169.254.169.254/latest/meta-data',
    'http://localhost:6379',
    'file:///etc/passwd',
    'https://allowed.test/?x=1',
    'not-a-url',
  ])('pass-through refuses %s (ssrf)', (header) => {
    const resolver = new InstanceResolver(httpConfig());
    const error = resolveError(resolver, request(passthrough, { 'x-glitchtip-url': header }));
    expect(error.message).toMatch(/^instance URL not allowed: /);
    expect(error.message).not.toContain(CLIENT_TOKEN);
  });

  it('with an empty allowlist only the env URL is accepted', () => {
    const resolver = new InstanceResolver(httpConfig({ GLITCHTIP_ALLOWED_URLS: '' }));
    expect(resolver.resolve(request(passthrough, { 'x-glitchtip-url': ENV_URL })).url).toBe(
      ENV_URL,
    );
    expect(
      resolveError(resolver, request(passthrough, { 'x-glitchtip-url': 'https://allowed.test' }))
        .message,
    ).toMatch(/^instance URL not allowed/);
  });

  it('names a refused URL without its credentials', () => {
    const resolver = new InstanceResolver(httpConfig());
    const error = resolveError(
      resolver,
      request(passthrough, { 'x-glitchtip-url': 'https://me:hunter2@evil.test/x?token=abc' }),
    );
    expect(error.message).toContain('https://evil.test/x');
    expect(error.message).not.toContain('hunter2');
    expect(error.message).not.toContain('abc');
  });

  it('pass-through with no header and no env URL says how to fix it', () => {
    const resolver = new InstanceResolver(loadConfig({ MCP_TRANSPORT: 'http' }));
    expect(resolveError(resolver, request(passthrough)).message).toBe(
      'No GlitchTip instance: send X-GlitchTip-Url or set GLITCHTIP_URL.',
    );
  });

  it('refuses a request the guard never saw', () => {
    const resolver = new InstanceResolver(httpConfig());
    expect(resolveError(resolver, request(undefined)).message).toBe(
      'The request was not authenticated.',
    );
  });

  it('refuses a malformed org header', () => {
    const resolver = new InstanceResolver(httpConfig());
    expect(
      resolveError(resolver, request(server, { 'x-glitchtip-org': '../admin' })).message,
    ).toContain('X-GlitchTip-Org');
  });

  it('never serialises the token', () => {
    const instance = new InstanceResolver(httpConfig()).resolve(request(passthrough));
    expect(JSON.stringify(instance)).not.toContain(CLIENT_TOKEN);
    expect(JSON.stringify({ nested: instance })).not.toContain(CLIENT_TOKEN);
  });
});

describe('GlitchTipConnection.organization', () => {
  const ORGS = `${ENV_URL}/api/0/organizations/`;

  function connect(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
    const resolver = new InstanceResolver(
      loadConfig({ GLITCHTIP_URL: ENV_URL, GLITCHTIP_TOKEN: ENV_TOKEN, ...env }),
      mock.fetch,
    );
    return { resolver, connection: resolver.connect(undefined) };
  }

  it('prefers the requested org, then the configured default, without a lookup', async () => {
    const mock = new MockGlitchTip();
    const { connection } = connect(mock, { GLITCHTIP_DEFAULT_ORG: 'env-org' });
    expect(await connection.organization('asked')).toBe('asked');
    expect(await connection.organization()).toBe('env-org');
    expect(mock.requests).toHaveLength(0);
  });

  it('auto-selects the only visible organization and caches it', async () => {
    const mock = new MockGlitchTip().json('GET', ORGS, [{ slug: 'solo' }]);
    const { resolver } = connect(mock);
    expect(await resolver.connect(undefined).organization()).toBe('solo');
    expect(await resolver.connect(undefined).organization()).toBe('solo');
    expect(mock.requests).toHaveLength(1);
  });

  it('lists the slugs when several organizations are visible', async () => {
    const mock = new MockGlitchTip().json('GET', ORGS, [{ slug: 'a' }, { slug: 'b' }]);
    await expect(connect(mock).connection.organization()).rejects.toThrow(
      'Several organizations are visible to this token (a, b); pass `organization`.',
    );
  });

  it('says so when no organization is visible', async () => {
    const mock = new MockGlitchTip().json('GET', ORGS, []);
    await expect(connect(mock).connection.organization()).rejects.toThrow(
      'No organizations are visible',
    );
  });
});
