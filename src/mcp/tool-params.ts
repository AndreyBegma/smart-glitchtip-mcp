import type { ToolAnnotations } from '@rekog/mcp-nest';
import { z } from 'zod';

// Argument schemas shared by every toolset, so the same argument reads the
// same way in every tool (D-10: names and schemas are a public contract).

export { formatParam } from '../format/tool-output';

const SLUG = /^[A-Za-z0-9_-]+$/;

export const organizationParam = z
  .string()
  .regex(SLUG, 'must be an organization slug')
  .optional()
  .describe(
    'Organization slug. Optional: defaults to the server or header default, or to the only organization the token can see.',
  );

/** For destructive tools: the target is never defaulted. */
export const requiredOrganizationParam = z
  .string()
  .regex(SLUG, 'must be an organization slug')
  .describe('Organization slug. Required: a destructive call never relies on a default.');

export const limitParam = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(50)
  .describe('Page size, 1–100 (default 50).');

export const cursorParam = z
  .string()
  .optional()
  .describe('Cursor from the previous page ("next cursor: …"); omit for the first page.');

/** MCP annotations (D-06, AGENTS.md rule 3). Every tool reaches an external system. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function mutation(options: { destructive: boolean; idempotent: boolean }): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: options.destructive,
    idempotentHint: options.idempotent,
    openWorldHint: true,
  };
}
