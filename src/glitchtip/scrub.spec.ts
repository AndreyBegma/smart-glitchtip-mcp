import { describe, expect, it } from 'vitest';
import { Redactor } from './redactor';
import { scrubSecrets } from './scrub';

// BUG-20260930-021: the parsed success body is scrubbed before any view cuts
// a field. Moved here from FEAT-019's `scrubResponse`, which this replaces.

const TOKEN = 'tok_UNIT_secret';
const redactor = new Redactor(TOKEN);

describe('scrubSecrets', () => {
  it('removes the token from every string, keys included, keeping the shape', () => {
    const response = {
      title: `a ${TOKEN} b`,
      nested: [{ value: TOKEN }, 7, null, true],
      [`key ${TOKEN}`]: 1,
    };
    const scrubbed = scrubSecrets(response, redactor);
    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed).toEqual({
      title: 'a [redacted] b',
      nested: [{ value: '[redacted]' }, 7, null, true],
      'key [redacted]': 1,
    });
  });

  it('leaves the input unchanged and copies only the path to a secret', () => {
    const clean = { id: 1, tags: [{ key: 'a' }] };
    const response = { clean, dirty: [TOKEN] };
    const scrubbed = scrubSecrets(response, redactor);
    expect(response.dirty).toEqual([TOKEN]);
    expect(scrubbed).not.toBe(response);
    expect(scrubbed.clean).toBe(clean);
  });

  it('returns a response with nothing to redact by identity', () => {
    const response = { items: [{ title: 'fine', count: 3 }], next: null };
    expect(scrubSecrets(response, redactor)).toBe(response);
  });

  it('removes the token from a bare string and a top-level list', () => {
    expect(scrubSecrets(`x${TOKEN}`, redactor)).toBe('x[redacted]');
    expect(scrubSecrets([TOKEN, 'y'], redactor)).toEqual(['[redacted]', 'y']);
  });

  it('removes a token quoted JSON-escaped inside a string value', () => {
    const token = 'tok_"quoted"\\secret';
    const escaped = JSON.stringify({ auth: token });
    const scrubbed = scrubSecrets({ body: escaped, title: `x ${token} y` }, new Redactor(token));
    expect(scrubbed.title).toBe('x [redacted] y');
    expect(scrubbed.body).toBe('{"auth":"[redacted]"}');
  });

  it('keeps the keys in their order when one is redacted', () => {
    const scrubbed = scrubSecrets({ a: 1, [`k ${TOKEN}`]: 2, z: 3 }, redactor);
    expect(Object.keys(scrubbed)).toEqual(['a', 'k [redacted]', 'z']);
  });

  it('keeps both values when two keys redact alike', () => {
    const token = 'tok_"quoted"\\secret';
    const escaped = JSON.stringify(token).slice(1, -1);
    const response = { [`k ${token}`]: 1, [`k ${escaped}`]: 2, 'k [redacted]': 3 };
    const scrubbed = scrubSecrets(response, new Redactor(token));
    expect(scrubbed).toEqual({ 'k [redacted]': 1, 'k [redacted] #2': 2, 'k [redacted] #3': 3 });
    expect(Object.keys(scrubbed)).toEqual(['k [redacted]', 'k [redacted] #2', 'k [redacted] #3']);
  });

  it('keeps an own __proto__ key as data, not as the copy’s prototype', () => {
    const response = JSON.parse(`{"__proto__": {"polluted": true}, "t": "${TOKEN}"}`);
    const scrubbed = scrubSecrets(response, redactor);
    expect(Object.getPrototypeOf(scrubbed)).toBe(Object.prototype);
    expect(Object.hasOwn(scrubbed, '__proto__')).toBe(true);
    expect(scrubbed.t).toBe('[redacted]');
  });

  it('passes undefined, numbers and non-plain objects through', () => {
    const date = new Date(0);
    expect(scrubSecrets(undefined, redactor)).toBeUndefined();
    expect(scrubSecrets(42, redactor)).toBe(42);
    expect(scrubSecrets(date, redactor)).toBe(date);
  });
});
