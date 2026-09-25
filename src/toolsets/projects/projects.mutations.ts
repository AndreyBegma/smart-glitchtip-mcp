import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import { GlitchTipError } from '../../glitchtip/glitchtip.errors';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { changedProjectView, createdProjectView } from './projects.format';
import { projectParam, teamParam } from './projects.params';
import { PROJECT_READ_SCOPES } from './projects.tools';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.
// Project lifecycle only; client keys are project-keys.mutations.ts, environment/team
// attachment is project-access.mutations.ts (each file stays under the 500-line ceiling).

export const PROJECT_WRITE_SCOPES = ['project:write', 'project:admin'] as const;
export const PROJECT_ADMIN_SCOPES = ['project:admin'] as const;

const nameParam = z.string().trim().min(1).max(200);
const platformParam = z.string().trim().min(1).max(64);
const slugParam = z.string().regex(/^[A-Za-z0-9_-]+$/, 'must be a slug');
const throttleParam = z.number().int().min(0).max(100);

const createProjectArgs = z.object({
  organization: organizationParam,
  team: teamParam,
  name: nameParam.describe('Project name.'),
  platform: platformParam.optional().describe('Platform, e.g. python, javascript-react.'),
  slug: slugParam
    .optional()
    .describe('Project slug; GlitchTip derives one from the name if omitted.'),
  event_throttle_rate: throttleParam
    .optional()
    .describe('Percentage of events to throttle, 0-100.'),
  format: formatParam,
});

const updateProjectArgs = z
  .object({
    organization: organizationParam,
    project: projectParam,
    name: nameParam.optional().describe('New project name.'),
    platform: platformParam.optional().describe('New platform.'),
    new_slug: slugParam.optional().describe('New project slug.'),
    event_throttle_rate: throttleParam.optional().describe('New event throttle rate, 0-100.'),
    format: formatParam,
  })
  .refine(
    (a) =>
      a.name !== undefined ||
      a.platform !== undefined ||
      a.new_slug !== undefined ||
      a.event_throttle_rate !== undefined,
    { message: 'At least one of name, platform, new_slug or event_throttle_rate is required.' },
  );

const deleteProjectArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  confirm: z
    .string()
    .describe('Must equal `project` exactly; guards against deleting the wrong one.'),
  format: formatParam,
});

@GlitchTipTools()
export class ProjectsMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'create_project',
    description:
      'Create a project owned by a team, and fetch its default DSN. Scope: project:write or ' +
      'project:admin.',
    parameters: createProjectArgs,
    annotations: {
      title: 'Create project',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async createProject(
    @Payload() args: z.infer<typeof createProjectArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const created = await glitchtip.client.call(
      {
        name: 'create project',
        scopes: PROJECT_WRITE_SCOPES,
        resource: 'Team',
        id: args.team,
        org,
      },
      (api) =>
        api.POST('/api/0/teams/{organization_slug}/{team_slug}/projects/', {
          params: { path: { organization_slug: org, team_slug: args.team } },
          body: {
            name: args.name,
            slug: args.slug,
            platform: args.platform,
            eventThrottleRate: args.event_throttle_rate,
          },
        }),
    );
    const slug = created.slug ?? args.slug ?? created.name;
    let dsnPublic: string | undefined;
    let dsnFailure: string | undefined;
    try {
      const keys = await glitchtip.client.page(
        {
          name: 'list project keys',
          scopes: PROJECT_READ_SCOPES,
          resource: 'Project',
          id: slug,
          org,
        },
        (api) =>
          api.GET('/api/0/projects/{organization_slug}/{project_slug}/keys/', {
            params: { path: { organization_slug: org, project_slug: slug } },
          }),
      );
      dsnPublic = keys.items[0]?.dsn?.public;
    } catch (err) {
      if (!(err instanceof GlitchTipError)) throw err;
      dsnFailure = `DSN fetch failed: ${err.message}; call list_project_keys(project)`;
    }
    return this.output.render(args.format, createdProjectView(created, dsnPublic, dsnFailure));
  }

  @Tool({
    name: 'update_project',
    description:
      "Change a project's name, platform, slug or event throttle rate. Unspecified fields " +
      'keep their current value. Scope: project:write or project:admin.',
    parameters: updateProjectArgs,
    annotations: {
      title: 'Update project',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async updateProject(
    @Payload() args: z.infer<typeof updateProjectArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const current = await glitchtip.client.call(
      {
        name: 'get project',
        scopes: PROJECT_READ_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.GET('/api/0/projects/{organization_slug}/{project_slug}/', {
          params: { path: { organization_slug: org, project_slug: args.project } },
        }),
    );
    const updated = await glitchtip.client.call(
      {
        name: 'update project',
        scopes: PROJECT_WRITE_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.PUT('/api/0/projects/{organization_slug}/{project_slug}/', {
          params: { path: { organization_slug: org, project_slug: args.project } },
          body: {
            name: args.name ?? current.name,
            slug: args.new_slug ?? current.slug,
            platform: args.platform ?? current.platform,
            eventThrottleRate: args.event_throttle_rate ?? current.eventThrottleRate,
          },
        }),
    );
    return this.output.render(
      args.format,
      changedProjectView(`Updated project ${updated.slug}.`, updated),
    );
  }

  @Tool({
    name: 'delete_project',
    description:
      'Permanently delete a project with all its issues, events and keys. `confirm` must ' +
      'repeat `project`. Scope: project:admin.',
    parameters: deleteProjectArgs,
    annotations: {
      title: 'Delete project',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async deleteProject(
    @Payload() args: z.infer<typeof deleteProjectArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== args.project) {
      return error(`Not deleted: confirm must equal the project slug "${args.project}" exactly.`);
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await glitchtip.client.call(
      {
        name: 'delete project',
        scopes: PROJECT_ADMIN_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.DELETE('/api/0/projects/{organization_slug}/{project_slug}/', {
          params: { path: { organization_slug: org, project_slug: args.project } },
        }),
    );
    return this.output.render(args.format, changedProjectView(`Deleted project ${args.project}.`));
  }
}
