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
  environmentListView,
  organizationDetailView,
  organizationListView,
} from './organizations.format';

/** Scopes GlitchTip accepts for organization reads (`@has_permission`, v6.2.6). */
export const ORG_READ_SCOPES = ['org:read', 'org:write', 'org:admin'] as const;

const listOrganizationsArgs = z.object({
  cursor: cursorParam,
  limit: limitParam,
  format: formatParam,
});

const getOrganizationArgs = z.object({
  organization: organizationParam,
  format: formatParam,
});

const listEnvironmentsArgs = z.object({
  organization: organizationParam,
  visibility: z
    .enum(['visible', 'hidden', 'all'])
    .default('visible')
    .describe('Which environments to list: visible (default), hidden, or all.'),
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

@GlitchTipTools()
export class OrganizationsTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'list_organizations',
    description:
      'List organizations the token can see, with slug, name and creation date. ' +
      'Scope: org:read, org:write or org:admin.',
    parameters: listOrganizationsArgs,
    annotations: { title: 'List organizations', ...READ_ONLY },
  })
  async listOrganizations(
    @Payload() args: z.infer<typeof listOrganizationsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const { client } = this.instances.connect(ctx.getRawRequest());
    const page = await client.page({ name: 'list organizations', scopes: ORG_READ_SCOPES }, (api) =>
      api.GET('/api/0/organizations/', {
        params: { query: { limit: args.limit, cursor: args.cursor } },
      }),
    );
    return this.output.render(args.format, organizationListView(page));
  }

  @Tool({
    name: 'get_organization',
    description:
      'Get one organization: slug, name, its projects and teams (counts and slugs), and the ' +
      'access scopes you hold in it. Scope: org:read, org:write or org:admin.',
    parameters: getOrganizationArgs,
    annotations: { title: 'Get organization', ...READ_ONLY },
  })
  async getOrganization(
    @Payload() args: z.infer<typeof getOrganizationArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const detail = await glitchtip.client.call(
      { name: 'get organization', scopes: ORG_READ_SCOPES, resource: 'Organization', id: org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/', {
          params: { path: { organization_slug: org } },
        }),
    );
    return this.output.render(args.format, organizationDetailView(detail));
  }

  @Tool({
    name: 'list_organization_environments',
    description:
      "List environment names used in an organization's events (e.g. production, staging). " +
      'Scope: org:read, org:write or org:admin.',
    parameters: listEnvironmentsArgs,
    annotations: { title: 'List organization environments', ...READ_ONLY },
  })
  async listOrganizationEnvironments(
    @Payload() args: z.infer<typeof listEnvironmentsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      {
        name: 'list organization environments',
        scopes: ORG_READ_SCOPES,
        resource: 'Organization',
        id: org,
      },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/environments/', {
          params: {
            path: { organization_slug: org },
            query: { visibility: args.visibility, limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(args.format, environmentListView(org, args.visibility, page));
  }
}
