import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ToolOutput } from '../../format/tool-output';
import { type GlitchTipConnection, InstanceResolver } from '../../glitchtip/instance.resolver';
import { cursorParam, formatParam, organizationParam, READ_ONLY } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import {
  nPlusOneListView,
  rangeLabel,
  spanGroupListView,
  transactionGroupDetailView,
  transactionGroupListView,
  transactionTrendView,
} from './performance.format';
import {
  limitParam100,
  opPrefixParam,
  orderParam,
  projectIdsParam,
  SPAN_GROUP_SORT,
  spanGroupSortParam,
  TRANSACTION_GROUP_SORT,
  transactionGroupIdParam,
  transactionGroupSortParam,
  UNTRUSTED_NOTE,
} from './performance.params';
import { checkTimeRange, dateTimeParam } from './time-range';
import { callForTransactionGroup } from './transaction-group-not-found';

/** Scopes GlitchTip accepts for every route in this toolset (`@has_permission`, v6.2.6). */
export const PERFORMANCE_READ_SCOPES = ['event:read', 'event:write', 'event:admin'] as const;

const listTransactionGroupsArgs = z
  .object({
    organization: organizationParam,
    project_ids: projectIdsParam,
    query: z.string().optional().describe('Case-insensitive substring of the transaction name.'),
    start: dateTimeParam('start').optional().describe('Bound on last-seen, not first-seen.'),
    end: dateTimeParam('end').optional().describe('Bound on last-seen, not first-seen.'),
    sort: transactionGroupSortParam,
    order: orderParam,
    limit: limitParam100,
    cursor: cursorParam,
    format: formatParam,
  })
  .superRefine(checkTimeRange);

const getTransactionGroupArgs = z.object({
  organization: organizationParam,
  transaction_group_id: transactionGroupIdParam,
  format: formatParam,
});

const listTransactionSpansArgs = z
  .object({
    organization: organizationParam,
    transaction_group_id: transactionGroupIdParam,
    start: dateTimeParam('start').optional(),
    end: dateTimeParam('end').optional(),
    format: formatParam,
  })
  .superRefine(checkTimeRange);

const listSpanGroupsArgs = z
  .object({
    organization: organizationParam,
    project_ids: projectIdsParam,
    op: opPrefixParam,
    sort: spanGroupSortParam,
    order: orderParam,
    limit: limitParam100,
    start: dateTimeParam('start').optional(),
    end: dateTimeParam('end').optional(),
    format: formatParam,
  })
  .superRefine(checkTimeRange);

const listNPlusOnePatternsArgs = z
  .object({
    organization: organizationParam,
    project_ids: projectIdsParam,
    op: opPrefixParam.default('db'),
    threshold: z
      .number()
      .positive()
      .default(5)
      .describe('Minimum spans per transaction to count as a pattern (default 5).'),
    limit: limitParam100,
    start: dateTimeParam('start').optional(),
    end: dateTimeParam('end').optional(),
    format: formatParam,
  })
  .superRefine(checkTimeRange);

const getTransactionTrendArgs = z
  .object({
    organization: organizationParam,
    transaction_group_id: transactionGroupIdParam,
    start: dateTimeParam('start').optional(),
    end: dateTimeParam('end').optional(),
    format: formatParam,
  })
  .superRefine(checkTimeRange);

