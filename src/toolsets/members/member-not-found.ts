import { GlitchTipError } from '../../glitchtip/glitchtip.errors';

/**
 * Rewrites a 404 on a member-scoped call into a message naming the member id
 * and the organization, and pointing at where a valid id comes from (spec
 * §Errors: "beyond the foundation's mapping"). Every other error passes
 * through unchanged.
 */
export async function callForMember<T>(
  call: Promise<T>,
  org: string,
  memberId: number,
): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError(
        'not_found',
        `Member ${memberId} was not found in ${org}. Member ids come from list_members; they are not user ids.`,
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}
