import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, resultText } from '../support/boot';

// Against a real instance (D-14), read-only, and only in the e2e organization.
// Runs manually or nightly: `bun run test:e2e` with all three variables set.
const url = process.env.E2E_GLITCHTIP_URL;
const token = process.env.E2E_GLITCHTIP_TOKEN;
const org = process.env.E2E_GLITCHTIP_ORG;

describe.skipIf(!url || !token || !org)('e2e smoke', () => {
  let booted: Booted;

  beforeAll(async () => {
    booted = await bootInMemory({
      GLITCHTIP_URL: url,
      GLITCHTIP_TOKEN: token,
      GLITCHTIP_DEFAULT_ORG: org,
      GLITCHTIP_TOOLSETS: 'organizations',
      GLITCHTIP_READ_ONLY: 'true',
      LOG_LEVEL: 'warn',
    });
  });

  afterAll(async () => {
    await booted?.close();
  });

  it('whoami reports the instance and the token scopes', async () => {
    const result = await booted.client.callTool({ name: 'whoami', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(resultText(result)).toContain('token scopes:');
    expect(resultText(result)).not.toContain(token as string);
  });

  it('list_organizations includes the e2e organization', async () => {
    const result = await booted.client.callTool({ name: 'list_organizations', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(resultText(result)).toContain(org as string);
  });
});