@GlitchTipTools()
export class PerformanceTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'list_transaction_groups',
    description:
      'List transaction groups (endpoints/operations) with duration, throughput and error ' +
      `rate. Sorted slowest first by default. Scope: event:read, event:write or event:admin. ${UNTRUSTED_NOTE}`,
    parameters: listTransactionGroupsArgs,
    annotations: { title: 'List transaction groups', ...READ_ONLY },
  })
  async listTransactionGroups(
    @Payload() args: z.infer<typeof listTransactionGroupsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const sort = TRANSACTION_GROUP_SORT[args.sort][args.order];
    const page = await glitchtip.client.page(
      { name: 'list transaction groups', scopes: PERFORMANCE_READ_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/transaction-groups/', {
          params: {
            path: { organization_slug: org },
            query: {
              start: args.start,
              end: args.end,
              sort,
              project: args.project_ids,
              query: args.query,
              limit: args.limit,
              cursor: args.cursor,
            },
          },
        }),
    );
    return this.output.render(args.format, transactionGroupListView(page, org));
  }

  @Tool({
    name: 'get_transaction_group',
    description:
      'Get one transaction group in full: duration, throughput, error rate and error count, ' +
      `first and last seen. Scope: event:read, event:write or event:admin. ${UNTRUSTED_NOTE}`,
    parameters: getTransactionGroupArgs,
    annotations: { title: 'Get transaction group', ...READ_ONLY },
  })
  async getTransactionGroup(
    @Payload() args: z.infer<typeof getTransactionGroupArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const group = await callForTransactionGroup(
      glitchtip.client.call(
        {
          name: 'get transaction group',
          scopes: PERFORMANCE_READ_SCOPES,
          resource: 'Transaction group',
          id: args.transaction_group_id,
          org,
        },
        (api) =>
          api.GET('/api/0/organizations/{organization_slug}/transaction-groups/{id}/', {
            params: { path: { organization_slug: org, id: args.transaction_group_id } },
          }),
      ),
      org,
      args.transaction_group_id,
    );
    return this.output.render(
      args.format,
      transactionGroupDetailView(group, args.transaction_group_id),
    );
  }

  @Tool({
    name: 'list_transaction_spans',
    description:
      'Span groups inside one transaction group: which operations take the time. ' +
      `Scope: event:read, event:write or event:admin. ${UNTRUSTED_NOTE}`,
    parameters: listTransactionSpansArgs,
    annotations: { title: 'List transaction spans', ...READ_ONLY },
  })
  async listTransactionSpans(
    @Payload() args: z.infer<typeof listTransactionSpansArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const spans = await glitchtip.client.call(
      { name: 'list transaction spans', scopes: PERFORMANCE_READ_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/transaction-groups/{id}/spans/', {
          params: {
            path: { organization_slug: org, id: args.transaction_group_id },
            query: { start: args.start, end: args.end },
          },
        }),
    );
    if (Array.isArray(spans) && spans.length === 0) {
      await this.ensureTransactionGroupExists(glitchtip, org, args);
    }
    return this.output.render(
      args.format,
      spanGroupListView(spans, rangeLabel(args.start, args.end)),
    );
  }

  @Tool({
    name: 'list_span_groups',
    description:
      'Organization-wide span groups by total time — where time goes across all transactions. ' +
      `Scope: event:read, event:write or event:admin. ${UNTRUSTED_NOTE}`,
    parameters: listSpanGroupsArgs,
    annotations: { title: 'List span groups', ...READ_ONLY },
  })
  async listSpanGroups(
    @Payload() args: z.infer<typeof listSpanGroupsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const sort = SPAN_GROUP_SORT[args.sort][args.order];
    const spans = await glitchtip.client.call(
      { name: 'list span groups', scopes: PERFORMANCE_READ_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/span-groups/', {
          params: {
            path: { organization_slug: org },
            query: {
              start: args.start,
              end: args.end,
              project: args.project_ids,
              op: args.op,
              sort,
              limit: args.limit,
            },
          },
        }),
    );
    return this.output.render(
      args.format,
      spanGroupListView(spans, rangeLabel(args.start, args.end)),
    );
  }

  @Tool({
    name: 'list_n_plus_one_patterns',
    description:
      'Find N+1 query patterns: spans repeated many times inside the same transaction. ' +
      `Scope: event:read, event:write or event:admin. ${UNTRUSTED_NOTE}`,
    parameters: listNPlusOnePatternsArgs,
    annotations: { title: 'List N+1 patterns', ...READ_ONLY },
  })
  async listNPlusOnePatterns(
    @Payload() args: z.infer<typeof listNPlusOnePatternsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const patterns = await glitchtip.client.call(
      { name: 'list n+1 patterns', scopes: PERFORMANCE_READ_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/n-plus-one/', {
          params: {
            path: { organization_slug: org },
            query: {
              start: args.start,
              end: args.end,
              project: args.project_ids,
              op: args.op,
              threshold: args.threshold,
              limit: args.limit,
            },
          },
        }),
    );
    return this.output.render(
      args.format,
      nPlusOneListView(patterns, rangeLabel(args.start, args.end)),
    );
  }

  @Tool({
    name: 'get_transaction_trend',
    description:
      'Daily count and average duration of one transaction group. ' +
      `Scope: event:read, event:write or event:admin. ${UNTRUSTED_NOTE}`,
    parameters: getTransactionTrendArgs,
    annotations: { title: 'Get transaction trend', ...READ_ONLY },
  })
  async getTransactionTrend(
    @Payload() args: z.infer<typeof getTransactionTrendArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const trend = await glitchtip.client.call(
      { name: 'get transaction trend', scopes: PERFORMANCE_READ_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/transaction-groups/{id}/trend/', {
          params: {
            path: { organization_slug: org, id: args.transaction_group_id },
            query: { start: args.start, end: args.end },
          },
        }),
    );
    if (Array.isArray(trend) && trend.length === 0) {
      await this.ensureTransactionGroupExists(glitchtip, org, args);
    }
    return this.output.render(
      args.format,
      transactionTrendView(trend, rangeLabel(args.start, args.end)),
    );
  }

  /** Upstream returns `[]`, not 404, for an unknown transaction group id (spec §Tools). */
  private async ensureTransactionGroupExists(
    glitchtip: GlitchTipConnection,
    org: string,
    args: { readonly transaction_group_id: number },
  ): Promise<void> {
    await callForTransactionGroup(
      glitchtip.client.call(
        {
          name: 'get transaction group',
          scopes: PERFORMANCE_READ_SCOPES,
          resource: 'Transaction group',
          id: args.transaction_group_id,
          org,
        },
        (api) =>
          api.GET('/api/0/organizations/{organization_slug}/transaction-groups/{id}/', {
            params: { path: { organization_slug: org, id: args.transaction_group_id } },
          }),
      ),
      org,
      args.transaction_group_id,
    );
  }
}
