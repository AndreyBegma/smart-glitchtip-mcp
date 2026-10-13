import type { components } from '../../glitchtip/generated/schema';
import type { GlitchTipClient } from '../../glitchtip/glitchtip.client';

type SettingsOut = components['schemas']['SettingsOut'];

const SETTINGS_OPERATION = { name: 'get instance settings', scopes: [] };

/**
 * The per-call billing gate (spec "The billing gate"). Registration cannot
 * depend on Stripe being configured: the instance is resolved per request
 * (D-03), while registration happens once at startup (D-07). So every Stripe
 * tool checks this itself — one cheap, unauthenticated GET, never cached
 * (AGENTS.md rule 2 stays trivially true).
 *
 * `true`/`false` is what GlitchTip answered for `billingEnabled`; `undefined`
 * means the settings call failed, or answered without a boolean
 * `billingEnabled` — callers degrade (proceed, with a note) rather than fail.
 */
export async function fetchBillingEnabled(client: GlitchTipClient): Promise<boolean | undefined> {
  let settings: SettingsOut;
  try {
    settings = await client.call(SETTINGS_OPERATION, (api) => api.GET('/api/settings/'));
  } catch {
    return undefined;
  }
  const enabled = settings.billingEnabled;
  return typeof enabled === 'boolean' ? enabled : undefined;
}

/** Success wording for a read tool when billing is confirmed off (never isError, rule 7). */
export function billingDisabledSentence(origin: string): string {
  return (
    `Billing is not enabled on ${origin}: it runs without Stripe (typical for self-hosted). ` +
    'Event usage is still available through `get_event_usage`.'
  );
}

/** Shown when the gate itself could not be confirmed; the tool proceeds anyway. */
export const BILLING_UNKNOWN_NOTE =
  'Could not confirm whether billing is enabled on this instance.';

/** `get_event_usage` skips the block-on-disabled gate but still names its window. */
export function eventUsageWindowLine(enabled: boolean | undefined): string {
  if (enabled === true) return 'This period is a Stripe billing cycle.';
  if (enabled === false)
    return 'This period is a rolling 30 days (billing is not enabled on this instance).';
  return BILLING_UNKNOWN_NOTE;
}
