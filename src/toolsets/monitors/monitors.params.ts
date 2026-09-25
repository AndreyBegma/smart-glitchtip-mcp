import { z } from 'zod';

// Argument schemas shared across the monitors toolset's tools and mutations.

const PROJECT_SLUG = /^[A-Za-z0-9_-]+$/;

export const monitorIdParam = z.number().int().positive().describe('Monitor id.');

export const monitorProjectParam = z
  .string()
  .regex(PROJECT_SLUG, 'must be a project slug')
  .describe('Project slug.');

/** GlitchTip's MonitorType [Confirmed: apps/uptime/schema.py]. */
export const MONITOR_TYPES = ['Ping', 'GET', 'POST', 'TCP Port', 'SSL', 'Heartbeat'] as const;
export const monitorTypeParam = z.enum(MONITOR_TYPES);

export const includeHeartbeatUrlParam = z
  .boolean()
  .default(false)
  .describe(
    'Show the full heartbeat URL and id of a Heartbeat monitor, instead of the masked id. ' +
      'Anyone who has this URL can mark the monitor as up without a token.',
  );
