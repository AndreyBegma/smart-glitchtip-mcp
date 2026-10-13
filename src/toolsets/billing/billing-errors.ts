import { GlitchTipError } from '../../glitchtip/glitchtip.errors';

/**
 * No billing route carries `@has_permission` (spec "Scopes"); GlitchTip's own
 * 404 covers both "no such organization" and "not the right role", which
 * reads like "not found" on its own. Rewrites a 404 to name both causes,
 * following the same catch-and-rewrap idiom as `monitor-errors.ts`.
 * Every other error (including 403, which billing never sends for scope
 * reasons) passes through unchanged, already redacted by `GlitchTipClient`.
 */
async function remap404<T>(call: Promise<T>, org: string, who: 'owner' | 'member'): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError(
        'not_found',
        `Organization ${org} was not found, or the token's user is not its ${who}. ` +
          'GlitchTip answers 404 for both.',
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}

/** For an owner-only mutation: 404 also means "not the owner". */
export function asOwnerCall<T>(call: Promise<T>, org: string): Promise<T> {
  return remap404(call, org, 'owner');
}

/** For a member-readable route: 404 also means "not a member". */
export function asMemberCall<T>(call: Promise<T>, org: string): Promise<T> {
  return remap404(call, org, 'member');
}
