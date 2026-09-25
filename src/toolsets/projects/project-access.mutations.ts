import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { changedEnvironmentView, changedProjectTeamView } from './projects.format';
import { PROJECT_WRITE_SCOPES } from './projects.mutations';
import { environmentNameParam, projectParam, teamParam } from './projects.params';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.
// Environment visibility and team attachment; project/key lifecycle live in
// projects.mutations.ts and project-keys.mutations.ts.

// Upstream quirk (see the spec's Risks): GlitchTip also decorates add/remove-team with an
// invalid "project.write" scope (a dot, not a colon) that no token can ever match.
const TEAM_ADMIN_REQUIREMENT =
  'project:admin (the route also lists a malformed "project.write" scope that no token can match)';

const setEnvironmentVisibilityArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  environment: environmentNameParam,
  hidden: z.boolean().describe('Hide the environment from the default project view.'),
  format: formatParam,
});

const projectTeamArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  team: teamParam,
  format: formatParam,
});

@GlitchTipTools()
export class ProjectAccessMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'set_project_environment_visibility',
    description:
      "Hide or show one of a project's environments. Scope: project:write or project:admin.",
    parameters: setEnvironmentVisibilityArgs,
    annotations: {
      title: 'Set project environment visibility',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async setProjectEnvironmentVisibility(
    @Payload() args: z.infer<typeof setEnvironmentVisibilityArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const env = await glitchtip.client.call(
      {
        name: 'set project environment visibility',
        scopes: PROJECT_WRITE_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.PUT('/api/0/projects/{organization_slug}/{project_slug}/environments/{name}/', {
          params: {
            path: { organization_slug: org, project_slug: args.project, name: args.environment },
          },
          body: { name: args.environment, isHidden: args.hidden },
        }),
    );
    return this.output.render(
      args.format,
      changedEnvironmentView(
        `${args.hidden ? 'Hid' : 'Unhid'} environment ${env.name} in ${args.project}.`,
        env,
      ),
    );
  }

  @Tool({
    name: 'add_team_to_project',
    description: 'Attach a team to a project, granting its members access. Scope: project:admin.',
    parameters: projectTeamArgs,
    annotations: {
      title: 'Add team to project',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async addTeamToProject(
    @Payload() args: z.infer<typeof projectTeamArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const project = await glitchtip.client.call(
      {
        name: 'add team to project',
        scopes: [],
        requirement: TEAM_ADMIN_REQUIREMENT,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.POST('/api/0/projects/{organization_slug}/{project_slug}/teams/{team_slug}/', {
          params: {
            path: { organization_slug: org, project_slug: args.project, team_slug: args.team },
          },
        }),
    );
    return this.output.render(
      args.format,
      changedProjectTeamView(`Added team ${args.team} to project ${args.project}.`, project),
    );
  }

  @Tool({
    name: 'remove_team_from_project',
    description: 'Detach a team from a project. Reversible. Scope: project:admin.',
    parameters: projectTeamArgs,
    annotations: {
      title: 'Remove team from project',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async removeTeamFromProject(
    @Payload() args: z.infer<typeof projectTeamArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const project = await glitchtip.client.call(
      {
        name: 'remove team from project',
        scopes: [],
        requirement: TEAM_ADMIN_REQUIREMENT,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.DELETE('/api/0/projects/{organization_slug}/{project_slug}/teams/{team_slug}/', {
          params: {
            path: { organization_slug: org, project_slug: args.project, team_slug: args.team },
          },
        }),
    );
    return this.output.render(
      args.format,
      changedProjectTeamView(`Removed team ${args.team} from project ${args.project}.`, project),
    );
  }
}
