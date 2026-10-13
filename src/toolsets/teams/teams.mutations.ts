import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import {
  callForCreateTeam,
  callForDeleteTeam,
  callForRenameTeam,
  callForTeamMembership,
} from './team-errors';
import { resultView, teamDetailView } from './teams.format';
import { memberOrMeParam, newTeamSlugParam, teamParam } from './teams.params';
import { TEAM_ADMIN_SCOPES, TEAM_CREATE_SCOPES, TEAM_WRITE_SCOPES } from './teams.scopes';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.

const createTeamArgs = z.object({
  organization: organizationParam,
  slug: teamParam,
  format: formatParam,
});

const renameTeamArgs = z
  .object({
    organization: organizationParam,
    team: teamParam,
    new_slug: newTeamSlugParam,
    format: formatParam,
  })
  .refine((v) => v.new_slug !== v.team, { message: 'new_slug must differ from team.' });

const deleteTeamArgs = z.object({
  organization: organizationParam,
  team: teamParam,
  confirm: z.string().describe('Must equal `team` exactly; guards against deleting the wrong one.'),
  format: formatParam,
});

const memberTeamArgs = z.object({
  organization: organizationParam,
  member: memberOrMeParam,
  team: teamParam,
  format: formatParam,
});

@GlitchTipTools()
export class TeamsMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'create_team',
    description:
      'Create a team; you become its first member. Needs the admin organization role. ' +
      'Scope: team:write, team:admin, org:write or org:admin.',
    parameters: createTeamArgs,
    annotations: { title: 'Create team', ...mutation({ destructive: false, idempotent: false }) },
  })
  async createTeam(
    @Payload() args: z.infer<typeof createTeamArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const team = await callForCreateTeam(
      glitchtip.client.call({ name: 'create team', scopes: TEAM_CREATE_SCOPES, org }, (api) =>
        api.POST('/api/0/organizations/{organization_slug}/teams/', {
          params: { path: { organization_slug: org } },
          body: { slug: args.slug },
        }),
      ),
      org,
      args.slug,
    );
    if (!team) {
      return this.output.render(
        args.format,
        resultView(`Created team ${args.slug} in ${org}; GlitchTip returned no body.`),
      );
    }
    return this.output.render(args.format, teamDetailView(team));
  }

  @Tool({
    name: 'rename_team',
    description:
      'Change a team’s slug. References to the old slug (issue assignees `team:<slug>`, ' +
      'bookmarks) stop matching. Scope: team:write or team:admin.',
    parameters: renameTeamArgs,
    annotations: { title: 'Rename team', ...mutation({ destructive: false, idempotent: true }) },
  })
  async renameTeam(
    @Payload() args: z.infer<typeof renameTeamArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const team = await callForRenameTeam(
      glitchtip.client.call(
        { name: 'rename team', scopes: TEAM_WRITE_SCOPES, resource: 'Team', id: args.team, org },
        (api) =>
          api.PUT('/api/0/teams/{organization_slug}/{team_slug}/', {
            params: { path: { organization_slug: org, team_slug: args.team } },
            body: { slug: args.new_slug },
          }),
      ),
      org,
      args.new_slug,
    );
    if (!team) {
      return this.output.render(
        args.format,
        resultView(
          `Renamed team ${args.team} to ${args.new_slug} in ${org}; GlitchTip returned no body.`,
        ),
      );
    }
    return this.output.render(args.format, teamDetailView(team));
  }

  @Tool({
    name: 'delete_team',
    description:
      'Permanently delete a team. Its projects and members are not deleted; they lose this team. ' +
      '`confirm` must equal `team`. Scope: team:admin.',
    parameters: deleteTeamArgs,
    annotations: { title: 'Delete team', ...mutation({ destructive: true, idempotent: false }) },
  })
  async deleteTeam(
    @Payload() args: z.infer<typeof deleteTeamArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== args.team) {
      return error(`Not deleted: confirm must equal the team slug "${args.team}" exactly.`);
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await callForDeleteTeam(
      glitchtip.client.call(
        { name: 'delete team', scopes: TEAM_ADMIN_SCOPES, resource: 'Team', id: args.team, org },
        (api) =>
          api.DELETE('/api/0/teams/{organization_slug}/{team_slug}/', {
            params: { path: { organization_slug: org, team_slug: args.team } },
          }),
      ),
      org,
      args.team,
    );
    return this.output.render(args.format, resultView(`Deleted team ${args.team} from ${org}.`));
  }

  @Tool({
    name: 'add_member_to_team',
    description:
      'Add a member to a team. `member` accepts a positive integer id (from list_members) or ' +
      '"me". Scope: team:write or team:admin.',
    parameters: memberTeamArgs,
    annotations: {
      title: 'Add member to team',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async addMemberToTeam(
    @Payload() args: z.infer<typeof memberTeamArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const team = await callForTeamMembership(
      glitchtip.client.call(
        {
          name: 'add member to team',
          scopes: TEAM_WRITE_SCOPES,
          resource: 'Team',
          id: args.team,
          org,
        },
        (api) =>
          api.POST(
            '/api/0/organizations/{organization_slug}/members/{member_id}/teams/{team_slug}/',
            {
              params: {
                path: { organization_slug: org, member_id: args.member, team_slug: args.team },
              },
            },
          ),
      ),
      org,
      args.member,
      args.team,
    );
    if (!team) {
      return this.output.render(
        args.format,
        resultView(
          `Added member ${args.member} to team ${args.team} in ${org}; GlitchTip returned no body.`,
        ),
      );
    }
    return this.output.render(args.format, teamDetailView(team));
  }

  @Tool({
    name: 'remove_member_from_team',
    description:
      'Remove a member from a team. `member` accepts a positive integer id (from list_members) or ' +
      '"me". Reversible with add_member_to_team. Scope: team:write or team:admin.',
    parameters: memberTeamArgs,
    annotations: {
      title: 'Remove member from team',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async removeMemberFromTeam(
    @Payload() args: z.infer<typeof memberTeamArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const team = await callForTeamMembership(
      glitchtip.client.call(
        {
          name: 'remove member from team',
          scopes: TEAM_WRITE_SCOPES,
          resource: 'Team',
          id: args.team,
          org,
        },
        (api) =>
          api.DELETE(
            '/api/0/organizations/{organization_slug}/members/{member_id}/teams/{team_slug}/',
            {
              params: {
                path: { organization_slug: org, member_id: args.member, team_slug: args.team },
              },
            },
          ),
      ),
      org,
      args.member,
      args.team,
    );
    if (!team) {
      return this.output.render(
        args.format,
        resultView(
          `Removed member ${args.member} from team ${args.team} in ${org}; GlitchTip returned no body.`,
        ),
      );
    }
    return this.output.render(args.format, teamDetailView(team));
  }
}
