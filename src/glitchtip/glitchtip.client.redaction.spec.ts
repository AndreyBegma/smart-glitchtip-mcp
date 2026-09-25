import { describe, expect, it } from 'vitest';
import { MockGlitchTip } from '../../test/support/mock-glitchtip';
import { type CallOptions, GlitchTipClient } from './glitchtip.client';
import { GlitchTipError } from './glitchtip.errors';
import { ResolvedInstance } from './instance.context';

// BUG-20260925-017: GlitchTip's error detail is cut at 500 characters. A secret
// that straddles the cut must leave no start of itself behind (gate
// token-safety), and so must any `extraSecrets` a toolset passes.

const BASE = 'https://glitchtip.test';
const TOKEN = 'tok_T3stS3cr3tValue_9f8e7d';
const WEBHOOK = 'https://hooks.example.test/services/T000/B000/XXsecretXX';
const ORGS = `${BASE}/api/0/organizations/`;
const DETAIL_LIMIT = 500;
const SHORTEST_LEAK = 4;

function setup() {
  const mock = new MockGlitchTip();
  const client = new GlitchTipClient(new ResolvedInstance(BASE, TOKEN), {
    timeoutMs: 1_000,
    fetch: mock.fetch,
  });
  return { mock, client };
}

async function rejectedPost(
  status: number,
  detail: unknown,
  options?: CallOptions,
): Promise<GlitchTipError> {
  const { mock, client } = setup();
  mock.json('POST', ORGS, { detail }, { status });
  try {
    await client.call(
      { name: 'create organization', scopes: [] },
      (api) => api.POST('/api/0/organizations/', { body: { name: 'n' } }),
      options,
    );
  } catch (error) {
    if (error instanceof GlitchTipError) return error;
    throw error;
  }
  throw new Error('expected a GlitchTipError');
}

/** The longest start of `secret` (at least 4 characters) found anywhere in `text`. */
function leakedStart(text: string | undefined, secret: string): string | undefined {
  for (let length = secret.length; length >= SHORTEST_LEAK; length--) {
    const start = secret.slice(0, length);
    if (text?.includes(start)) return start;
  }
  return undefined;
}

/** A detail longer than the cut, with `secret` starting at `offset`. */
function detailWith(secret: string, offset: number): string {
  return `${'x'.repeat(offset)}${secret}${'y'.repeat(DETAIL_LIMIT)}`;
}

/** Every offset at which `secret` straddles the cut, plus a few before it. */
function straddlingOffsets(secret: string): number[] {
  const first = Math.min(490, DETAIL_LIMIT - secret.length);
  return Array.from({ length: DETAIL_LIMIT - first }, (_, i) => first + i);
}

describe('GlitchTipClient error detail redaction (BUG-20260925-017)', () => {
  for (const status of [400, 422]) {
    it(`leaves no 4+ character start of the token at any offset across the cut (${status})`, async () => {
      for (const offset of straddlingOffsets(TOKEN)) {
        const error = await rejectedPost(status, detailWith(TOKEN, offset));
        expect(leakedStart(error.detail, TOKEN), `detail, offset ${offset}`).toBeUndefined();
        expect(leakedStart(error.message, TOKEN), `message, offset ${offset}`).toBeUndefined();
        // At most the cut, a `[redacted]` in place of a start of 4+ characters, and the `…`.
        expect(error.detail?.length).toBeLessThanOrEqual(DETAIL_LIMIT + 6 + 1);
      }
    });

    it(`leaves no 4+ character start of an extra secret at any offset across the cut (${status})`, async () => {
      for (const offset of straddlingOffsets(WEBHOOK)) {
        const error = await rejectedPost(status, detailWith(WEBHOOK, offset), {
          extraSecrets: [WEBHOOK],
        });
        expect(leakedStart(error.detail, WEBHOOK), `detail, offset ${offset}`).toBeUndefined();
        expect(leakedStart(error.message, WEBHOOK), `message, offset ${offset}`).toBeUndefined();
      }
    });
  }

  it('removes an extra secret echoed whole in a short detail', async () => {
    const error = await rejectedPost(400, `could not reach ${WEBHOOK}`, {
      extraSecrets: [WEBHOOK],
    });
    expect(error.message).toBe('GlitchTip rejected the request: could not reach [redacted]');
    expect(error.detail).toBe('could not reach [redacted]');
  });

  it('removes the token from a validation-error list before cutting it', async () => {
    // `[{"loc":["body","name"],"msg":"` is 31 characters: the token starts at 487.
    const detail = [{ loc: ['body', 'name'], msg: `${'z'.repeat(455)} ${TOKEN}`, type: 'x' }];
    const error = await rejectedPost(422, detail);
    expect(leakedStart(error.detail, TOKEN)).toBeUndefined();
    expect(leakedStart(error.message, TOKEN)).toBeUndefined();
  });

  it('removes a start of the token that GlitchTip already cut off itself', async () => {
    const error = await rejectedPost(400, `bad value ${TOKEN.slice(0, 9)}`);
    expect(error.detail).toBe('bad value [redacted]');
  });

  it('leaves a detail with no secret in it as it was', async () => {
    const error = await rejectedPost(400, 'name: this field is required', {
      extraSecrets: [WEBHOOK],
    });
    expect(error.detail).toBe('name: this field is required');
  });

  it('removes extra secrets from a raw response body and headers', async () => {
    const { mock, client } = setup();
    mock.on(
      'GET',
      `${BASE}/api/0/echo/`,
      new Response(`hook=${WEBHOOK} token=${TOKEN}`, {
        status: 200,
        headers: { 'x-hook': WEBHOOK },
      }),
    );
    const response = await client.raw({ name: 'echo', scopes: [] }, 'GET', '/api/0/echo/', {
      extraSecrets: [WEBHOOK],
    });
    expect(response.text).toBe('hook=[redacted] token=[redacted]');
    expect(response.headers.get('x-hook')).toBe('[redacted]');
  });
});
