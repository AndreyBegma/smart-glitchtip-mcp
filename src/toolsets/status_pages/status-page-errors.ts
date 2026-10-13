import { GlitchTipError } from '../../glitchtip/glitchtip.errors';

/**
 * Rewrites a 404 on an uptime call into the instance-disabled hint (spec
 * §Errors: "On list_monitors and list_status_pages, 404 means only the
 * second sentence"). Every other error passes through unchanged.
 */
export async function callForStatusPages<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError(
        'not_found',
        'If no monitor path works at all, uptime monitoring may be disabled on this instance ' +
          '(GLITCHTIP_ENABLE_UPTIME).',
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}
