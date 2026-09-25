import type { GlitchTipConnection } from '../../glitchtip/instance.resolver';
import type { RawQuery } from '../../glitchtip/request-guards';
import { assertInsideApi, normalizeApiPath } from './api-path';
import { type ApiQuery, rawQueryOf } from './api-query';
import { ApiRequestRefusal } from './api-refusal';
import { type ApiResult, readApiResponse } from './api-response';
import { type ApiMethod, deniedReason } from './denylist';

// One escape-hatch call, shared by api_get and api_request: every rule checked
// before the request, the request through `client.raw()` (AGENTS.md rule 13),
// and the answer redacted before it is read.

export const MAX_BODY_CHARACTERS = 100_000;

/** A call every rule has passed; only now may it be sent. */
export interface CheckedCall {
  readonly method: ApiMethod;
  /** `/api/0/<path>/`, normalised. */
  readonly target: string;
  readonly query: RawQuery;
}

export interface CallRequest {
  readonly method: ApiMethod;
  readonly path: string;
  readonly query?: ApiQuery;
  readonly cursor?: string;
}

/** The path rules, the denylist and the query rules; throws `ApiRequestRefusal`. */
export function checkCall(instanceUrl: string, request: CallRequest): CheckedCall {
  const path = normalizeApiPath(request.path);
  const reason = deniedReason(request.method, path.segments);
  if (reason !== undefined) {
    throw new ApiRequestRefusal(
      `\`${path.target}\` is not reachable through api_get/api_request: ${reason}`,
    );
  }
  assertInsideApi(instanceUrl, path.target);
  return {
    method: request.method,
    target: path.target,
    query: rawQueryOf(request.query, request.cursor),
  };
}

/**
 * The JSON text of an agent's body, bounded. The body itself never appears in
 * a result or an error (spec "Redaction" rule 5).
 */
export function serialisedBody(method: ApiMethod, body: unknown): string | undefined {
  if (body === undefined) return undefined;
  if (method === 'DELETE') {
    throw new ApiRequestRefusal(
      'Refused before any request: a DELETE takes no `body`; GlitchTip bulk deletes take ids in `query`.',
    );
  }
  const json = JSON.stringify(body);
  if (json.length > MAX_BODY_CHARACTERS) {
    throw new ApiRequestRefusal(
      `Refused before any request: \`body\` serialises to more than ${MAX_BODY_CHARACTERS} characters.`,
    );
  }
  return json;
}

/** Sends a checked call; GET is retried by the client, a mutation never is (D-13). */
export async function sendCall(
  glitchtip: GlitchTipConnection,
  call: CheckedCall,
  body?: string,
): Promise<ApiResult> {
  const request = `${call.method} ${call.target}`;
  const response = await glitchtip.client.raw(
    { name: request, scopes: [] },
    call.method,
    call.target,
    body === undefined
      ? { query: call.query }
      : { query: call.query, body, headers: { 'content-type': 'application/json' } },
  );
  return readApiResponse(response, call, (extra) => glitchtip.instance.redactor(extra));
}
