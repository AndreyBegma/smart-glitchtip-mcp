// Routes the escape hatch never calls, whatever the method or the write flag
// (FEAT-20260925-015 "Denylist", D-21, D-23). Adding an entry is a normal PR;
// removing one needs a decision.

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface DenyRule {
  /** Segments below /api/0/, lower case; `*` matches exactly one segment. */
  readonly pattern: string;
  /** Also every path below the pattern. */
  readonly below?: boolean;
  /** Only these methods are denied; every method when absent. */
  readonly methods?: readonly ApiMethod[];
  readonly reason: string;
}

const WRITES: readonly ApiMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

export const DENYLIST: readonly DenyRule[] = [
  {
    pattern: 'generate-recovery-codes',
    reason: 'GET mints fresh MFA recovery codes and returns them; the codes are account secrets.',
  },
  {
    pattern: 'wizard',
    below: true,
    reason: 'the setup-wizard flow hands out a stored API token, unauthenticated.',
  },
  {
    pattern: 'wizard-set-token',
    reason: 'it creates or returns an API token for the user.',
  },
  {
    pattern: 'api-tokens',
    below: true,
    reason:
      'API-token management is session-authenticated only, and its responses carry token values.',
  },
  {
    pattern: 'accept',
    below: true,
    reason:
      "it accepts an organization invitation as the token's user, with the invite secret in the path.",
  },
  {
    pattern: 'stripe/organizations/*/create-stripe-subscription-checkout',
    reason:
      'it creates an account-bearing Stripe session link; use the billing toolset, which carries the warnings.',
  },
  {
    pattern: 'stripe/organizations/*/create-billing-portal',
    reason:
      'it creates an account-bearing Stripe session link; use the billing toolset, which carries the warnings.',
  },
  {
    pattern: 'import',
    reason:
      'it makes the instance fetch an arbitrary external URL with a caller-supplied token (server-side request forgery by proxy).',
  },
  {
    pattern: 'users/*',
    methods: ['DELETE'],
    reason: "it deletes the token's own user account, irreversibly; do it in the GlitchTip UI.",
  },
  {
    pattern: 'users/*/emails',
    methods: WRITES,
    reason:
      'changing e-mail addresses is an account-takeover path (password resets go to the primary address); GET stays allowed.',
  },
  {
    pattern: 'users/*/emails/confirm',
    methods: WRITES,
    reason:
      'changing e-mail addresses is an account-takeover path (password resets go to the primary address).',
  },
  {
    pattern: 'organizations/*/social-apps',
    methods: ['POST', 'PUT', 'PATCH'],
    reason:
      'an SSO app carries an IdP client secret through the model and auto-joins users to the organization.',
  },
  {
    pattern: 'organizations/*/social-apps/*',
    methods: ['POST', 'PUT', 'PATCH'],
    reason:
      'an SSO app carries an IdP client secret through the model and auto-joins users to the organization.',
  },
];

// The ingest routes (/api/{project_id}/store/, /security/, /envelope/,
// /api/embed/*) are outside /api/0/ and so unreachable by the path rules; they
// are named here so that a relaxation of the prefix rule keeps them out.

/** Why `method` on these segments is denied, or undefined when it is allowed. */
export function deniedReason(method: ApiMethod, segments: readonly string[]): string | undefined {
  const lower = segments.map((segment) => segment.toLowerCase());
  return DENYLIST.find((rule) => matches(rule, method, lower))?.reason;
}

function matches(rule: DenyRule, method: ApiMethod, segments: readonly string[]): boolean {
  if (rule.methods && !rule.methods.includes(method)) return false;
  const pattern = rule.pattern.split('/');
  if (segments.length < pattern.length) return false;
  if (!rule.below && segments.length !== pattern.length) return false;
  return pattern.every((part, i) => part === '*' || part === segments[i]);
}
