import { describe, expect, it } from 'vitest';
import { captureStream } from '../../test/support/capture-stream';
import { createLogger } from './logger';

describe('createLogger', () => {
  it('redacts the Authorization header and token fields', () => {
    const sink = captureStream();
    const logger = createLogger({ level: 'info', destination: sink.stream });
    logger.info({ req: { headers: { authorization: 'Bearer tok_SECRET_123' } } }, 'request');
    logger.info({ instance: { url: 'https://g.test', token: 'tok_SECRET_123' } }, 'resolved');
    logger.info({ token: 'tok_SECRET_123' }, 'top-level');
    expect(sink.text()).not.toContain('tok_SECRET_123');
    expect(sink.text()).toContain('[redacted]');
  });
});
