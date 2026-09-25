import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ToolOutput } from '../../format/tool-output';
import { GlitchTipError } from '../../glitchtip/glitchtip.errors';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { cursorParam, formatParam, organizationParam, READ_ONLY } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { getLogStatsView, getLogView, listLogResourcesView, listLogsView } from './logs.format';
import {
  levelsParam,
  logIdParam,
  projectIdsParam,
  traceIdParam,
  UNTRUSTED_NOTE,
} from './logs.params';
import { checkTimeRange, dateTimeParam } from './time-range';

/** Scopes GlitchTip accepts for every route in this toolset (`@has_permission`, v6.2.6). */
export const LOGS_READ_SCOPES = ['event:read', 'event:write', 'event:admin'] as const;

const DEFAULT_LOOKBACK_MS = 7 * 86_400_000;
const MAX_LOG_STATS_RANGE_DAYS = 90;

/** Upstream default (last 7 days) mirrored locally so an empty message can name a range. */
function effectiveRange(
  start: string | undefined,
  end: string | undefined,
): { start: string; end: string } {
  const endIso = end ?? new Date().toISOString();
  const startIso = start ?? new Date(Date.parse(endIso) - DEFAULT_LOOKBACK_MS).toISOString();
  return { start: startIso, end: endIso };
}

const exactMatchParam = (label: string) =>
  z.string().min(1).optional().describe(`Exact ${label} name match.`);

const listLogsArgs = z
  .object({
    organization: organizationParam,
    query: z.string().optional().describe('Full-text search in the log body.'),
    level: levelsParam,
    project_ids: projectIdsParam,
    service: exactMatchParam('service'),
    environment: exactMatchParam('environment'),
    host: exactMatchParam('host'),
    trace_id: traceIdParam,
    start: dateTimeParam('start').optional(),
    end: dateTimeParam('end').optional(),
    limit: z.number().int().min(1).max(200).default(50).describe('Page size, 1–200 (default 50).'),
    cursor: cursorParam,
    format: formatParam,
  })
  .superRefine(checkTimeRange);

const getLogArgs = z.object({
  organization: organizationParam,
  log_id: logIdParam,
  format: formatParam,
});

const getLogStatsArgs = z
  .object({
    organization: organizationParam,
    project_ids: projectIdsParam,
    level: levelsParam,
    service: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('Service names (hash-bucket filter upstream).'),
    environment: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('Environment names (hash-bucket filter upstream).'),
    start: dateTimeParam('start').optional(),
    end: dateTimeParam('end').optional(),
    format: formatParam,
  })
  .superRefine((data, ctx) => {
    checkTimeRange(data, ctx);
    if (data.start === undefined || data.end === undefined) return;
    const days = (Date.parse(data.end) - Date.parse(data.start)) / 86_400_000;
    if (days > MAX_LOG_STATS_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: `end - start must not exceed ${MAX_LOG_STATS_RANGE_DAYS} days.`,
      });
    }
  });

const listLogResourcesArgs = z.object({
  organization: organizationParam,
  type: z
    .enum(['service', 'environment', 'host'])
    .optional()
    .describe('Restrict to this resource type.'),
  format: formatParam,
});

@GlitchTipTools()
export class LogsTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'list_logs',
    description:
      'Search application logs, newest first. Filters combine. ' +
      `Scope: event:read, event:write or event:admin. ${UNTRUSTED_NOTE}`,
    parameters: listLogsArgs,
    annotations: { title: 'List logs', ...READ_ONLY },
  })
  async listLogs(
    @Payload() args: z.infer<typeof listLogsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      { name: 'list logs', scopes: LOGS_READ_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/logs/', {
          params: {
            path: { organization_slug: org },
            query: {
              project: args.project_ids,
              level: args.level,
              service: args.service,
              environment: args.environment,
              host: args.host,
              traceId: args.trace_id,
              query: args.query,
              start: args.start,
              end: args.end,
              limit: args.limit,
              cursor: args.cursor,
            },
          },
        }),
    );
    return this.output.render(
      args.format,
      listLogsView(page, org, effectiveRange(args.start, args.end)),
    );
  }

  @Tool({
    name: 'get_log',
    description:
      'Get one log event in full: body, resource fields, trace/span ids, and its attributes ' +
      `(redacted for PII). Scope: event:read, event:write or event:admin. ${UNTRUSTED_NOTE}`,
    parameters: getLogArgs,
    annotations: { title: 'Get log', ...READ_ONLY },
  })
  async getLog(
    @Payload() args: z.infer<typeof getLogArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const log = await callForLog(
      glitchtip.client.call(
        { name: 'get log', scopes: LOGS_READ_SCOPES, resource: 'Log', id: args.log_id, org },
        (api) =>
          api.GET('/api/0/organizations/{organization_slug}/logs/{log_id}/', {
            params: { path: { organization_slug: org, log_id: args.log_id } },
          }),
      ),
      org,
      args.log_id,
    );
    return this.output.render(args.format, getLogView(log));
  }

  @Tool({
    name: 'get_log_stats',
    description: 'Log volume per level over time. Scope: event:read, event:write or event:admin.',
    parameters: getLogStatsArgs,
    annotations: { title: 'Get log stats', ...READ_ONLY },
  })
  async getLogStats(
    @Payload() args: z.infer<typeof getLogStatsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const range = effectiveRange(args.start, args.end);
    const stats = await glitchtip.client.call(
      { name: 'get log stats', scopes: LOGS_READ_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/logs/stats/', {
          params: {
            path: { organization_slug: org },
            query: {
              project: args.project_ids,
              level: args.level,
              service: args.service,
              environment: args.environment,
              start: args.start,
              end: args.end,
            },
          },
        }),
    );
    const hours = (Date.parse(range.end) - Date.parse(range.start)) / 3_600_000;
    const bucketing = hours <= 48 ? 'hour' : 'day';
    return this.output.render(
      args.format,
      getLogStatsView(stats, range, bucketing, {
        service: args.service,
        environment: args.environment,
      }),
    );
  }

  @Tool({
    name: 'list_log_resources',
    description:
      'Known service, environment and host names that have sent logs — use them as ' +
      `list_logs filters. Scope: event:read, event:write or event:admin. ${UNTRUSTED_NOTE}`,
    parameters: listLogResourcesArgs,
    annotations: { title: 'List log resources', ...READ_ONLY },
  })
  async listLogResources(
    @Payload() args: z.infer<typeof listLogResourcesArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const resources = await glitchtip.client.call(
      { name: 'list log resources', scopes: LOGS_READ_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/logs/resources/', {
          params: {
            path: { organization_slug: org },
            query: { resource_type: args.type },
          },
        }),
    );
    return this.output.render(args.format, listLogResourcesView(resources, org, args.type));
  }
}

/**
 * Rewrites a 404 on `get_log` into the enhanced message (spec §Errors): it may be older than
 * `GLITCHTIP_LOG_HOT_DAYS` keeps in hot storage, gone from cold storage too, or in another
 * organization. Every other error passes through unchanged.
 */
async function callForLog<T>(call: Promise<T>, org: string, logId: string): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError(
        'not_found',
        `Log ${logId} was not found in ${org} (it may be older than the instance keeps, or in another organization).`,
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}
