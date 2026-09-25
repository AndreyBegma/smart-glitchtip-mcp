import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/config';
import type { GlitchTipClient } from '../../../src/glitchtip/glitchtip.client';
import { InstanceResolver } from '../../../src/glitchtip/instance.resolver';
import { verifyEventVisible } from '../../../src/toolsets/ingest/ingest.verify';
import { MockGlitchTip } from '../../support/mock-glitchtip';

const GLITCHTIP = 'https://glitchtip.test';
const EVENT_URL = `${GLITCHTIP}/api/0/projects/acme/web/events/e1/`;

function clientFor(mock: MockGlitchTip): GlitchTipClient {
  const config = loadConfig({ GLITCHTIP_URL: GLITCHTIP, GLITCHTIP_TOKEN: 'tok' });
  const resolver = new InstanceResolver(config, mock.fetch);
  return resolver.connect(undefined).client;
}

describe('verifyEventVisible', () => {
  it('reports "Processed" with the issue id once the event is visible', async () => {
    const mock = new MockGlitchTip().on(
      'GET',
      EVENT_URL,
      new Response(null, { status: 404 }),
      new Response(JSON.stringify({ groupID: 'g1' }), { status: 200 }),
    );
    const sleeps: number[] = [];
    const message = await verifyEventVisible(
      clientFor(mock),
      'acme',
      'web',
      'e1',
      4,
      async (ms) => void sleeps.push(ms),
    );
    expect(message).toBe('Processed: the event is visible (issue g1).');
    expect(sleeps).toEqual([2000]);
  });

  it('reports "not visible" once the deadline passes, never as an error', async () => {
    const mock = new MockGlitchTip().json('GET', EVENT_URL, {}, { status: 404 });
    const message = await verifyEventVisible(
      clientFor(mock),
      'acme',
      'web',
      'e1',
      4,
      async () => undefined,
    );
    expect(message).toBe(
      'Accepted but not visible after 4 s. The worker may be behind; this is not a DSN failure.',
    );
  });

  it('reports a 403 on the poll without implying the send failed', async () => {
    const mock = new MockGlitchTip().json('GET', EVENT_URL, {}, { status: 403 });
    const message = await verifyEventVisible(
      clientFor(mock),
      'acme',
      'web',
      'e1',
      4,
      async () => undefined,
    );
    expect(message).toContain('cannot read events');
    expect(message).toContain('succeeded');
  });
});
