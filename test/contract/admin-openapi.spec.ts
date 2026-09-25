import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract (D-14) for the admin toolset: every route and field its tools rely on exists in
// the GlitchTip 6.2.6 snapshot, so a snapshot refresh that drops one fails loudly.

interface Operation {
  parameters?: { name: string; in: string; schema?: unknown }[];
  requestBody?: {
    content?: { 'application/json'?: { schema: { $ref?: string } } };
  };
  responses: Record<
    string,
    { content?: { 'application/json'?: { schema: { $ref?: string; items?: { $ref?: string } } } } }
  >;
}
interface Spec {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
}

const spec = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'docs', 'reference', 'glitchtip-openapi.json'), 'utf8'),
) as Spec;

function operation(method: string, path: string): Operation {
  const op = spec.paths[path]?.[method];
  if (!op) throw new Error(`${method.toUpperCase()} ${path} is missing from the snapshot`);
  return op;
}

function refName(ref: string | undefined): string {
  return (ref ?? '').split('/').at(-1) ?? '';
}

function responseSchema(method: string, path: string, status = '200'): string {
  const schema = operation(method, path).responses[status]?.content?.['application/json']?.schema;
  return refName(schema?.$ref ?? schema?.items?.$ref);
}

function requestSchema(method: string, path: string): string {
  return refName(operation(method, path).requestBody?.content?.['application/json']?.schema.$ref);
}

function fields(schema: string): string[] {
  return Object.keys(spec.components.schemas[schema]?.properties ?? {});
}

const USER = '/api/0/users/{user_id}/';
const EMAILS = '/api/0/users/{user_id}/emails/';
const NOTIFICATIONS = '/api/0/users/{user_id}/notifications/';
const ALERTS = '/api/0/users/{user_id}/notifications/alerts/';
const LICENSE = '/api/0/instance-license/';
const SUPPORT_LINK = '/api/0/instance-license/support-link/';
const SOCIAL_APPS = '/api/0/organizations/{organization_slug}/social-apps/';
const SOCIAL_APP = '/api/0/organizations/{organization_slug}/social-apps/{social_app_id}/';

describe('GlitchTip OpenAPI snapshot — admin', () => {
  it.each([
    ['get', USER],
    ['put', USER],
    ['get', EMAILS],
    ['get', NOTIFICATIONS],
    ['put', NOTIFICATIONS],
    ['get', ALERTS],
    ['put', ALERTS],
    ['get', LICENSE],
    ['get', SUPPORT_LINK],
    ['get', SOCIAL_APPS],
    ['delete', SOCIAL_APP],
  ])('has %s %s', (method, path) => {
    expect(() => operation(method, path)).not.toThrow();
  });

  it('user routes take a user_id path parameter (sent as the literal `me`)', () => {
    for (const path of [USER, EMAILS, NOTIFICATIONS, ALERTS]) {
      expect(operation('get', path).parameters?.map((p) => p.name)).toContain('user_id');
    }
  });

  it('returns and accepts the fields the tools project and send', () => {
    expect(fields(responseSchema('get', USER))).toEqual(
      expect.arrayContaining([
        'id',
        'email',
        'name',
        'dateJoined',
        'lastLogin',
        'isSuperuser',
        'isActive',
        'hasPasswordAuth',
        'identities',
        'options',
      ]),
    );
    expect(fields('SocialAccountSchema')).toEqual(expect.arrayContaining(['provider', 'email']));
    expect(fields('UserOptions').sort()).toEqual(
      ['clock24Hours', 'language', 'preferredTheme', 'stacktraceOrder', 'timezone'].sort(),
    );
    expect(fields(requestSchema('put', USER)).sort()).toEqual(['name', 'options']);
    expect(fields(responseSchema('get', EMAILS))).toEqual(
      expect.arrayContaining(['email', 'isPrimary', 'isVerified']),
    );
    expect(fields(requestSchema('put', NOTIFICATIONS))).toEqual(['subscribeByDefault']);
    expect(requestSchema('put', ALERTS)).toBe('StrKeyIntValue');
    expect(fields(responseSchema('get', LICENSE))).toContain('billingEmail');
    expect(fields(responseSchema('get', SUPPORT_LINK))).toContain('url');
    expect(fields(responseSchema('get', SOCIAL_APPS))).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'provider',
        'brand',
        'serverUrl',
        'loginUrl',
        'callbackUrl',
        'clientID',
      ]),
    );
    expect(fields(responseSchema('get', SOCIAL_APPS))).not.toContain('clientSecret');
  });
});
