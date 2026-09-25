import { describe, expect, it } from 'vitest';
import { captureStream } from '../../test/support/capture-stream';
import { createLogger, serializeRequest } from './logger';
import { redactSecrets } from './redact';

const TOKEN = 'tok_SECRET_123';

describe('createLogger', () => {
  it('redacts the Authorization header and token fields', () => {
    const sink = captureStream();
    const logger = createLogger({ level: 'info', destination: sink.stream });
    logger.info({ req: { headers: { authorization: `Bearer ${TOKEN}` } } }, 'request');
    logger.info({ instance: { url: 'https://g.test', token: TOKEN } }, 'resolved');
    logger.info({ token: TOKEN }, 'top-level');
    expect(sink.text()).not.toContain(TOKEN);
    expect(sink.text()).toContain('[redacted]');
  });
});

describe('serializeRequest', () => {
  const request = {
    id: 7,
    method: 'POST',
    url: `/mcp?token=${TOKEN}`,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      cookie: `session=${TOKEN}`,
      'x-glitchtip-url': `https://user:${TOKEN}@glitchtip.test/prefix?t=${TOKEN}`,
      'x-glitchtip-org': 'acme',
      'x-custom-secret': TOKEN,
      'content-type': 'application/json',
      'user-agent': 'agent/1',
      'mcp-protocol-version': '2025-06-18',
    },
  };

  it('keeps only allowlisted headers and the path without its query', () => {
    expect(serializeRequest(request)).toEqual({
      id: 7,
      method: 'POST',
      path: '/mcp',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'agent/1',
        'mcp-protocol-version': '2025-06-18',
        'x-glitchtip-url': 'https://glitchtip.test',
      },
    });
    expect(JSON.stringify(serializeRequest(request))).not.toContain(TOKEN);
  });

  it('marks an unparseable instance URL instead of logging it', () => {
    const out = serializeRequest({ headers: { 'x-glitchtip-url': `not a url ${TOKEN}` } });
    expect(out).toMatchObject({ headers: { 'x-glitchtip-url': '[unparseable]' } });
  });
});

describe('redactSecrets', () => {
  it('removes known secrets and any bearer value', () => {
    expect(redactSecrets(`a ${TOKEN} b Bearer other-thing c`, [TOKEN, undefined, ''])).toBe(
      'a [redacted] b Bearer [redacted] c',
    );
    expect(redactSecrets(`Bearer ${TOKEN}`, [TOKEN])).toBe('Bearer [redacted]');
  });
});
