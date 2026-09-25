import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// D-27, acceptance 2: `prompts/list` per the Registration table, with
// toolsets pinned in each test. A prompt is listed only when every toolset
// it names is enabled *and* available; `GLITCHTIP_READ_ONLY` does not change
// the list.

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function bootWith(env: NodeJS.ProcessEnv) {
  booted = await bootInMemory({ GLITCHTIP_TOKEN: 'tok', ...env }, new MockGlitchTip());
  return booted;
}

const ORGANIZATION_ARG = {
  name: 'organization',
  description: "Organization slug. Optional: the server's default is used.",
  required: false,
};

describe('prompts/list per the registration table (acceptance 2)', () => {
  it('with the default toolsets, lists exactly triage-issue', async () => {
    const server = await bootWith({});
    const { prompts } = await server.client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['triage-issue']);
  });

  it('with issues,events,releases, lists both prompts', async () => {
    const server = await bootWith({ GLITCHTIP_TOOLSETS: 'issues,events,releases' });
    const { prompts } = await server.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['release-health-report', 'triage-issue']);
  });

  it('with all, lists both prompts', async () => {
    const server = await bootWith({ GLITCHTIP_TOOLSETS: 'all' });
    const { prompts } = await server.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['release-health-report', 'triage-issue']);
  });

  it('with releases,issues, lists only release-health-report', async () => {
    const server = await bootWith({ GLITCHTIP_TOOLSETS: 'releases,issues' });
    const { prompts } = await server.client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['release-health-report']);
  });

  it('with issues alone, offers no prompts capability, and a raw prompts/list is -32601', async () => {
    const server = await bootWith({ GLITCHTIP_TOOLSETS: 'issues' });
    await server.client.getServerVersion(); // ensure initialize has completed
    expect(server.client.getServerCapabilities()?.prompts).toBeUndefined();
    await expect(server.client.request({ method: 'prompts/list' })).rejects.toMatchObject({
      code: -32601,
    });
  });

  it('lists the same prompts in read-only as not read-only', async () => {
    const readOnly = await bootWith({
      GLITCHTIP_TOOLSETS: 'issues,events,releases',
      GLITCHTIP_READ_ONLY: 'true',
    });
    const readOnlyNames = (await readOnly.client.listPrompts()).prompts.map((p) => p.name).sort();
    await readOnly.close();
    booted = undefined;

    const notReadOnly = await bootWith({
      GLITCHTIP_TOOLSETS: 'issues,events,releases',
      GLITCHTIP_READ_ONLY: 'false',
    });
    const notReadOnlyNames = (await notReadOnly.client.listPrompts()).prompts
      .map((p) => p.name)
      .sort();
    expect(readOnlyNames).toEqual(notReadOnlyNames);
  });

  it("gives triage-issue exactly the table's arguments", async () => {
    const server = await bootWith({});
    const { prompts } = await server.client.listPrompts();
    const triage = prompts.find((p) => p.name === 'triage-issue');
    expect(triage?.description).toContain('Triage one GlitchTip issue');
    expect(triage?.arguments).toEqual([
      {
        name: 'issue_id',
        description: 'Numeric issue id (not the shortId like PROJ-123).',
        required: true,
      },
      ORGANIZATION_ARG,
    ]);
  });

  it("gives release-health-report exactly the table's arguments", async () => {
    const server = await bootWith({ GLITCHTIP_TOOLSETS: 'releases,issues' });
    const { prompts } = await server.client.listPrompts();
    const release = prompts.find((p) => p.name === 'release-health-report');
    expect(release?.description).toContain("Report on one release's health");
    expect(release?.arguments).toEqual([
      {
        name: 'version',
        description: 'Release version, exactly as GlitchTip shows it.',
        required: true,
      },
      {
        name: 'project',
        description: 'Project slug. Optional: narrows the release and its issues to one project.',
        required: false,
      },
      ORGANIZATION_ARG,
    ]);
  });
});
