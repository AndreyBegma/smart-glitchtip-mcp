import { afterEach, describe, expect, it } from 'vitest';
import { TOOLSET_NAMES } from '../../src/toolsets/toolset';
import {
  type Booted,
  type BootedHttp,
  bootHttp,
  bootInMemory,
  GLITCHTIP,
  withPending,
} from './boot';
import { MockGlitchTip } from './mock-glitchtip';

// The harness itself: every "absent from logs" assertion in the suite is only
// as good as the sink it reads. Two boots in one file must each see their own
// lines, and nothing of the other's.

const API = `${GLITCHTIP}/api/0`;

function mock(): MockGlitchTip {
  return new MockGlitchTip().json('GET', `${API}/organizations/`, [
    { slug: 'acme', name: 'Acme', dateCreated: '2026-01-01' },
  ]);
}

describe('log capture per boot', () => {
  const open: (Booted | BootedHttp)[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((b) => b.close()));
  });

  it('each HTTP boot receives its own request lines', async () => {
    const first = await bootHttp({ GLITCHTIP_URL: GLITCHTIP }, mock());
    open.push(first);
    await (await first.connect({ authorization: 'Bearer tok_FIRST_BOOT_x' })).listTools();
    await first.close();
    open.pop();

    const second = await bootHttp({ GLITCHTIP_URL: GLITCHTIP }, mock());
    open.push(second);
    await (
      await second.connect({ 'user-agent': 'second-boot-agent', authorization: 'Bearer x' })
    ).listTools();

    expect(first.logs()).toContain('request completed');
    expect(second.logs()).toContain('request completed');
    expect(second.logs()).toContain('second-boot-agent');
    expect(first.logs()).not.toContain('second-boot-agent');
  });

  // Each boot marks its own toolset pending in an injected registry, so the
  // distinguishing warning exists whichever toolsets have shipped.
  it('each in-memory boot receives its own lines', async () => {
    const [one, two] = [TOOLSET_NAMES[0], TOOLSET_NAMES[1]];
    const first = await bootInMemory({ GLITCHTIP_TOOLSETS: one }, mock(), {
      toolsets: withPending(one),
    });
    open.push(first);
    const second = await bootInMemory({ GLITCHTIP_TOOLSETS: two }, mock(), {
      toolsets: withPending(two),
    });
    open.push(second);
    expect(first.logs()).toContain(`"toolset":"${one}"`);
    expect(second.logs()).toContain(`"toolset":"${two}"`);
    expect(second.logs()).toContain('Nest microservice successfully started');
    expect(first.logs()).not.toContain(`"toolset":"${two}"`);
  });
});
