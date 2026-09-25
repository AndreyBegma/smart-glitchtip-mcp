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
import { resultView } from './issues.format';
import { issueIdParam } from './issues.params';
import { ISSUE_ADMIN_SCOPES, ISSUE_WRITE_SCOPES } from './issues.scopes';
import { commentView } from './issues.subresource.format';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.

const COMMENT_TEXT = z.string().min(1).max(10_000).describe('Comment text.');

// UUID-shaped, not RFC4122-strict: the OpenAPI snapshot types the query param as
// plain string[] with no format annotation (schema.d.ts IssueHashQuerySchema),
// so a hash id's version/variant nibbles are not something GlitchTip guarantees.
const HASH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const addCommentArgs = z.object({
  organization: organizationParam,
  issue_id: issueIdParam,
  text: COMMENT_TEXT,
  format: formatParam,
});

const updateCommentArgs = z.object({
  organization: organizationParam,
  issue_id: issueIdParam,
  comment_id: z.number().int().positive().describe('Comment id.'),
  text: COMMENT_TEXT,
  format: formatParam,
});

const deleteCommentArgs = z.object({
  organization: organizationParam,
  issue_id: issueIdParam,
  comment_id: z.number().int().positive().describe('Comment id.'),
  confirm: z.string().describe('Must equal comment_id as a string.'),
  format: formatParam,
});

const unmergeHashesArgs = z.object({
  organization: organizationParam,
  issue_id: issueIdParam,
  hash_ids: z
    .array(z.string().regex(HASH_ID, 'must be a uuid-shaped hash id'))
    .min(1)
    .max(100)
    .describe('Fingerprint hash ids to split out into new issues.'),
  format: formatParam,
});

@GlitchTipTools()
export class IssueSubresourceMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'add_issue_comment',
    description: 'Add a comment to an issue. Scope: event:write or event:admin.',
    parameters: addCommentArgs,
    annotations: {
      title: 'Add issue comment',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async addIssueComment(
    @Payload() args: z.infer<typeof addCommentArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const comment = await callForIssue(
      glitchtip.client.call(
        {
          name: 'add issue comment',
          scopes: ISSUE_WRITE_SCOPES,
          resource: 'Issue',
          id: args.issue_id,
          org,
        },
        (api) =>
          api.POST('/api/0/organizations/{organization_slug}/issues/{issue_id}/comments/', {
            params: { path: { organization_slug: org, issue_id: args.issue_id } },
            body: { data: { text: args.text } },
          }),
      ),
      org,
      args.issue_id,
    );
    return this.output.render(
      args.format,
      commentView(`Added comment ${comment.id} to issue ${args.issue_id}.`, comment),
    );
  }

  @Tool({
    name: 'update_issue_comment',
    description: 'Edit a comment on an issue. Scope: event:write or event:admin.',
    parameters: updateCommentArgs,
    annotations: {
      title: 'Update issue comment',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async updateIssueComment(
    @Payload() args: z.infer<typeof updateCommentArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const comment = await callForIssue(
      glitchtip.client.call(
        {
          name: 'update issue comment',
          scopes: ISSUE_WRITE_SCOPES,
          resource: 'Comment',
          id: args.comment_id,
          org,
        },
        (api) =>
          api.PUT(
            '/api/0/organizations/{organization_slug}/issues/{issue_id}/comments/{comment_id}/',
            {
              params: {
                path: {
                  organization_slug: org,
                  issue_id: args.issue_id,
                  comment_id: args.comment_id,
                },
              },
              body: { data: { text: args.text } },
            },
          ),
      ),
      org,
      args.issue_id,
    );
    return this.output.render(
      args.format,
      commentView(`Updated comment ${args.comment_id}.`, comment),
    );
  }

  @Tool({
    name: 'delete_issue_comment',
    description:
      'Permanently delete a comment. Cannot be undone. `confirm` must equal comment_id. ' +
      'Scope: event:admin.',
    parameters: deleteCommentArgs,
    annotations: {
      title: 'Delete issue comment',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async deleteIssueComment(
    @Payload() args: z.infer<typeof deleteCommentArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== String(args.comment_id)) {
      return error(`Not deleted: confirm must equal the comment id "${args.comment_id}" exactly.`);
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await glitchtip.client.call(
      {
        name: 'delete issue comment',
        scopes: ISSUE_ADMIN_SCOPES,
        resource: 'Comment',
        id: args.comment_id,
        org,
      },
      (api) =>
        api.DELETE(
          '/api/0/organizations/{organization_slug}/issues/{issue_id}/comments/{comment_id}/',
          {
            params: {
              path: {
                organization_slug: org,
                issue_id: args.issue_id,
                comment_id: args.comment_id,
              },
            },
          },
        ),
    );
    return this.output.render(
      args.format,
      resultView(`Deleted comment ${args.comment_id} from issue ${args.issue_id}.`),
    );
  }

  @Tool({
    name: 'unmerge_issue_hashes',
    description:
      'Split events with the given fingerprint hashes out of this issue into new issues. ' +
      'GlitchTip processes this asynchronously. Scope: event:admin.',
    parameters: unmergeHashesArgs,
    annotations: {
      title: 'Unmerge issue hashes',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async unmergeIssueHashes(
    @Payload() args: z.infer<typeof unmergeHashesArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await callForIssue(
      glitchtip.client.call(
        {
          name: 'unmerge issue hashes',
          scopes: ISSUE_ADMIN_SCOPES,
          resource: 'Issue',
          id: args.issue_id,
          org,
        },
        (api) =>
          api.DELETE('/api/0/organizations/{organization_slug}/issues/{issue_id}/hashes/', {
            params: {
              path: { organization_slug: org, issue_id: args.issue_id },
              query: { id: args.hash_ids },
            },
          }),
      ),
      org,
      args.issue_id,
    );
    return this.output.render(
      args.format,
      resultView(
        `Splitting ${args.hash_ids.length} hash(es) out of issue ${args.issue_id} into new issues; ` +
          'GlitchTip processes this asynchronously.',
      ),
    );
  }
}
