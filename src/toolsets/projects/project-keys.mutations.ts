import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { changedProjectKeyView } from './projects.format';
import { notPreserved, PROJECT_ADMIN_SCOPES, PROJECT_WRITE_SCOPES } from './projects.mutations';
import { keyIdParam, projectParam, rateLimitParam } from './projects.params';
import { PROJECT_READ_SCOPES } from './projects.tools';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.
// Client keys (DSNs); project lifecycle is projects.mutations.ts.

const createProjectKeyArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  label: z.string().trim().min(1).max(200).optional().describe('Key label.'),
  rate_limit: rateLimitParam.optional(),
  format: formatParam,
});

const updateProjectKeyArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  key_id: keyIdParam,
  label: z.string().trim().min(1).max(200).optional().describe('New key label.'),
  rate_limit: rateLimitParam.nullable().optional().describe('New rate limit; null clears it.'),
  format: formatParam,
});

const deleteProjectKeyArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  key_id: keyIdParam,
  confirm: z
    .string()
    .describe('Must equal `key_id` exactly; guards against deleting the wrong key.'),
  format: formatParam,
});

/**
 * The key's current label: GlitchTip's canonical field is `label`, and `name`
 * may be absent. The first that is text wins, then a `null`; `undefined` when
 * neither is usable.
 */
function currentLabel(name: unknown, label: unknown): string | null | undefined {
  const candidates = [name, label];
  const text = candidates.find((value) => typeof value === 'string');
  if (typeof text === 'string') return text;
  return candidates.includes(null) ? null : undefined;
}

function isRateLimitOrNull(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const { window, count } = value as Record<string, unknown>;
  return Number.isFinite(window) && Number.isFinite(count);
}

@GlitchTipTools()
export class ProjectKeysMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'create_project_key',
    description: 'Create a client key (DSN) for a project. Scope: project:write or project:admin.',
    parameters: createProjectKeyArgs,
    annotations: {
      title: 'Create project key',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async createProjectKey(
    @Payload() args: z.infer<typeof createProjectKeyArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const key = await glitchtip.client.call(
      {
        name: 'create project key',
        scopes: PROJECT_WRITE_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.POST('/api/0/projects/{organization_slug}/{project_slug}/keys/', {
          params: { path: { organization_slug: org, project_slug: args.project } },
          body: { name: args.label, rateLimit: args.rate_limit },
        }),
    );
    return this.output.render(
      args.format,
      changedProjectKeyView(`Created client key ${key.id}.`, key),
    );
  }

  @Tool({
    name: 'update_project_key',
    description:
      "Change a client key's label or rate limit. Unspecified fields keep their current " +
      'value; `rate_limit: null` clears it. Scope: project:write or project:admin.',
    parameters: updateProjectKeyArgs,
    annotations: {
      title: 'Update project key',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async updateProjectKey(
    @Payload() args: z.infer<typeof updateProjectKeyArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const current = await glitchtip.client.call(
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
    // The PUT is full-replace: a field the read lacks, or carries with the wrong type,
    // refuses unless the caller gives it (AGENTS.md rule 15).
    const label = args.label ?? currentLabel(current.name, current.label);
    if (label === undefined) {
      const read = current.label === undefined ? current.name : current.label;
      return error(notPreserved('label', 'label', read, 'text or null'));
    }
    const rateLimit = args.rate_limit !== undefined ? args.rate_limit : current.rateLimit;
    if (!isRateLimitOrNull(rateLimit)) {
      return error(notPreserved('rateLimit', 'rate_limit', rateLimit, 'a rate limit or null'));
    }
    const body = { name: label, rateLimit };
    const updated = await glitchtip.client.call(
      {
        name: 'update project key',
        scopes: PROJECT_WRITE_SCOPES,
        resource: 'Key',
        id: args.key_id,
        org,
      },
      (api) =>
        api.PUT('/api/0/projects/{organization_slug}/{project_slug}/keys/{key_id}/', {
          params: {
            path: { organization_slug: org, project_slug: args.project, key_id: args.key_id },
          },
          body,
        }),
    );
    return this.output.render(
      args.format,
      changedProjectKeyView(`Updated client key ${updated.id}.`, updated),
    );
  }

  @Tool({
    name: 'delete_project_key',
    description:
      'Delete a client key; applications using this DSN stop being able to send events. ' +
      '`confirm` must repeat `key_id`. Scope: project:admin.',
    parameters: deleteProjectKeyArgs,
    annotations: {
      title: 'Delete project key',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async deleteProjectKey(
    @Payload() args: z.infer<typeof deleteProjectKeyArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== args.key_id) {
      return error(`Not deleted: confirm must equal the key id "${args.key_id}" exactly.`);
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await glitchtip.client.call(
      {
        name: 'delete project key',
        scopes: PROJECT_ADMIN_SCOPES,
        resource: 'Key',
        id: args.key_id,
        org,
      },
      (api) =>
        api.DELETE('/api/0/projects/{organization_slug}/{project_slug}/keys/{key_id}/', {
          params: {
            path: { organization_slug: org, project_slug: args.project, key_id: args.key_id },
          },
        }),
    );
    return this.output.render(
      args.format,
      changedProjectKeyView(`Deleted client key ${args.key_id}.`),
    );
  }
}
