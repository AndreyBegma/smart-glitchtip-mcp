import { GlitchTipError } from '../../glitchtip/glitchtip.errors';

/**
 * Rewrites a 404 on a transaction-group-scoped call into a message naming the group and the
 * organization (spec §Errors). Every other error passes through unchanged. Mirrors
 * `../issues/issue-not-found.ts`.
 */
export async function callForTransactionGroup<T>(
  call: Promise<T>,
  org: string,
  transactionGroupId: number,
): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError(
        'not_found',
        `Transaction group ${transactionGroupId} was not found in ${org}.`,
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}
