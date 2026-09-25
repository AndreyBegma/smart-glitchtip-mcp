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
import { teamDetailView, teamListView } from './teams.format';
import { teamParam } from './teams.params';
import { TEAM_LIST_SCOPES, TEAM_READ_SCOPES } from './teams.scopes';

const listTeamsArgs = z.object({
  organization: organizationParam,
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

const getTeamArgs = z.object({
  organization: organizationParam,
  team: teamParam,
  format: formatParam,
});

@GlitchTipTools()
export class TeamsTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'list_teams',
    description:
      'List the teams of an organization with their member count, whether you are a member, and ' +
      'their projects. Scope: team:read, team:write, team:admin, org:read, org:write or org:admin.',
    parameters: listTeamsArgs,
    annotations: { title: 'List teams', ...READ_ONLY },
  })
  async listTeams(
    @Payload() args: z.infer<typeof listTeamsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      { name: 'list teams', scopes: TEAM_LIST_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/teams/', {
          params: {
            path: { organization_slug: org },
            query: { limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(args.format, teamListView(page, org));
  }

  @Tool({
    name: 'get_team',
    description:
      'Get one team: slug, id, member count, whether you are a member, and its projects. ' +
      'Scope: team:read, team:write or team:admin.',
    parameters: getTeamArgs,
    annotations: { title: 'Get team', ...READ_ONLY },
  })
  async getTeam(
    @Payload() args: z.infer<typeof getTeamArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const team = await glitchtip.client.call(
      {
        name: 'get team',
        scopes: TEAM_READ_SCOPES,
        resource: 'Team',
        id: args.team,
        org,
      },
      (api) =>
        api.GET('/api/0/teams/{organization_slug}/{team_slug}/', {
          params: { path: { organization_slug: org, team_slug: args.team } },
        }),
    );
    return this.output.render(args.format, teamDetailView(team));
  }
}
