import { describe, expect, it } from 'vitest';
import { GlitchTipError } from './glitchtip.errors';
import { assertCallerHeaders, rawRequestUrl } from './request-guards';

// FEAT-20260925-015 grants: array query values for the api_request escape
// hatch, and the path-override headers carried from the BUG-20260925-006 review.

const INSTANCE = 'https://glitchtip.test';
const OP = { name: 'call the API', scopes: [] };

describe('rawRequestUrl query', () => {
  it('repeats the parameter once per array item, in order', () => {
    const url = rawRequestUrl(INSTANCE, OP, '/api/0/x/', { id: ['1', 2, '3'], q: 'a/b' });
    expect(url.search).toBe('?id=1&id=2&id=3&q=a%2Fb');
    expect(url.searchParams.getAll('id')).toEqual(['1', '2', '3']);
  });

  it('sends nothing for an empty array or an undefined value', () => {
    const url = rawRequestUrl(INSTANCE, OP, '/api/0/x/', { id: [], other: undefined });
    expect(url.search).toBe('');
  });
});

describe('assertCallerHeaders', () => {
  it.each(['X-Original-URL', 'x-original-url', 'X-Rewrite-URL', 'x-rewrite-url'])(
    'refuses a caller %s header',
    (name) => {
      let thrown: unknown;
      try {
        assertCallerHeaders({ [name]: '/admin/' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GlitchTipError);
      expect((thrown as GlitchTipError).kind).toBe('invalid');
      expect((thrown as GlitchTipError).message).not.toContain('/admin/');
    },
  );

  it('allows an ordinary header', () => {
    expect(() => assertCallerHeaders({ 'content-type': 'text/plain' })).not.toThrow();
  });
});
