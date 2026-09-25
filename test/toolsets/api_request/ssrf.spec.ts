import { afterEach, describe, expect, it } from 'vitest';
import { assertInsideApi, normalizeApiPath } from '../../../src/toolsets/api_request/api-path';
import { type Booted, bootInMemory, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import { API, TOKEN, useApiServer, WRITES } from './api_request.support';

// Acceptance 3 (gate: ssrf). Every refused path is refused with no request made,
// through both tools; an accepted path reaches exactly <origin><prefix>/api/0/<path>/.

const call = useApiServer();

const REFUSED = [
  'https://evil.example/x',
  '//evil.example/x',
  'http:/x',
  '..%2F..%2Fadmin',
  '%2e%2e/x',
  '%252e%252e/x',
  'a/../../b',
  'a\\b',
  'org?x=1',
  'a//b',
  'user@host/x',
  'a\u0000b',
  'a'.repeat(2001),
  'org#frag',
  'a b',
  './x',
  'a/%2F/b',
  '%zz',
  'org/%C3',
  'a‮b',
  'api:x/y',
];

describe('path rules refuse before any request (acceptance 3)', () => {
  for (const path of REFUSED) {
    const label = JSON.stringify(path.length > 40 ? `${path.slice(0, 20)}…(${path.length})` : path);

    it(`api_get refuses ${label}`, async () => {
      const mock = new MockGlitchTip();
      const { isError, text } = await call(mock, 'api_get', { path });
      expect(isError).toBe(true);
      expect(mock.requests).toEqual([]);
      expect(text).not.toContain('evil.example');
    });

    it(`api_request refuses ${label}`, async () => {
      const mock = new MockGlitchTip();
      const { isError } = await call(mock, 'api_request', {
        method: 'POST',
        path,
        confirm: `POST /api/0/${path}/`,
      });
      expect(isError).toBe(true);
      expect(mock.requests).toEqual([]);
    });
  }
});

describe('accepted paths reach exactly the instance (acceptance 3)', () => {
  it.each([
    ['organizations/acme/monitors', `${API}/organizations/acme/monitors/`],
    ['organizations/acme/monitors/', `${API}/organizations/acme/monitors/`],
    ['/api/0/organizations/', `${API}/organizations/`],
    ['api/0/organizations', `${API}/organizations/`],
    ['/organizations/', `${API}/organizations/`],
    ['', `${API}/`],
    [
      'organizations/acme/releases/1.0.0+build',
      `${API}/organizations/acme/releases/1.0.0%2Bbuild/`,
    ],
    ['organizations/acme/releases/v%201', undefined],
  ])('%s', async (path, expected) => {
    const mock = new MockGlitchTip();
    if (expected) mock.json('GET', expected, { ok: true });
    const { isError } = await call(mock, 'api_get', { path });
    if (expected === undefined) {
      // An escaped space decodes to a character outside the allowed set.
      expect(isError).toBe(true);
      expect(mock.requests).toEqual([]);
      return;
    }
    expect(isError).toBe(false);
    expect(mock.requests.map((r) => `${r.url.origin}${r.url.pathname}`)).toEqual([expected]);
    expect(mock.unrouted).toEqual([]);
  });

  let booted: Booted | undefined;
  afterEach(async () => {
    await booted?.close();
    booted = undefined;
  });

  it('keeps an instance path prefix and never leaves it', async () => {
    const base = 'https://prefixed.test/glitchtip';
    const mock = new MockGlitchTip().json('GET', `${base}/api/0/organizations/`, []);
    booted = await bootInMemory(
      {
        GLITCHTIP_URL: base,
        GLITCHTIP_TOKEN: TOKEN,
        GLITCHTIP_TOOLSETS: 'api_request',
        ...WRITES,
      },
      mock,
    );
    const ok = await booted.client.callTool({
      name: 'api_get',
      arguments: { path: 'organizations' },
    });
    expect(ok.isError).toBeFalsy();
    const traversal = await booted.client.callTool({
      name: 'api_get',
      arguments: { path: '../../x' },
    });
    expect(traversal.isError).toBe(true);
    expect(resultText(traversal)).toContain('Refused before any request');
    expect(mock.requests.map((r) => r.url.href)).toEqual([`${base}/api/0/organizations/`]);
  });
});

describe('normalizeApiPath and assertInsideApi (unit)', () => {
  it('returns decoded segments and the encoded target', () => {
    expect(normalizeApiPath('organizations/acme/releases/a+b:c,d=e~f')).toEqual({
      segments: ['organizations', 'acme', 'releases', 'a+b:c,d=e~f'],
      target: '/api/0/organizations/acme/releases/a%2Bb%3Ac%2Cd%3De~f/',
    });
    expect(normalizeApiPath('')).toEqual({ segments: [], target: '/api/0/' });
    expect(normalizeApiPath('/api/0')).toEqual({ segments: [], target: '/api/0/' });
  });

  it('decodes once: %41 is A, %2541 is refused', () => {
    expect(normalizeApiPath('%41bc').segments).toEqual(['Abc']);
    expect(() => normalizeApiPath('%2541')).toThrow(/encoded/);
  });

  it('never names the input in its refusal', () => {
    expect(() => normalizeApiPath('https://evil.example/x')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('evil') }),
    );
  });

  it('asserts origin, prefix and an unchanged pathname', () => {
    expect(() => assertInsideApi('https://g.test/base', '/api/0/x/')).not.toThrow();
    expect(() => assertInsideApi('https://g.test/base', '/api/0/../x/')).toThrow(/api\/0/);
    expect(() => assertInsideApi('https://g.test', '/api/0/%2e%2e/x/')).toThrow(/api\/0/);
  });
});
