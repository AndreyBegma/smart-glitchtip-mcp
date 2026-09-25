import { z } from 'zod';

// Argument schemas for get_organization_stats (spec §Tools). `organization` and `format`
// come from ../../mcp/tool-params; `start`/`end` from ./time-range (both required here,
// unlike performance/logs).

export const MAX_RANGE_DAYS = 41;

export const categoryParam = z
  .enum(['error', 'transaction'])
  .describe('Event category to count: error events or transactions.');

export const bucketParam = z
  .enum(['hour', 'day'])
  .optional()
  .describe('Rollup granularity. Default: hour for a range of 48h or less, otherwise day.');

/**
 * project_ids never contains -1 (Sentry's "all"): `.positive()` already excludes it, since
 * here it matches nothing (spec §Errors).
 */
export const projectIdsParam = z
  .array(z.number().int().positive())
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, 'project_ids must not contain duplicates.')
  .optional()
  .describe('Numeric project ids (see list_projects / get_project). 1–50 entries, no duplicates.');
