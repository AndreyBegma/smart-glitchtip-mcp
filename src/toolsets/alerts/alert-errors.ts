import { AgentFacingError } from '../../agent-facing.error';
import { GlitchTipError } from '../../glitchtip/glitchtip.errors';
import { type Secrets, scrub } from './alerts.secrets';

/** A refusal this toolset decides itself, before the request that would do harm. */
export class AlertRefusal extends AgentFacingError {}

export function alertNotFoundMessage(alertId: number, project: string): string {
  return `Alert ${alertId} was not found in ${project}.`;
}

const PRIVATE_ADDRESS = /private|internal|reserved|public/i;
const PRIVATE_ADDRESS_HINT =
  'GlitchTip refuses recipient URLs that resolve to private addresses unless the instance allows it.';

/**
 * Every GlitchTip call of this toolset that can quote a recipient goes
 * through here (spec "Secret scrubbing", "Errors"):
 *
 * - the error's message and detail are scrubbed of `secrets` before they
 *   reach the agent — GlitchTip's 422 detail can quote a rejected URL;
 * - a 404 becomes `notFound`, when given;
 * - a 422 whose (scrubbed) detail speaks of private or public addresses
 *   gets the hint about GlitchTip's private-address rule.
 */
export async function alertCall<T>(
  call: Promise<T>,
  options: { readonly secrets: Secrets; readonly notFound?: string },
): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (!(err instanceof GlitchTipError)) throw err;
    throw rewrite(err, options);
  }
}

function rewrite(
  err: GlitchTipError,
  { secrets, notFound }: { readonly secrets: Secrets; readonly notFound?: string },
): GlitchTipError {
  const detail = err.detail === undefined ? undefined : scrub(err.detail, secrets);
  if (err.kind === 'not_found' && notFound) {
    return new GlitchTipError('not_found', notFound, err.status, detail);
  }
  let message = scrub(err.message, secrets);
  if (err.status === 422 && detail !== undefined && PRIVATE_ADDRESS.test(detail)) {
    message = `${message} ${PRIVATE_ADDRESS_HINT}`;
  }
  return new GlitchTipError(err.kind, message, err.status, detail);
}
