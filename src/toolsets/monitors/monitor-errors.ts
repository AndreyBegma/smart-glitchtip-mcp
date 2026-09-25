import { GlitchTipError } from '../../glitchtip/glitchtip.errors';

export const UPTIME_DISABLED_HINT =
  'If no monitor path works at all, uptime monitoring may be disabled on this instance ' +
  '(GLITCHTIP_ENABLE_UPTIME).';

/**
 * Rewrites a 404 on an uptime call (spec §Errors: "404 on any uptime path").
 * A call scoped to one monitor names it; a call with no monitor id yet
 * (`list_monitors`, `create_monitor`) gives only the instance-disabled hint.
 *
 * `secrets`: values `update_monitor` already knows are sensitive (the
 * current monitor's heartbeat endpoint id/url, read before the failing
 * call) — scrubbed from any other error's message/detail before it reaches
 * the agent, the same way `ResolvedInstance.redact` scrubs the token. No
 * per-call secrets hook exists on `GlitchTipClient` yet (BUG-20260925-017),
 * so this toolset does its own scrubbing here rather than wait for one.
 */
export async function callForMonitor<T>(
  call: Promise<T>,
  org: string,
  monitorId?: number,
  secrets: readonly string[] = [],
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
    throw redacted(err, secrets);
  }
}

function redacted(err: unknown, secrets: readonly string[]): unknown {
  const present = secrets.filter((s): s is string => Boolean(s));
  if (!(err instanceof GlitchTipError) || present.length === 0) return err;
  const scrub = (text: string) => present.reduce((t, s) => t.split(s).join('[redacted]'), text);
  const message = scrub(err.message);
  const detail = err.detail === undefined ? undefined : scrub(err.detail);
  if (message === err.message && detail === err.detail) return err;
  return new GlitchTipError(err.kind, message, err.status, detail);
}
