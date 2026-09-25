import { GlitchTipError } from '../../glitchtip/glitchtip.errors';

/**
 * Rewrites a 404 on an issue-scoped call into a message naming the issue and
 * the organization (spec §Errors: "beyond the foundation's mapping"). Every
 * other error passes through unchanged.
 */
export async function callForIssue<T>(call: Promise<T>, org: string, issueId: number): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError(
        'not_found',
        `Issue ${issueId} was not found in ${org} (it may be in another organization, or deleted).`,
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}
