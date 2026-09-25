import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract (D-14): every endpoint the foundation calls exists in the
// GlitchTip 6.2.6 snapshot with the parameters and fields the tools rely on.
// The generated types enforce the same at compile time; this names the
// dependency explicitly so a snapshot refresh that drops one fails loudly.

interface Operation {
  parameters?: { name: string; in: string }[];
  requestBody?: unknown;
  responses: Record<
    string,
    { content?: { 'application/json'?: { schema: { $ref?: string; items?: { $ref?: string } } } } }
  >;
}
interface Spec {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, { properties: Record<string, unknown> }> };
}

const spec = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'docs', 'reference', 'glitchtip-openapi.json'), 'utf8'),
) as Spec;

function operation(method: string, path: string): Operation {
  const op = spec.paths[path]?.[method];
  if (!op) throw new Error(`${method.toUpperCase()} ${path} is missing from the snapshot`);
  return op;
}

function schemaOf(method: string, path: string, status: string): string {
  const schema = operation(method, path).responses[status]?.content?.['application/json']?.schema;
  const ref = schema?.$ref ?? schema?.items?.$ref;
  return (ref ?? '').split('/').at(-1) ?? '';
}

function fields(schema: string): string[] {
  return Object.keys(spec.components.schemas[schema]?.properties ?? {});
}

describe('GlitchTip OpenAPI snapshot', () => {
  it.each([
    ['get', '/api/0/'],
    ['get', '/api/0/organizations/'],
    ['post', '/api/0/organizations/'],
    ['get', '/api/0/organizations/{organization_slug}/'],
    ['put', '/api/0/organizations/{organization_slug}/'],
    ['delete', '/api/0/organizations/{organization_slug}/'],
    ['get', '/api/0/organizations/{organization_slug}/environments/'],
  ])('has %s %s', (method, path) => {
    expect(() => operation(method, path)).not.toThrow();
  });

  it('pages lists with limit and cursor', () => {
    for (const path of [
      '/api/0/organizations/',
      '/api/0/organizations/{organization_slug}/environments/',
    ]) {
      const names = operation('get', path).parameters?.map((p) => p.name) ?? [];
      expect(names).toEqual(expect.arrayContaining(['limit', 'cursor']));
    }
    const envParams = operation(
      'get',
      '/api/0/organizations/{organization_slug}/environments/',
    ).parameters;
    expect(envParams?.map((p) => p.name)).toContain('visibility');
  });

  it('returns the fields the tools project', () => {
    expect(fields(schemaOf('get', '/api/0/', '200'))).toEqual(
      expect.arrayContaining(['version', 'user', 'auth']),
    );
    expect(fields('APITokenSchema')).toContain('scopes');
    expect(fields(schemaOf('get', '/api/0/organizations/', '200'))).toEqual(
      expect.arrayContaining(['slug', 'name', 'dateCreated']),
    );
    expect(fields(schemaOf('get', '/api/0/organizations/{organization_slug}/', '200'))).toEqual(
      expect.arrayContaining([
        'projects',
        'teams',
        'access',
        'openMembership',
        'isAcceptingEvents',
      ]),
    );
    expect(fields('OrganizationInSchema')).toEqual(['name']);
    expect(fields('EnvironmentSchema')).toContain('name');
  });
});
