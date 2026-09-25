import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { callForIssue } from './issue-not-found';
import { assignedIssueView, issueDetailView, resultView } from './issues.format';
import { issueIdParam } from './issues.params';
import { ISSUE_WRITE_SCOPES } from './issues.scopes';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.

const STATUSES = ['resolved', 'unresolved', 'ignored'] as const;

const updateIssueStatusArgs = z
  .object({
    organization: organizationParam,
    issue_id: issueIdParam,
    status: z.enum(STATUSES).describe('New status.'),
    in_release: z
      .string()
      .optional()
      .describe('Release version this was resolved in. Only valid with status: "resolved".'),
    in_next_release: z
      .boolean()
      .optional()
      .describe('Mark resolved in the next release. Only valid with status: "resolved".'),
    format: formatParam,
  })
  .refine(
    (v) =>
      v.status === 'resolved' || (v.in_release === undefined && v.in_next_release === undefined),
    {
      message: 'in_release and in_next_release are only valid with status: "resolved".',
    },
  );

const assignIssueArgs = z.object({
  organization: organizationParam,
  issue_id: issueIdParam,
  assignee: z
    .string()
    .min(1)
    .nullable()
    .describe('"user:<id>", "team:<slug>", a member email, or null to unassign.'),
  format: formatParam,
});

const bulkUpdateIssuesArgs = z
  .object({
    organization: organizationParam,
    issue_ids: z
      .array(z.number().int().positive())
      .min(1)
      .max(100)
      .describe('Issue ids to update.'),
    status: z.enum(STATUSES).optional(),
    assignee: z
      .string()
      .min(1)
      .optional()
      .describe('"user:<id>", "team:<slug>", or a member email.'),
    format: formatParam,
  })
  .refine((v) => v.status !== undefined || v.assignee !== undefined, {
    message: 'At least one of status or assignee is required.',
  });

const mergeIssuesArgs = z.object({
  organization: organizationParam,
  issue_ids: z
    .array(z.number().int().positive())
    .min(2)
    .max(100)
    .describe('Issue ids to merge; the highest id is kept.'),
  confirm: z
    .string()
    .describe('Must equal the target issue id (the highest of issue_ids) as a string.'),
  format: formatParam,
});

const deleteIssueArgs = z.object({
  organization: organizationParam,
  issue_id: issueIdParam,
  confirm: z.string().describe('Must equal issue_id as a string.'),
  format: formatParam,
});

const bulkDeleteIssuesArgs = z.object({
  organization: organizationParam,
  issue_ids: z.array(z.number().int().positive()).min(1).max(100).describe('Issue ids to delete.'),
  confirm: z.string().describe('Must equal the number of issue_ids as a string, e.g. "12".'),
  format: formatParam,
});

