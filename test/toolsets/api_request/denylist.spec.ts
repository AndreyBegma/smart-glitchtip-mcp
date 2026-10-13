import { describe, expect, it } from 'vitest';
import { type ApiMethod, deniedReason } from '../../../src/toolsets/api_request/denylist';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import { API, useApiServer } from './api_request.support';

// Acceptance 4: every denylist entry, lower and mixed case, with and without a
// trailing slash, through api_get and api_request alike → a validation error
// naming the reason, with no request made. GET users/me/emails/ stays allowed.

const call = useApiServer();

/** [method, path, a phrase of the reason]; GET entries are tried through both tools. */
const DENIED: [ApiMethod, string, string][] = [
  ['GET', 'generate-recovery-codes', 'recovery codes'],
  ['GET', 'wizard', 'setup-wizard'],
  ['GET', 'wizard/abc', 'setup-wizard'],
  ['POST', 'wizard-set-token', 'API token'],
  ['GET', 'api-tokens', 'token values'],
  ['GET', 'api-tokens/3', 'token values'],
  ['GET', 'accept/1/tok', 'invitation'],
  ['POST', 'stripe/organizations/acme/create-stripe-subscription-checkout', 'Stripe'],
  ['POST', 'stripe/organizations/acme/create-billing-portal', 'Stripe'],
  ['POST', 'import', 'external URL'],
  ['DELETE', 'users/me', 'account'],
  ['POST', 'users/me/emails', 'account-takeover'],
  ['PUT', 'users/me/emails', 'account-takeover'],
  ['DELETE', 'users/me/emails', 'account-takeover'],
  ['POST', 'users/me/emails/confirm', 'account-takeover'],
  ['POST', 'organizations/acme/members/7/set_owner', 'transfer_organization_ownership'],
  ['POST', 'organizations/acme/social-apps', 'SSO app'],
  ['PUT', 'organizations/acme/social-apps/3', 'SSO app'],
];

function mixedCase(path: string): string {
  return path.replace(/[a-z]/g, (c, i: number) => (i % 2 === 0 ? c.toUpperCase() : c));
}

function variants(path: string): string[] {
  return [path, `${path}/`, mixedCase(path), `${mixedCase(path)}/`];
}

describe('denylist through the tools (acceptance 4)', () => {
  for (const [method, path, reason] of DENIED) {
    for (const variant of variants(path)) {
      it(`${method} ${variant} is refused through api_request`, async () => {
        const mock = new MockGlitchTip();
        const target = `/api/0/${variant.replace(/\/$/, '')}/`;
        const { isError, text } = await call(mock, 'api_request', {
          method: method === 'GET' ? 'POST' : method,
          path: variant,
          confirm: `${method === 'GET' ? 'POST' : method} ${target}`,
        });
        expect(isError).toBe(true);
        expect(text).toContain('is not reachable through api_get/api_request');
        expect(text).toContain(reason);
        expect(mock.requests).toEqual([]);
      });

      if (method === 'GET') {
        it(`GET ${variant} is refused through api_get`, async () => {
          const mock = new MockGlitchTip();
          const { isError, text } = await call(mock, 'api_get', { path: variant });
          expect(isError).toBe(true);
          expect(text).toContain(reason);
          expect(mock.requests).toEqual([]);
        });
      }
    }
  }

  it('allows GET users/me/emails/', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/users/me/emails/`, [
      { email: 'a@b.test', isPrimary: true, isVerified: true },
    ]);
    const { isError, text } = await call(mock, 'api_get', { path: 'users/me/emails/' });
    expect(isError).toBe(false);
    expect(text).toContain('a@b.test');
    expect(mock.requests).toHaveLength(1);
  });
});

describe('deniedReason (unit)', () => {
  it.each<[ApiMethod, string[]]>([
    ['GET', ['users', 'me']],
    ['PUT', ['users', 'me']],
    ['GET', ['users', 'me', 'emails']],
    ['DELETE', ['organizations', 'acme', 'social-apps', '3']],
    ['GET', ['organizations', 'acme', 'social-apps']],
    ['GET', ['stripe', 'products']],
    ['POST', ['projects', 'acme', 'web', 'reprocessing']],
    ['GET', ['organizations', 'import']],
  ])('allows %s %j', (method, segments) => {
    expect(deniedReason(method, segments)).toBeUndefined();
  });

  it('denies every method on a whole-route entry, and anything below one', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(deniedReason(method, ['generate-recovery-codes'])).toBeDefined();
      expect(deniedReason(method, ['WIZARD', 'x', 'y'])).toBeDefined();
    }
  });
});
