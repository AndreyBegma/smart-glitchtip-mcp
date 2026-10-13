import { z } from 'zod';

// Argument schemas shared across the projects toolset's tools and mutations.

const SLUG = /^[A-Za-z0-9_-]+$/;

export const projectParam = z
  .string()
  .regex(SLUG, 'must be a project slug')
  .describe('Project slug.');

export const teamParam = z.string().regex(SLUG, 'must be a team slug').describe('Team slug.');

export const keyIdParam = z.uuid().describe('Client key id (uuid).');

export const environmentNameParam = z.string().trim().min(1).describe('Environment name.');

export const rateLimitParam = z
  .object({
    window: z.number().int().positive().describe('Window length, in seconds.'),
    count: z.number().int().positive().describe('Events allowed within the window.'),
  })
  .describe('Rate limit for this key.');
