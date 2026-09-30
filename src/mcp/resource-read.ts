import type { ReadResourceResult } from '@modelcontextprotocol/server';
import { RpcException } from '@nestjs/microservices';
import { applyBudget } from '../format/budget';
import { flatten } from '../format/sanitize';
import { isShapeError, MalformedViewError } from '../format/tool-output';
import { GlitchTipError } from '../glitchtip/glitchtip.errors';
import {
  type GlitchTipConnection,
  NoDefaultOrganizationError,
} from '../glitchtip/instance.resolver';

// Everything a resource template's handler needs that a tool gets from
// ToolOutput and the tool's own schema (D-26). Resource reads have no
// `isError` result: a failure is a JSON-RPC error, so every error raised here
// is an object RpcException — ToolErrorFilter passes it through unchanged and
// the SDK reads `code` and `message` from it. A string payload would reach the
// client as `-32603 "Internal error"`.

const INVALID_PARAMS = -32602;

const SCHEME = 'glitchtip://';
const URI_ECHO_MAX = 200;

const ISSUE_ID = /^[1-9][0-9]{0,18}$/;
const SLUG = /^[A-Za-z0-9_-]+$/;

/** The payload mcp-nest hands a template handler: path and query values, plus `uri`. */
export type ResourcePayload = Readonly<Record<string, unknown>>;

/**
 * The requested URI, if it is one this server would have written. mcp-nest's
 * matcher ignores the scheme, is case-insensitive and accepts a trailing
 * slash, so `https://issues/42` and `glitchtip://issues/42/` reach the
 * handler; they are refused here, before any request, as if nothing matched.
 */
export function canonicalUri(payload: ResourcePayload): string {
  const uri = payload.uri;
  if (typeof uri !== 'string') throw invalidParams('Unknown resource.');
  const path = uri.split('?', 1)[0];
  if (!uri.startsWith(SCHEME) || path.endsWith('/')) {
    throw invalidParams(`Unknown resource: ${echoUri(uri)}`);
  }
  return uri;
}

/** A path value that must be GlitchTip's numeric issue id (not the shortId). */
export function resourceIssueId(value: unknown): number {
  if (typeof value === 'string' && ISSUE_ID.test(value)) {
    const id = Number(value);
    if (Number.isSafeInteger(id)) return id;
  }
  throw invalidParams('issue_id must be a positive integer (the numeric id, not the shortId).');
}

/** The `?organization=` query value, validated; `undefined` when absent. */
export function resourceOrganization(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && SLUG.test(value)) return value;
  throw invalidParams('organization must be an organization slug.');
}

/**
 * The organization to read from, as tools resolve it (D-11). With no default,
 * the tools' message says "pass `organization`"; a resource has no argument
 * list, so the message says how to pass it in the URI.
 */
export async function resolveResourceOrganization(
  glitchtip: GlitchTipConnection,
  requested: string | undefined,
): Promise<string> {
  try {
    return await glitchtip.organization(requested);
  } catch (error) {
    if (error instanceof NoDefaultOrganizationError) {
      throw invalidParams(`${error.message} For a resource, add ?organization=<slug> to the URI.`);
    }
    throw error;
  }
}

/**
 * A GlitchTip 404 is "this resource does not exist": `-32602` with the URI as
 * data (the MCP revision mcp-nest implements), not the `-32603` every other
 * agent-facing error becomes. `message` replaces the client's wording; without
 * it, the error's own (already rewritten, e.g. by `callForIssue`) is kept.
 */
export async function notFoundAsInvalidParams<T>(
  call: Promise<T>,
  uri: string,
  message?: string,
): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof GlitchTipError && error.kind === 'not_found') {
      throw invalidParams(message ?? error.message, { uri });
    }
    throw error;
  }
}

export interface ReadTextOptions {
  /** MCP_RESPONSE_BUDGET. */
  readonly budget: number;
  /** The equivalent tool and the resource, for the malformed message. */
  readonly operation: string;
  /** The connection this read used; its token is scrubbed from the text. */
  readonly glitchtip: GlitchTipConnection;
}

/**
 * The one text content item a read returns: `render()`'s text with the
 * connection's token removed, then bounded by MCP_RESPONSE_BUDGET (D-12) the
 * way ToolOutput bounds a tool's text, never cut inside an open fence.
 * GlitchTip content is written by whoever holds a DSN and can quote the token
 * back (a title, a message); the client scrubs only error bodies, so the
 * resource scrubs its own (AGENTS.md rule 1). A view that cannot read the
 * response is a `MalformedViewError` naming `operation`, as in
 * ToolOutput.render.
 */
export function readText(
  uri: string,
  render: () => string,
  { budget, operation, glitchtip }: ReadTextOptions,
): ReadResourceResult {
  let text: string;
  try {
    text = applyBudget(glitchtip.instance.redactor().redact(render()), budget);
  } catch (error) {
    if (isShapeError(error)) throw new MalformedViewError(operation, { cause: error });
    throw error;
  }
  return { contents: [{ uri, mimeType: 'text/plain', text }] };
}

/** A `-32602` a client can act on. */
export function invalidParams(message: string, data?: Record<string, unknown>): RpcException {
  return new RpcException(
    data === undefined
      ? { code: INVALID_PARAMS, message }
      : { code: INVALID_PARAMS, message, data },
  );
}

/**
 * The client's own URI, safe to put in a one-line message: control,
 * invisible and bidi characters and line breaks flattened to single spaces,
 * at most 200 characters.
 */
export function echoUri(uri: string): string {
  const flat = flatten(uri);
  return flat.length <= URI_ECHO_MAX ? flat : `${flat.slice(0, URI_ECHO_MAX - 1)}…`;
}
