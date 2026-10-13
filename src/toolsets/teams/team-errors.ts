import { GlitchTipError } from '../../glitchtip/glitchtip.errors';

/**
 * Rewrites a 404 into a custom message (spec §Errors: "beyond the
 * foundation's mapping"). Every other error passes through unchanged.
 */
async function rewriteNotFound<T>(call: Promise<T>, message: string): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError('not_found', message, err.status, err.detail);
    }
    throw err;
  }
}

/**
 * Rewrites a 500 into a custom message. `unique_together = (slug,
 * organization)` has no IntegrityError handler [Confirmed:
 * apps/teams/models.py; none in glitchtip/api/], so a duplicate slug surfaces
 * as a bare 500.
 */
async function rewriteDuplicateSlug<T>(call: Promise<T>, org: string, slug: string): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.status === 500) {
      throw new GlitchTipError(
        'upstream',
        `GlitchTip returned 500; a team with slug ${slug} may already exist in ${org} — check with get_team.`,
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}

/**
 * create_team's 404 means the caller's organization role is below admin
 * [Confirmed: role__gte=ADMIN filters the organization queryset before the
 * team is created, so a below-admin caller sees the organization itself as
 * not found], never a missing team (there is none yet). Its 500 means a
 * duplicate slug.
 */
export function callForCreateTeam<T>(call: Promise<T>, org: string, slug: string): Promise<T> {
  return rewriteDuplicateSlug(
    rewriteNotFound(
      call,
      `Could not create team ${slug} in ${org}: organization not found, or your organization role is below admin.`,
    ),
    org,
    slug,
  );
}

/** rename_team's 500 means a duplicate slug (see rewriteDuplicateSlug). */
export function callForRenameTeam<T>(call: Promise<T>, org: string, slug: string): Promise<T> {
  return rewriteDuplicateSlug(call, org, slug);
}

/**
 * delete_team's 404 means the team was not found, or the caller's
 * organization role is below admin [Confirmed: role__gte=ADMIN filters the
 * same way create_team does].
 */
export function callForDeleteTeam<T>(call: Promise<T>, org: string, team: string): Promise<T> {
  return rewriteNotFound(
    call,
    `Team ${team} was not found in ${org}, or your organization role is below admin.`,
  );
}

/**
 * Appends GlitchTip's role rule to a 403 (spec §Errors: "for the team
 * membership tools it adds GlitchTip's role rule in one sentence").
 */
async function rewriteMembershipForbidden<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'forbidden') {
      throw new GlitchTipError(
        'forbidden',
        `${err.message} GlitchTip's rule: self-join is allowed with open membership; otherwise ` +
          'your organization role must be manager or higher (admin if you are already a member ' +
          'of the team).',
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}

/**
 * add_member_to_team / remove_member_from_team's 404 could name either the
 * member or the team not found; the route looks both up before dispatching
 * to the handler, and GlitchTip's response does not say which. Their 403
 * gets GlitchTip's role rule appended.
 */
export function callForTeamMembership<T>(
  call: Promise<T>,
  org: string,
  member: number | 'me',
  team: string,
): Promise<T> {
  return rewriteMembershipForbidden(
    rewriteNotFound(
      call,
      `Member ${member} or team ${team} was not found in ${org}. Member ids come from list_members.`,
    ),
  );
}
