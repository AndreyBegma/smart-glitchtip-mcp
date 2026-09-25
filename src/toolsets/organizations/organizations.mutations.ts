import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import {
  formatParam,
  mutation,
  organizationParam,
  requiredOrganizationParam,
} from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { changedOrganizationView } from './organizations.format';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.

const ORG_WRITE_SCOPES = ['org:write', 'org:admin'] as const;
const ORG_ADMIN_SCOPES = ['org:admin'] as const;

const nameParam = z.string().trim().min(1).max(200).describe('Organization name.');

const createArgs = z.object({ name: nameParam, format: formatParam });

const updateArgs = z.object({
  organization: organizationParam,
  name: nameParam.describe('New organization name.'),
  format: formatParam,
});

const deleteArgs = z.object({
  organization: requiredOrganizationParam,
  confirm: z
    .string()
    .describe('Must equal `organization` exactly; guards against deleting the wrong one.'),
  format: formatParam,
});

@GlitchTipTools()
export class OrganizationsMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'create_organization',
    description:
      'Create an organization. Many instances disable this for non-superusers; GlitchTip then ' +
      "answers 403. No token scope is checked; the instance's organization-creation setting decides.",
    parameters: createArgs,
    annotations: {
      title: 'Create organization',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async createOrganization(
    @Payload() args: z.infer<typeof createArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const { client } = this.instances.connect(ctx.getRawRequest());
    const created = await client.call(
      { name: 'create organization', scopes: ['superuser, or open organization creation'] },
      (api) => api.POST('/api/0/organizations/', { body: { name: args.name } }),
    );
    return this.output.render(
      args.format,
      changedOrganizationView(`Created organization ${created.slug} (${created.name}).`, created),
    );
  }

  @Tool({
    name: 'update_organization',
    description:
      'Rename an organization (the name is the only field GlitchTip lets you change; the slug ' +
      'stays). Scope: org:write or org:admin.',
    parameters: updateArgs,
    annotations: {
      title: 'Rename organization',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async updateOrganization(
    @Payload() args: z.infer<typeof updateArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const updated = await glitchtip.client.call(
      { name: 'update organization', scopes: ORG_WRITE_SCOPES, resource: 'Organization', id: org },
      (api) =>
        api.PUT('/api/0/organizations/{organization_slug}/', {
          params: { path: { organization_slug: org } },
          body: { name: args.name },
        }),
    );
    return this.output.render(
      args.format,
      changedOrganizationView(`Renamed organization ${updated.slug} to ${updated.name}.`, updated),
    );
  }

  @Tool({
    name: 'delete_organization',
    description:
      'Permanently delete an organization and everything in it: projects, issues, events, ' +
      'releases. Cannot be undone. `organization` is required and `confirm` must repeat it. ' +
      'Scope: org:admin.',
    parameters: deleteArgs,
    annotations: {
      title: 'Delete organization',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async deleteOrganization(
    @Payload() args: z.infer<typeof deleteArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== args.organization) {
      return error(
        `Not deleted: confirm must equal the organization slug "${args.organization}" exactly.`,
      );
    }
    const { client } = this.instances.connect(ctx.getRawRequest());
    await client.call(
      {
        name: 'delete organization',
        scopes: ORG_ADMIN_SCOPES,
        resource: 'Organization',
        id: args.organization,
      },
      (api) =>
        api.DELETE('/api/0/organizations/{organization_slug}/', {
          params: { path: { organization_slug: args.organization } },
        }),
    );
    return this.output.render(
      args.format,
      changedOrganizationView(`Deleted organization ${args.organization}.`),
    );
  }
}
