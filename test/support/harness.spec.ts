import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, type BootedHttp, bootHttp, bootInMemory, GLITCHTIP } from './boot';
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

  it('each in-memory boot receives its own lines', async () => {
    const first = await bootInMemory({ GLITCHTIP_TOOLSETS: 'alerts' }, mock());
    open.push(first);
    const second = await bootInMemory({ GLITCHTIP_TOOLSETS: 'monitors' }, mock());
    open.push(second);
    expect(first.logs()).toContain('"toolset":"alerts"');
    expect(second.logs()).toContain('"toolset":"monitors"');
    expect(second.logs()).toContain('Nest microservice successfully started');
    expect(first.logs()).not.toContain('"toolset":"monitors"');
  });
});
