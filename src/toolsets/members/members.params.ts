import { z } from 'zod';

// Argument schemas shared across the members toolset's tools and mutations.

/** GlitchTip's SlugStr: `^[-a-zA-Z0-9_]+$`, max 50 [Confirmed: TeamIn/SlugStr]. */
const TEAM_SLUG = /^[-a-zA-Z0-9_]+$/;

const teamSlugParam = z.string().regex(TEAM_SLUG, 'must be a team slug').max(50);

export const memberIdParam = z
  .number()
  .int()
  .positive()
  .describe('Member id (from list_members); not a user id.');

export const teamFilterParam = teamSlugParam
  .optional()
  .describe("Team slug: list that team's members instead of the whole organization.");

export const memberRoleParam = z
  .enum(['member', 'admin', 'manager', 'owner'])
  .describe('Organization role.');

export const inviteTeamsParam = z
  .array(teamSlugParam)
  .min(1)
  .max(20)
  .optional()
  .refine(
    (teams) =>
      teams === undefined || new Set(teams.map((slug) => slug.toLowerCase())).size === teams.length,
    // GlitchTip slugs are lowercase, so "Core" and "core" name the same team.
    { message: 'teams must not contain duplicate slugs.' },
  )
  .describe(
    'Team slugs to add the invitee to (1–20). Unknown slugs are dropped by GlitchTip ' +
      'without error; the result reports what was requested, not what was applied.',
  );
