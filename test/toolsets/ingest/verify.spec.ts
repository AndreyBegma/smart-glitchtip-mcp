import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/config';
import { GlitchTipClient } from '../../../src/glitchtip/glitchtip.client';
import { ResolvedInstance } from '../../../src/glitchtip/instance.context';
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

  it('reports a 401 on the poll as the server’s own token, not the DSN key (should-fix 8)', async () => {
    const mock = new MockGlitchTip().json('GET', EVENT_URL, {}, { status: 401 });
    const message = await verifyEventVisible(
      clientFor(mock),
      'acme',
      'web',
      'e1',
      4,
      async () => undefined,
    );
    expect(message).toContain("server's own token");
    expect(message).toContain('succeeded');
  });

  it('bounds each attempt’s timeoutMs to the remaining wait_seconds budget (should-fix 8)', async () => {
    const mock = new MockGlitchTip().json('GET', EVENT_URL, {}, { status: 404 });
    const client = clientFor(mock);
    const rawSpy = vi.spyOn(client, 'raw');
    await verifyEventVisible(client, 'acme', 'web', 'e1', 1, async () => undefined);
    expect(rawSpy).toHaveBeenCalledTimes(1);
    const options = rawSpy.mock.calls[0][3];
    expect(options?.timeoutMs).toBeGreaterThanOrEqual(100);
    expect(options?.timeoutMs).toBeLessThanOrEqual(1000);
  });

  it('a per-attempt failure (timeout/transport) stops polling instead of throwing (should-fix 8)', async () => {
    const mock = new MockGlitchTip().on('GET', EVENT_URL, () => {
      throw new TypeError('fetch failed');
    });
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

  // BUG-20260925-018 acceptance 7: `timeoutMs` alone does not bound a hidden client-level
  // retry; `noRetry` does.
  it('passes noRetry: true on every poll attempt', async () => {
    const mock = new MockGlitchTip().json('GET', EVENT_URL, {}, { status: 404 });
    const client = clientFor(mock);
    const rawSpy = vi.spyOn(client, 'raw');
    await verifyEventVisible(client, 'acme', 'web', 'e1', 1, async () => undefined);
    expect(rawSpy).toHaveBeenCalledTimes(1);
    expect(rawSpy.mock.calls[0][3]?.noRetry).toBe(true);
  });

  it('a mocked 429 + Retry-After: 10 finishes within wait_seconds + 1 s (real clock)', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      EVENT_URL,
      {},
      { status: 429, headers: { 'retry-after': '10' } },
    );
    // No sleep injected into the client: without `noRetry`, the client's own 429 retry
    // would really sleep close to 10 s before ever returning to the poll loop.
    const client = new GlitchTipClient(new ResolvedInstance('https://glitchtip.test', 'tok'), {
      timeoutMs: 5_000,
      fetch: mock.fetch,
    });
    const waitSeconds = 2;
    const start = Date.now();
    const message = await verifyEventVisible(
      client,
      'acme',
      'web',
      'e1',
      waitSeconds,
      async () => undefined,
    );
    const elapsedMs = Date.now() - start;
    expect(message).toBe(
      `Accepted but not visible after ${waitSeconds} s. The worker may be behind; this is not a DSN failure.`,
    );
    expect(elapsedMs).toBeLessThan((waitSeconds + 1) * 1000);
  });
});
