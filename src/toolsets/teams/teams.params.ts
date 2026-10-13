import { z } from 'zod';

// Argument schemas shared across the teams toolset's tools and mutations.

/** GlitchTip's SlugStr: `^[-a-zA-Z0-9_]+$`, max 50 [Confirmed: TeamIn/SlugStr]. */
const TEAM_SLUG = /^[-a-zA-Z0-9_]+$/;

export const teamParam = z
  .string()
  .regex(TEAM_SLUG, 'must be a team slug')
  .max(50)
  .describe('Team slug.');

export const newTeamSlugParam = teamParam.describe('New team slug.');

/** GlitchTip's MeID [Confirmed: apps/shared/types.py]: a member id, or "me" for the caller. */
export const memberOrMeParam = z
  .union([z.number().int().positive(), z.literal('me')])
  .describe('Member id (positive integer, from list_members) or "me" for yourself.');