@GlitchTipTools()
export class IssuesMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'update_issue_status',
    description: 'Resolve, ignore or reopen an issue. Scope: event:write or event:admin.',
    parameters: updateIssueStatusArgs,
    annotations: {
      title: 'Update issue status',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async updateIssueStatus(
    @Payload() args: z.infer<typeof updateIssueStatusArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const statusDetails =
      args.in_release !== undefined || args.in_next_release !== undefined
        ? { inRelease: args.in_release ?? null, inNextRelease: args.in_next_release ?? null }
        : undefined;
    const updated = await callForIssue(
      glitchtip.client.call(
        {
          name: 'update issue status',
          scopes: ISSUE_WRITE_SCOPES,
          resource: 'Issue',
          id: args.issue_id,
          org,
        },
        (api) =>
          api.PUT('/api/0/organizations/{organization_slug}/issues/{issue_id}/', {
            params: { path: { organization_slug: org, issue_id: args.issue_id } },
            body: { status: args.status, statusDetails },
          }),
      ),
      org,
      args.issue_id,
    );
    return this.output.render(args.format, issueDetailView(updated));
  }

  @Tool({
    name: 'assign_issue',
    description:
      'Assign or unassign an issue. `assignee` accepts "user:<id>", "team:<slug>", a member ' +
      'email, or null to unassign. Scope: event:write or event:admin.',
    parameters: assignIssueArgs,
    annotations: { title: 'Assign issue', ...mutation({ destructive: false, idempotent: true }) },
  })
  async assignIssue(
    @Payload() args: z.infer<typeof assignIssueArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const updated = await callForIssue(
      glitchtip.client.call(
        {
          name: 'assign issue',
          scopes: ISSUE_WRITE_SCOPES,
          resource: 'Issue',
          id: args.issue_id,
          org,
        },
        (api) =>
          api.PUT('/api/0/organizations/{organization_slug}/issues/{issue_id}/', {
            params: { path: { organization_slug: org, issue_id: args.issue_id } },
            body: { assignedTo: args.assignee },
          }),
      ),
      org,
      args.issue_id,
    );
    return this.output.render(args.format, assignedIssueView(args.issue_id, updated.assignedTo));
  }

  @Tool({
    name: 'bulk_update_issues',
    description:
      'Change status and/or assignee of several issues at once. `issue_ids` is required: this ' +
      'tool never applies an unfiltered bulk update. Scope: event:write or event:admin.',
    parameters: bulkUpdateIssuesArgs,
    annotations: {
      title: 'Bulk update issues',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async bulkUpdateIssues(
    @Payload() args: z.infer<typeof bulkUpdateIssuesArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await glitchtip.client.call(
      { name: 'bulk update issues', scopes: ISSUE_WRITE_SCOPES, org },
      (api) =>
        api.PUT('/api/0/organizations/{organization_slug}/issues/', {
          params: { path: { organization_slug: org }, query: { id: args.issue_ids } },
          body: { status: args.status, assignedTo: args.assignee },
        }),
    );
    return this.output.render(
      args.format,
      resultView(`Updated ${args.issue_ids.length} issues: ${args.issue_ids.join(', ')}.`, {
        ids: args.issue_ids,
      }),
    );
  }

  @Tool({
    name: 'merge_issues',
    description:
      'Merge several issues into one. GlitchTip keeps the issue with the highest id and moves ' +
      "the others' events and hashes into it; the others are deleted. `confirm` must equal that " +
      'target id. Scope: event:write or event:admin.',
    parameters: mergeIssuesArgs,
    annotations: { title: 'Merge issues', ...mutation({ destructive: true, idempotent: false }) },
  })
  async mergeIssues(
    @Payload() args: z.infer<typeof mergeIssuesArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const target = Math.max(...args.issue_ids);
    if (args.confirm !== String(target)) {
      return error(
        `Not merged: confirm must equal the target issue id ${target} (the highest id in issue_ids).`,
      );
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await glitchtip.client.call({ name: 'merge issues', scopes: ISSUE_WRITE_SCOPES, org }, (api) =>
      api.PUT('/api/0/organizations/{organization_slug}/issues/', {
        params: { path: { organization_slug: org }, query: { id: args.issue_ids } },
        body: { merge: 1 },
      }),
    );
    const merged = args.issue_ids.filter((id) => id !== target);
    return this.output.render(
      args.format,
      resultView(`Merged ${merged.join(', ')} into ${target}.`, { target, merged }),
    );
  }

  @Tool({
    name: 'delete_issue',
    description:
      'Permanently delete an issue and its events. Cannot be undone. `confirm` must equal ' +
      'issue_id. Scope: event:write or event:admin.',
    parameters: deleteIssueArgs,
    annotations: { title: 'Delete issue', ...mutation({ destructive: true, idempotent: false }) },
  })
  async deleteIssue(
    @Payload() args: z.infer<typeof deleteIssueArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== String(args.issue_id)) {
      return error(`Not deleted: confirm must equal the issue id "${args.issue_id}" exactly.`);
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await callForIssue(
      glitchtip.client.call(
        {
          name: 'delete issue',
          scopes: ISSUE_WRITE_SCOPES,
          resource: 'Issue',
          id: args.issue_id,
          org,
        },
        (api) =>
          api.DELETE('/api/0/organizations/{organization_slug}/issues/{issue_id}/', {
            params: { path: { organization_slug: org, issue_id: args.issue_id } },
          }),
      ),
      org,
      args.issue_id,
    );
    return this.output.render(args.format, resultView(`Deleted issue ${args.issue_id}.`));
  }

  @Tool({
    name: 'bulk_delete_issues',
    description:
      'Permanently delete several issues. `issue_ids` is required: this tool never applies an ' +
      'unfiltered bulk delete. `confirm` must equal the number of issue_ids. ' +
      'Scope: event:write or event:admin.',
    parameters: bulkDeleteIssuesArgs,
    annotations: {
      title: 'Bulk delete issues',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async bulkDeleteIssues(
    @Payload() args: z.infer<typeof bulkDeleteIssuesArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== String(args.issue_ids.length)) {
      return error(
        `Not deleted: confirm must equal the number of issue_ids ("${args.issue_ids.length}") exactly.`,
      );
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await glitchtip.client.call(
      { name: 'bulk delete issues', scopes: ISSUE_WRITE_SCOPES, org },
      (api) =>
        api.DELETE('/api/0/organizations/{organization_slug}/issues/', {
          params: { path: { organization_slug: org }, query: { id: args.issue_ids } },
        }),
    );
    return this.output.render(
      args.format,
      resultView(`Deleted ${args.issue_ids.length} issues: ${args.issue_ids.join(', ')}.`, {
        ids: args.issue_ids,
      }),
    );
  }
}
