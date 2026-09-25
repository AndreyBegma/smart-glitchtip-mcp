import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import {
  cursorParam,
  formatParam,
  limitParam,
  organizationParam,
  READ_ONLY,
} from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import {
  projectDetailView,
  projectEnvironmentListView,
  projectKeyDetailView,
  projectKeyListView,
  projectListView,
  projectTeamListView,
  teamProjectListView,
} from './projects.format';
import { keyIdParam, projectParam, teamParam } from './projects.params';

/** Scope GlitchTip accepts for a project-list read (`@has_permission`, v6.2.6). */
export const PROJECT_LIST_SCOPES = ['project:read'] as const;
/** Scopes for a single project/key/environment read: any project scope will do. */
export const PROJECT_READ_SCOPES = ['project:read', 'project:write', 'project:admin'] as const;

const listProjectsArgs = z.object({
  organization: organizationParam,
  query: z
    .string()
    .optional()
    .describe('GlitchTip project search, e.g. `!team:<slug>` for projects not in a team.'),
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

const getProjectArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  format: formatParam,
});

const listTeamProjectsArgs = z.object({
  organization: organizationParam,
  team: teamParam,
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

const projectKeysArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

const getProjectKeyArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  key_id: keyIdParam,
  format: formatParam,
});

const listProjectEnvironmentsArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  visibility: z
    .enum(['visible', 'hidden', 'all'])
    .default('visible')
    .describe('Which environments to list: visible (default), hidden, or all.'),
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

const listProjectTeamsArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

@GlitchTipTools()
export class ProjectsTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'list_projects',
    description:
      'List projects in an organization: slug, name, platform, teams and when the first event ' +
      'arrived. Scope: project:read.',
    parameters: listProjectsArgs,
    annotations: { title: 'List projects', ...READ_ONLY },
  })
  async listProjects(
    @Payload() args: z.infer<typeof listProjectsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      { name: 'list projects', scopes: PROJECT_LIST_SCOPES, resource: 'Organization', id: org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/projects/', {
          params: {
            path: { organization_slug: org },
            query: { query: args.query, limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(args.format, projectListView(page));
  }

  @Tool({
    name: 'get_project',
    description:
      'Get one project: slug, name, id, platform, created, first event, event throttle rate, ' +
      'IP scrubbing, public/bookmarked flags and organization. Scope: project:read, ' +
      'project:write or project:admin.',
    parameters: getProjectArgs,
    annotations: { title: 'Get project', ...READ_ONLY },
  })
  async getProject(
    @Payload() args: z.infer<typeof getProjectArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const project = await glitchtip.client.call(
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
    return this.output.render(args.format, projectDetailView(project));
  }

  @Tool({
    name: 'list_team_projects',
    description: "List a team's projects. Scope: project:read.",
    parameters: listTeamProjectsArgs,
    annotations: { title: 'List team projects', ...READ_ONLY },
  })
  async listTeamProjects(
    @Payload() args: z.infer<typeof listTeamProjectsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      {
        name: 'list team projects',
        scopes: PROJECT_LIST_SCOPES,
        resource: 'Team',
        id: args.team,
        org,
      },
      (api) =>
        api.GET('/api/0/teams/{organization_slug}/{team_slug}/projects/', {
          params: {
            path: { organization_slug: org, team_slug: args.team },
            query: { limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(args.format, teamProjectListView(args.team, page));
  }

  @Tool({
    name: 'list_project_keys',
    description:
      "List a project's client keys (DSNs) — what an application's Sentry SDK is configured " +
      'with. Scope: project:read, project:write or project:admin.',
    parameters: projectKeysArgs,
    annotations: { title: 'List project keys', ...READ_ONLY },
  })
  async listProjectKeys(
    @Payload() args: z.infer<typeof projectKeysArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      {
        name: 'list project keys',
        scopes: PROJECT_READ_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.GET('/api/0/projects/{organization_slug}/{project_slug}/keys/', {
          params: {
            path: { organization_slug: org, project_slug: args.project },
            query: { limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(args.format, projectKeyListView(page));
  }

  @Tool({
    name: 'get_project_key',
    description:
      'Get one client key (DSN) of a project. Scope: project:read, project:write or ' +
      'project:admin.',
    parameters: getProjectKeyArgs,
    annotations: { title: 'Get project key', ...READ_ONLY },
  })
  async getProjectKey(
    @Payload() args: z.infer<typeof getProjectKeyArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const key = await glitchtip.client.call(
      {
        name: 'get project key',
        scopes: PROJECT_READ_SCOPES,
        resource: 'Key',
        id: args.key_id,
        org,
      },
      (api) =>
        api.GET('/api/0/projects/{organization_slug}/{project_slug}/keys/{key_id}/', {
          params: {
            path: { organization_slug: org, project_slug: args.project, key_id: args.key_id },
          },
        }),
    );
    return this.output.render(args.format, projectKeyDetailView(key));
  }

  @Tool({
    name: 'list_project_environments',
    description:
      "List a project's environments (e.g. production, staging) and whether each is hidden. " +
      'Scope: project:read, project:write or project:admin.',
    parameters: listProjectEnvironmentsArgs,
    annotations: { title: 'List project environments', ...READ_ONLY },
  })
  async listProjectEnvironments(
    @Payload() args: z.infer<typeof listProjectEnvironmentsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      {
        name: 'list project environments',
        scopes: PROJECT_READ_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.GET('/api/0/projects/{organization_slug}/{project_slug}/environments/', {
          params: {
            path: { organization_slug: org, project_slug: args.project },
            query: { visibility: args.visibility, limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(
      args.format,
      projectEnvironmentListView(args.project, args.visibility, page),
    );
  }

  @Tool({
    name: 'list_project_teams',
    description: 'List the teams attached to a project. Scope: project:read.',
    parameters: listProjectTeamsArgs,
    annotations: { title: 'List project teams', ...READ_ONLY },
  })
  async listProjectTeams(
    @Payload() args: z.infer<typeof listProjectTeamsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      {
        name: 'list project teams',
        scopes: PROJECT_LIST_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.GET('/api/0/projects/{organization_slug}/{project_slug}/teams/', {
          params: {
            path: { organization_slug: org, project_slug: args.project },
            query: { limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(args.format, projectTeamListView(args.project, page));
  }
}
