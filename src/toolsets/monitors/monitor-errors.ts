import { GlitchTipError } from '../../glitchtip/glitchtip.errors';

export const UPTIME_DISABLED_HINT =
  'If no monitor path works at all, uptime monitoring may be disabled on this instance ' +
  '(GLITCHTIP_ENABLE_UPTIME).';

/**
 * Rewrites a 404 on an uptime call (spec §Errors: "404 on any uptime path").
 * A call scoped to one monitor names it; a call with no monitor id yet
 * (`list_monitors`, `create_monitor`) gives only the instance-disabled hint.
 * Every other error passes through unchanged.
 */
export async function callForMonitor<T>(
  call: Promise<T>,
  org: string,
  monitorId?: number,
): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      const message =
        monitorId === undefined
          ? UPTIME_DISABLED_HINT
          : `Monitor ${monitorId} was not found in ${org}. ${UPTIME_DISABLED_HINT}`;
      throw new GlitchTipError('not_found', message, err.status, err.detail);
    }
    throw err;
  }
}
