import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ToolOutput } from '../../format/tool-output';
import { GlitchTipError } from '../../glitchtip/glitchtip.errors';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, organizationParam, READ_ONLY } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { organizationStatsView } from './stats.format';
import { bucketParam, categoryParam, MAX_RANGE_DAYS, projectIdsParam } from './stats.params';
import { checkTimeRange, dateTimeParam } from './time-range';

/** Scope GlitchTip accepts for this route (`@has_permission`, v6.2.6) — org-level, not event. */
export const STATS_READ_SCOPES = ['org:read', 'org:write', 'org:admin'] as const;

const getOrganizationStatsArgs = z
  .object({
    organization: organizationParam,
    category: categoryParam,
    start: dateTimeParam('start'),
    end: dateTimeParam('end'),
    project_ids: projectIdsParam,
    bucket: bucketParam,
    format: formatParam,
  })
  .superRefine((data, ctx) => {
    checkTimeRange(data, ctx);
    const days = (Date.parse(data.end) - Date.parse(data.start)) / 86_400_000;
    if (days > MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: `end - start must not exceed ${MAX_RANGE_DAYS} days.`,
      });
    }
  });

/** The typed client has no schema for this response (spec: "reverse engineered endpoint"). */
interface RawStatsResult {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly response: Response;
}

@GlitchTipTools()
export class StatsTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'get_organization_stats',
    description:
      'Number of error events or transactions an organization received over time, per hour ' +
      'or per day. Scope: org:read, org:write or org:admin.',
    parameters: getOrganizationStatsArgs,
    annotations: { title: 'Get organization stats', ...READ_ONLY },
  })
  async getOrganizationStats(
    @Payload() args: z.infer<typeof getOrganizationStatsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const bucket = args.bucket ?? defaultBucket(args.start, args.end);
    const raw = await callForStats(
      glitchtip.client.call<unknown>(
        { name: 'get organization stats', scopes: STATS_READ_SCOPES, org },
        async (api) => {
          const result = await api.GET('/api/0/organizations/{organization_slug}/stats_v2/', {
            params: {
              path: { organization_slug: org },
              query: {
                category: args.category,
                interval: '1h',
                field: 'sum(quantity)',
                project: args.project_ids,
                start: args.start,
                end: args.end,
              },
            },
          });
          return result as unknown as RawStatsResult;
        },
      ),
      org,
    );
    return this.output.render(
      args.format,
      organizationStatsView(raw, {
        category: args.category,
        start: args.start,
        end: args.end,
        bucket,
        projectIds: args.project_ids,
      }),
    );
  }
}

function defaultBucket(start: string, end: string): 'hour' | 'day' {
  const hours = (Date.parse(end) - Date.parse(start)) / 3_600_000;
  return hours <= 48 ? 'hour' : 'day';
}

/**
 * Rewrites a 404 into the enhanced message (spec §Errors): GlitchTip 404s `stats_v2` when the
 * resolved project list is empty, which can mean the organization doesn't exist for this
 * token, has no projects, or none of `project_ids` belongs to it.
 */
async function callForStats<T>(call: Promise<T>, org: string): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError(
        'not_found',
        `No projects matched in ${org}: the organization does not exist for this token, has no ` +
          'projects, or none of `project_ids` belongs to it.',
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}
