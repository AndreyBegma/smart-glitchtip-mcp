import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import type { components } from '../../glitchtip/generated/schema';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { callForRelease, callForReleaseFile } from './release-errors';
import {
  commitsChangedView,
  deployCreatedView,
  releaseChangedView,
  resultView,
} from './releases.format';
import {
  fileIdParam,
  httpUrlParam,
  isoDateTimeParam,
  projectParam,
  RELEASE_UNTRUSTED_NOTE,
  versionParam,
} from './releases.params';
import { DEPLOY_COMMIT_SCOPES, RELEASE_SCOPES } from './releases.scopes';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.

type CommitIn = components['schemas']['CommitIn'];

/** GlitchTip stores up to this many commits per release (`create_commits`, spec §Tools). */
const MAX_STORED_COMMITS = 1000;

function noDuplicates(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * Whether two ISO date-times name the same instant, treating `null`/`undefined` as "unreleased"
 * (equal to each other, unequal to any parseable date). `2026-01-01T00:00:00Z` and
 * `2026-01-01T00:00:00+00:00` compare equal (orchestrator review of #20 should-fix).
 */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  return Date.parse(a) === Date.parse(b);
}

const createReleaseArgs = z.object({
  organization: organizationParam,
  version: versionParam,
  projects: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .refine(noDuplicates, { message: 'projects must not contain duplicates.' })
    .describe('Project slugs to link this release to (1–50, no duplicates).'),
  ref: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe('VCS ref (e.g. a commit SHA or branch). Omit to leave unset.'),
  date_released: isoDateTimeParam
    .nullable()
    .optional()
    .describe(
      'When the release went out. Omitted: GlitchTip stamps it released now. null: leaves it unreleased.',
    ),
  format: formatParam,
});

const updateReleaseArgs = z
  .object({
    organization: organizationParam,
    version: versionParam,
    ref: z.string().min(1).nullable().optional().describe('New VCS ref, or null to clear it.'),
    date_released: isoDateTimeParam
      .nullable()
      .optional()
      .describe('New release date, or null to mark it unreleased.'),
    format: formatParam,
  })
  .refine((v) => v.ref !== undefined || v.date_released !== undefined, {
    message: 'At least one of ref or date_released is required.',
  });

const deleteReleaseArgs = z.object({
  organization: organizationParam,
  version: versionParam,
  project: projectParam,
  confirm: z.string().describe('Must equal `version` exactly.'),
  format: formatParam,
});

const createDeployArgs = z
  .object({
    organization: organizationParam,
    version: versionParam,
    environment: z.string().min(1).max(64).describe('Environment name (e.g. production, staging).'),
    url: httpUrlParam(200).optional().describe('Link to the deploy, e.g. a CI run.'),
    date_started: isoDateTimeParam.optional(),
    date_finished: isoDateTimeParam.optional(),
    format: formatParam,
  })
  .refine(
    (v) =>
      v.date_started === undefined ||
      v.date_finished === undefined ||
      Date.parse(v.date_finished) >= Date.parse(v.date_started),
    { message: 'date_finished must not be before date_started.' },
  );

const commitInputSchema = z.object({
  id: z.string().min(1).describe('Commit SHA or identifier.'),
  message: z.string().optional(),
  author_name: z.string().optional(),
  author_email: z.string().optional(),
});

const addReleaseCommitsArgs = z.object({
  organization: organizationParam,
  version: versionParam,
  commits: z
    .array(commitInputSchema)
    .min(1)
    .max(MAX_STORED_COMMITS)
    .refine((list) => noDuplicates(list.map((c) => c.id)), {
      message: 'commits must not contain duplicate ids.',
    })
    .describe(
      'Commits to attach; a commit already attached is kept unless its id is repeated here.',
    ),
  format: formatParam,
});

const deleteReleaseFileArgs = z.object({
  organization: organizationParam,
  version: versionParam,
  file_id: fileIdParam,
  project: projectParam,
  confirm: z.string().describe('Must equal `file_id` as a string.'),
  format: formatParam,
});

@GlitchTipTools()
export class ReleasesMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'create_release',
    description:
      'Create a release linked to one or more projects. If the version already exists in the ' +
      'organization, GlitchTip only links the extra projects and keeps its ref and release date; ' +
      'when `ref` or `date_released` was given, the output says whether it was actually applied. ' +
      `Scope: project:releases. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: createReleaseArgs,
    annotations: {
      title: 'Create release',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async createRelease(
    @Payload() args: z.infer<typeof createReleaseArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const body: {
      version: string;
      projects: string[];
      ref?: string | null;
      dateReleased?: string | null;
    } = { version: args.version, projects: args.projects };
    if (args.ref !== undefined) body.ref = args.ref;
    if (args.date_released !== undefined) body.dateReleased = args.date_released;
    const created = await glitchtip.client.call(
      { name: 'create release', scopes: RELEASE_SCOPES, org },
      (api) =>
        api.POST('/api/0/organizations/{organization_slug}/releases/', {
          params: { path: { organization_slug: org } },
          body,
        }),
    );
    const linked = (created.projects ?? []).map((p) => p?.slug ?? p?.name ?? '?');
    const summary = `Created release in ${org}, linked to ${linked.length} project(s): ${linked.join(', ')}.`;
    const changedRef = args.ref !== undefined && (created.ref ?? null) !== args.ref;
    const changedDate =
      args.date_released !== undefined && !sameInstant(created.dateReleased, args.date_released);
    const note =
      changedRef || changedDate
        ? 'The release already existed; its ref and release date were not changed — use update_release.'
        : undefined;
    return this.output.render(args.format, releaseChangedView(summary, created, note));
  }

  @Tool({
    name: 'update_release',
    description:
      "Change a release's ref and/or release date. Reads the release first and sends the " +
      'complete pair back, so leaving one out never clears it. ' +
      `Scope: project:releases. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: updateReleaseArgs,
    annotations: { title: 'Update release', ...mutation({ destructive: false, idempotent: true }) },
  })
  async updateRelease(
    @Payload() args: z.infer<typeof updateReleaseArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const current = await callForRelease(
      glitchtip.client.call({ name: 'get release', scopes: RELEASE_SCOPES, org }, (api) =>
        api.GET('/api/0/organizations/{organization_slug}/releases/{version}/', {
          params: { path: { organization_slug: org, version: args.version } },
        }),
      ),
      org,
      args.version,
    );
    // GlitchTip's PUT is full-replace: an omitted field is re-stamped to now (dateReleased) or
    // cleared (ref). If the GET response did not carry a value to preserve and the caller did not
    // supply one either, sending anyway would silently apply one of those side effects instead of
    // the no-op the caller asked for — refuse instead (blocker fix, orchestrator review of #20).
    if (args.ref === undefined && typeof current.ref === 'undefined') {
      return error(
        "Not updated: GlitchTip's response did not include ref, so the current value cannot be " +
          'preserved; pass `ref` explicitly.',
      );
    }
    if (args.date_released === undefined && typeof current.dateReleased === 'undefined') {
      return error(
        "Not updated: GlitchTip's response did not include date_released, so the current value " +
          'cannot be preserved; pass `date_released` explicitly.',
      );
    }
    const ref = args.ref !== undefined ? args.ref : (current.ref ?? null);
    const dateReleased =
      args.date_released !== undefined ? args.date_released : current.dateReleased;
    const updated = await callForRelease(
      glitchtip.client.call({ name: 'update release', scopes: RELEASE_SCOPES, org }, (api) =>
        api.PUT('/api/0/organizations/{organization_slug}/releases/{version}/', {
          params: { path: { organization_slug: org, version: args.version } },
          body: { ref, dateReleased },
        }),
      ),
      org,
      args.version,
    );
    return this.output.render(
      args.format,
      releaseChangedView(`Updated release in ${org}.`, updated),
    );
  }

  @Tool({
    name: 'delete_release',
    description:
      'Permanently delete a release for every project it belongs to, with its deploys. Attached ' +
      'files stay but are unlinked. Cannot be undone. `confirm` must equal `version`. ' +
      `Scope: project:releases. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: deleteReleaseArgs,
    annotations: { title: 'Delete release', ...mutation({ destructive: true, idempotent: false }) },
  })
  async deleteRelease(
    @Payload() args: z.infer<typeof deleteReleaseArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== args.version) {
      return error(
        `Not deleted: confirm must equal the release version "${args.version}" exactly.`,
      );
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await callForRelease(
      args.project
        ? glitchtip.client.call(
            { name: 'delete project release', scopes: RELEASE_SCOPES, org },
            (api) =>
              api.DELETE('/api/0/projects/{organization_slug}/{project_slug}/releases/{version}/', {
                params: {
                  path: {
                    organization_slug: org,
                    project_slug: args.project as string,
                    version: args.version,
                  },
                },
              }),
          )
        : glitchtip.client.call({ name: 'delete release', scopes: RELEASE_SCOPES, org }, (api) =>
            api.DELETE('/api/0/organizations/{organization_slug}/releases/{version}/', {
              params: { path: { organization_slug: org, version: args.version } },
            }),
          ),
      org,
      args.version,
      args.project,
    );
    return this.output.render(
      args.format,
      resultView(`Deleted release ${args.version} from ${org}.`),
    );
  }

  @Tool({
    name: 'create_deploy',
    description:
      'Record that a release was deployed to an environment. ' +
      `Scope: project:releases, project:write or project:admin. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: createDeployArgs,
    annotations: { title: 'Create deploy', ...mutation({ destructive: false, idempotent: false }) },
  })
  async createDeploy(
    @Payload() args: z.infer<typeof createDeployArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const deploy = await callForRelease(
      glitchtip.client.call({ name: 'create deploy', scopes: DEPLOY_COMMIT_SCOPES, org }, (api) =>
        api.POST('/api/0/organizations/{organization_slug}/releases/{version}/deploys/', {
          params: { path: { organization_slug: org, version: args.version } },
          body: {
            environment: args.environment,
            url: args.url ?? '',
            dateStarted: args.date_started,
            dateFinished: args.date_finished,
          },
        }),
      ),
      org,
      args.version,
    );
    return this.output.render(args.format, deployCreatedView(args.version, deploy));
  }

  @Tool({
    name: 'add_release_commits',
    description:
      'Attach commits to a release; commits already attached are kept unless their id is given ' +
      'again, in which case they are updated in place. Scope: project:releases, project:write or ' +
      `project:admin. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: addReleaseCommitsArgs,
    annotations: {
      title: 'Add release commits',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async addReleaseCommits(
    @Payload() args: z.infer<typeof addReleaseCommitsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const existing = await callForRelease(
      glitchtip.client.call({ name: 'list commits', scopes: DEPLOY_COMMIT_SCOPES, org }, (api) =>
        api.GET('/api/0/organizations/{organization_slug}/releases/{version}/commits/', {
          params: { path: { organization_slug: org, version: args.version } },
        }),
      ),
      org,
      args.version,
    );

    // Deduped by id first (last wins, stable position): a stored list that already carries a
    // duplicate id must not end up with a stale copy the id-lookup below can never reach
    // (orchestrator review of #20 nit).
    const deduped = new Map<string, (typeof existing)[number]>();
    for (const c of existing) deduped.set(c.id, c);
    const merged: CommitIn[] = [...deduped.values()].map((c) => ({
      id: c.id,
      message: c.message ?? '',
      authorName: c.authorName ?? '',
      authorEmail: c.authorEmail ?? '',
    }));
    const indexById = new Map(merged.map((c, i) => [c.id, i]));
    let added = 0;
    let updated = 0;
    for (const input of args.commits) {
      const entry: CommitIn = {
        id: input.id,
        message: input.message ?? '',
        authorName: input.author_name ?? '',
        authorEmail: input.author_email ?? '',
      };
      const index = indexById.get(input.id);
      if (index === undefined) {
        indexById.set(input.id, merged.length);
        merged.push(entry);
        added++;
      } else {
        merged[index] = entry;
        updated++;
      }
    }
    if (merged.length > MAX_STORED_COMMITS) {
      return error(
        `Not attached: the release would end up with ${merged.length} commits, over GlitchTip's ` +
          `limit of ${MAX_STORED_COMMITS}.`,
      );
    }

    const releaseAfter = await callForRelease(
      glitchtip.client.call(
        { name: 'add release commits', scopes: DEPLOY_COMMIT_SCOPES, org },
        (api) =>
          api.POST('/api/0/organizations/{organization_slug}/releases/{version}/commits/', {
            params: { path: { organization_slug: org, version: args.version } },
            body: merged,
          }),
      ),
      org,
      args.version,
    );
    const summary = `Added ${added}, updated ${updated} commits on release ${args.version} in ${org}.`;
    return this.output.render(args.format, commitsChangedView(summary, releaseAfter));
  }

  @Tool({
    name: 'delete_release_file',
    description:
      'Permanently delete a source-map or artifact bundle attached to a release. Cannot be undone. ' +
      `\`confirm\` must equal \`file_id\`. Scope: project:releases. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: deleteReleaseFileArgs,
    annotations: {
      title: 'Delete release file',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async deleteReleaseFile(
    @Payload() args: z.infer<typeof deleteReleaseFileArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== String(args.file_id)) {
      return error(`Not deleted: confirm must equal the file id "${args.file_id}" exactly.`);
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await callForReleaseFile(
      args.project
        ? glitchtip.client.call(
            { name: 'delete project release file', scopes: RELEASE_SCOPES, org },
            (api) =>
              api.DELETE(
                '/api/0/projects/{organization_slug}/{project_slug}/releases/{version}/files/{file_id}/',
                {
                  params: {
                    path: {
                      organization_slug: org,
                      project_slug: args.project as string,
                      version: args.version,
                      file_id: args.file_id,
                    },
                  },
                },
              ),
          )
        : glitchtip.client.call(
            { name: 'delete release file', scopes: RELEASE_SCOPES, org },
            (api) =>
              api.DELETE(
                '/api/0/organizations/{organization_slug}/releases/{version}/files/{file_id}/',
                {
                  params: {
                    path: { organization_slug: org, version: args.version, file_id: args.file_id },
                  },
                },
              ),
          ),
      args.version,
      args.file_id,
    );
    return this.output.render(
      args.format,
      resultView(`Deleted file ${args.file_id} from release ${args.version}.`),
    );
  }
}
