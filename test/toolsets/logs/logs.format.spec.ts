import { describe, expect, it } from 'vitest';
import {
  flattenAttributes,
  isSensitiveAttributeKey,
  redactAttributesForJson,
} from '../../../src/toolsets/logs/logs.format';

// Acceptance 10, spec §PII in logs: attribute keys are redacted by their dotted path, in
// both the flattened text rendering and the json shape — the same predicate drives both.

describe('isSensitiveAttributeKey', () => {
  it.each([
    ['ip_address', true],
    ['client.address', true],
    ['remote_addr', true],
    ['x-forwarded-for', true],
    ['x-real-ip', true],
    ['set-cookie', true],
    ['proxy-authorization', true],
    ['user.geo', true],
    ['user.geo.city', true],
    ['http.request.header.cookie', true],
    ['Authorization', true],
    ['authorization', true],
    ['user_ip', true],
    ['body', false],
    ['service', false],
    ['http.method', false],
    ['duration_ms', false],
    // Review: suffix match, not only a whole-path or single-segment equality.
    ['http.request.header.x-forwarded-for', true],
    ['req.remote_addr', true],
    ['source.client.address', true],
    // Review: camelCase split, and the OTel *.address / *.peer.address family.
    ['clientIP', true],
    ['remoteAddr', true],
    ['network.peer.address', true],
    // Review should-fix 3: acronym-run split, and ip\d* / ipv\d as sensitive on their own.
    ['userIPAddress', true],
    ['ipv4', true],
    ['ipv6', true],
    ['clientIp6', true],
    ['ip4', true],
    // A plain acronym-adjacent word that isn't otherwise sensitive stays that way.
    ['HTTPMethod', false],
  ])('%s -> %s', (key, expected) => {
    expect(isSensitiveAttributeKey(key)).toBe(expected);
  });
});

describe('flattenAttributes', () => {
  it('redacts each sensitive leaf on its own dotted path (acceptance 10)', () => {
    const { attributes } = flattenAttributes({
      'client.address': '203.0.113.9',
      'http.request.header.cookie': 'session=abc',
      Authorization: 'Bearer xyz',
      user: { ip_address: '203.0.113.10', geo: { city: 'Berlin' } },
    });
    const byKey = new Map(attributes.map((a) => [a.key, a.value]));
    expect(byKey.get('client.address')).toBe('[redacted]');
    expect(byKey.get('http.request.header.cookie')).toBe('[redacted]');
    expect(byKey.get('Authorization')).toBe('[redacted]');
    expect(byKey.get('user.ip_address')).toBe('[redacted]');
    expect(byKey.get('user.geo.city')).toBe('[redacted]');
  });

  it('keeps a non-sensitive value, cut to 200 characters', () => {
    const { attributes } = flattenAttributes({ note: 'x'.repeat(300) });
    expect(attributes[0]?.value.length).toBeLessThanOrEqual(200);
    expect(attributes[0]?.value.endsWith('…')).toBe(true);
  });

  it('dots nested objects up to depth 4 and stops there', () => {
    const { attributes } = flattenAttributes({ a: { b: { c: { d: { e: 'deep' } } } } });
    const keys = attributes.map((a) => a.key);
    expect(keys).toContain('a.b.c.d');
    expect(keys.some((k) => k.startsWith('a.b.c.d.'))).toBe(false);
  });

  it('caps at 50 attributes and counts the rest', () => {
    const data = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]));
    const { attributes, more } = flattenAttributes(data);
    expect(attributes).toHaveLength(50);
    expect(more).toBe(10);
  });

  it('returns nothing for a non-object', () => {
    expect(flattenAttributes(null)).toEqual({ attributes: [], more: 0 });
    expect(flattenAttributes('oops')).toEqual({ attributes: [], more: 0 });
  });

  it('redacts through an array of objects, at any depth (review: recurse through arrays too)', () => {
    const { attributes } = flattenAttributes({
      requests: [{ client: { address: '203.0.113.9' } }, { client: { address: '203.0.113.10' } }],
    });
    const byKey = new Map(attributes.map((a) => [a.key, a.value]));
    expect(byKey.get('requests.0.client.address')).toBe('[redacted]');
    expect(byKey.get('requests.1.client.address')).toBe('[redacted]');
  });

  it('redacts element [1] of a [name, value] header pair whose name is sensitive (review should-fix 3)', () => {
    const { attributes } = flattenAttributes({
      headers: [
        ['Cookie', 'session=secret'],
        ['X-Forwarded-For', '203.0.113.9'],
        ['User-Agent', 'test'],
      ],
    });
    const byKey = new Map(attributes.map((a) => [a.key, a.value]));
    expect(byKey.get('headers.0.1')).toBe('[redacted]');
    expect(byKey.get('headers.1.1')).toBe('[redacted]');
    expect(byKey.get('headers.2.1')).toBe('test');
    expect(byKey.get('headers.0.0')).toBe('Cookie');
  });
});

describe('redactAttributesForJson', () => {
  it('redacts each sensitive leaf, keeping the object structure', () => {
    const redacted = redactAttributesForJson({
      'client.address': '203.0.113.9',
      user: { id: '7', ip_address: '203.0.113.10', geo: { city: 'Berlin' } },
    }) as Record<string, unknown>;
    expect(redacted['client.address']).toBe('[redacted]');
    const user = redacted.user as Record<string, unknown>;
    expect(user.id).toBe('7');
    expect(user.ip_address).toBe('[redacted]');
    expect((user.geo as Record<string, unknown>).city).toBe('[redacted]');
  });

  it('passes a non-object through unchanged (except null/undefined -> null)', () => {
    expect(redactAttributesForJson(null)).toBeNull();
    expect(redactAttributesForJson(undefined)).toBeNull();
  });
});
