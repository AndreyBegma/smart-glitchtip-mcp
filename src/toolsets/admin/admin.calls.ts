import type { CallToolResult } from '@modelcontextprotocol/server';
import { AgentFacingError } from '../../agent-facing.error';
import type { OutputFormat, ToolOutput, View } from '../../format/tool-output';
import { GlitchTipError, type Operation } from '../../glitchtip/glitchtip.errors';
import type { GlitchTipConnection } from '../../glitchtip/instance.resolver';
import { REDACTED } from '../../glitchtip/redactor';

// What the admin toolset tells GlitchTip it is doing, and how its failures
// read (spec "Errors"). No `/users/…` route checks a scope [Confirmed:
// apps/users/api.py], so user operations name no scope; the SSO app routes
// need a scope *and* an organization role [Confirmed: social_app_api.py].

const ANY_TOKEN = 'no scope: any valid token';

/** An operation on the token's own user (`/users/me/…`) or the instance license. */
export function userOperation(name: string): Operation {
  return { name, scopes: [], requirement: ANY_TOKEN };
}

export function listSocialAppsOperation(org: string): Operation {
  return {
    name: 'list SSO apps',
    scopes: ['org:read', 'org:write', 'org:admin'],
    requirement: `scope org:read, org:write or org:admin and the manager, admin or owner role in ${org}`,
    resource: 'Organization',
    id: org,
  };
}

export function deleteSocialAppOperation(org: string, socialAppId: number): Operation {
  return {
    name: 'delete SSO app',
    scopes: ['org:write', 'org:admin'],
    requirement: `scope org:write or org:admin and the manager, admin or owner role in ${org}`,
    resource: 'SSO app',
    id: socialAppId,
    org,
  };
}

/** A refusal this toolset decides itself, before the request that would do harm. */
export class AdminRefusal extends AgentFacingError {}

const USER_GONE =
  "GlitchTip answered 404 for the token's own user: the user is inactive or no longer exists. " +
  'Check the account in the GlitchTip UI, or use a token of an active user.';

/**
 * Rewrites a 404 on `/users/me/…` into what it means: token auth requires an
 * active user, so the token's user is inactive or gone [Confirmed:
 * authentication.py]. `notFound` replaces that message where a 404 can also
 * name something else. Every other error passes through unchanged.
 */
export async function callForUser<T>(call: Promise<T>, notFound = USER_GONE): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError('not_found', notFound, err.status, err.detail);
    }
    throw err;
  }
}

export interface AdminRender {
  readonly glitchtip: GlitchTipConnection;
  readonly format: OutputFormat;
  readonly view: View;
  /** The tool name, for the `malformed` message. */
  readonly tool: string;
  /** Secrets besides the token, such as the license key. */
  readonly extraSecrets?: readonly string[];
}

/**
 * The shortest extra secret this toolset scrubs itself. The foundation's
 * redactor skips extras under 8 characters as too common to scrub; a license
 * key is never "common", so forms of 4–7 characters are replaced here too.
 * Shorter than 4 would erase ordinary text and is left alone — a key that
 * short is also caught in its `sub=`-prefixed form, which is 8 or more.
 */
const SHORTEST_LOCAL_SECRET = 4;

/** Every admin result goes out through here: rendered, bounded and scrubbed. */
export function renderRedacted(
  output: ToolOutput,
  { glitchtip, format, view, tool, extraSecrets = [] }: AdminRender,
): CallToolResult {
  const redactor = glitchtip.instance.redactor(extraSecrets);
  const short = extraSecrets.filter((s) => s.length >= SHORTEST_LOCAL_SECRET);
  const scrub = (text: string) => withoutEach(redactor.redact(text), short);
  return output.render(format, redactedView(view, scrub), tool);
}

/**
 * The view with every secret the call knows — the token, and a caller's
 * extras such as the license key — removed from both renderings (rule 1).
 * The allowlists keep secret *fields* out; this keeps a secret GlitchTip
 * echoes inside a rendered field (a name, a URL) out as well.
 */
function redactedView(view: View, scrub: (text: string) => string): View {
  return {
    untrusted: view.untrusted,
    text: () => scrub(view.text()),
    json: () => redactedValue(view.json(), scrub),
  };
}

function redactedValue(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((item) => redactedValue(item, scrub));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactedValue(item, scrub)]),
    );
  }
  return value;
}

/** Longest first, so a secret containing another is replaced whole. */
function withoutEach(text: string, secrets: readonly string[]): string {
  return [...secrets]
    .sort((a, b) => b.length - a.length)
    .reduce((result, secret) => result.split(secret).join(REDACTED), text);
}

/** Confirmation of a write with nothing richer to show (D-12). */
export function resultView(summary: string, data: Record<string, unknown> = {}): View {
  return {
    text: () => summary,
    json: () => ({ result: summary, ...data }),
  };
}
