import { z } from 'zod';
import { parseDsn } from './ingest.dsn';

// Argument schemas shared across the ingest toolset's two tools. `organization`
// and `project` reuse the shared slug params (D-11); nothing here needs
// `pathSegmentParam` — `projectID` and the key come from the API response and
// are validated as a positive integer and a uuid, never from caller input.

const SLUG = /^[A-Za-z0-9_-]+$/;

export const projectParam = z
  .string()
  .regex(SLUG, 'must be a project slug')
  .describe('Project slug.');

export const keyIdParam = z.uuid().describe("A client key's id, from `list_project_keys`.");

export const dsnParam = z
  .string()
  .max(500)
  .refine(
    (value) => parseDsn(value) !== undefined,
    'must be a DSN of the form scheme://public[:secret]@host[/prefix]/projectID',
  )
  .describe(
    'A full DSN, as an SDK would be configured with. Its secret, if any, is discarded — never ' +
      'echoed back.',
  );

export const messageParam = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .default('smart-glitchtip-mcp test event')
  .describe("The test event's message.");

export const levelParam = z
  .enum(['debug', 'info', 'warning', 'error', 'fatal'])
  .default('info')
  .describe("The test event's level.");

export const environmentParam = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .optional()
  .describe("The test event's environment tag.");

export const releaseParam = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe("The test event's release version.");

export const waitSecondsParam = z
  .number()
  .int()
  .min(0)
  .max(30)
  .default(0)
  .describe(
    'Poll GlitchTip every 2s for up to this many seconds to check the event became visible. ' +
      '0 (default): send and report acceptance only.',
  );
