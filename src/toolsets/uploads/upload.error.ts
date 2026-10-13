import { AgentFacingError } from '../../agent-facing.error';

/**
 * An upload refused or failed for a reason this server detected itself: a
 * path rule, a preflight check, an unsupported instance setting or a chunk
 * that did not go through. The message names the rule and, for a path, the
 * path as the caller gave it — never a resolved absolute path.
 */
export class UploadError extends AgentFacingError {}
