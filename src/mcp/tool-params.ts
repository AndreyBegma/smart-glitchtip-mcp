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

/**
 * Free-form input a tool puts into a URL path (a release version, a name):
 * exactly one path segment. Refuses `.`, `..` and all-dot values, which URL
 * normalisation would collapse into another route, and `/`, `\`, `%` and
 * control characters. Slug inputs keep the slug regex, which already
 * excludes all of these. Every toolset refuses such values the same way.
 */
export function pathSegmentParam(label: string, maxLength: number) {
  return z
    .string()
    .min(1, `${label} must not be empty`)
    .max(maxLength, `${label} must be at most ${maxLength} characters`)
    .refine((value) => !/^\.+$/.test(value), `${label} must not be "." or ".." or only dots`)
    .refine(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses.
      (value) => !/[/\\%\u0000-\u001f\u007f]/.test(value),
      `${label} must not contain /, \\, % or control characters`,
    );
}

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
