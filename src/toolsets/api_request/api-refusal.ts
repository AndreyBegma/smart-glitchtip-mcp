import { AgentFacingError } from '../../agent-facing.error';

/**
 * An escape-hatch call refused before any request: a path, query, body or
 * `confirm` that breaks a rule of FEAT-20260925-015. The message names the
 * rule, and never repeats the request body.
 */
export class ApiRequestRefusal extends AgentFacingError {}
