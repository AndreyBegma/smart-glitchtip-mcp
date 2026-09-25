import type { components } from '../../glitchtip/generated/schema';
import { AlertRefusal } from './alert-errors';
import { type Alert, flatten, type StoredRecipient } from './alerts.format';
import { isHttpUrl, RECIPIENT_TYPES, type RecipientInput, WEBHOOK_TYPES } from './alerts.params';

type AlertIn = components['schemas']['ProjectAlertIn'];
export type RecipientIn = NonNullable<AlertIn['alertRecipients']>[number];

// GlitchTip's alert PUT is a full replace: the handler pops
// `alert_recipients` with default `[]` and deletes every recipient not in the
// body [Confirmed: update_project_alert]. Everything here exists so a write
// re-sends the alert exactly as stored, changed only where the caller asked —
// and refuses, rather than guesses, when the stored alert cannot be expressed.

const ZULIP_DEFAULT_TOPIC = 'GlitchTip Alerts';

/** An agent's recipient in GlitchTip's camelCase `ProjectAlertIn` shape. */
export function recipientToWire(input: RecipientInput): RecipientIn {
  const tagsToAdd = input.tags_to_add ?? null;
  switch (input.type) {
    case 'email':
      return { recipientType: 'email', url: '', tagsToAdd };
    case 'zulip':
      return {
        recipientType: 'zulip',
        url: input.url,
        botEmail: input.bot_email,
        apiKey: input.api_key,
        channel: input.channel,
        topic: input.topic ?? ZULIP_DEFAULT_TOPIC,
        tagsToAdd,
      };
    default:
      return { recipientType: input.type, url: input.url, tagsToAdd };
  }
}

/** The scalar fields of an alert, as the PUT body carries them. */
export interface AlertScalars {
  readonly name: string | null;
  readonly timespanMinutes: number | null;
  readonly quantity: number | null;
  readonly uptime: boolean;
}

/** The stored alert's scalars; a field of the wrong type is a refusal, not a guess. */
export function storedScalars(alert: Alert, alertId: number): AlertScalars {
  const { name, timespanMinutes, quantity, uptime } = alert;
  const optional = (v: unknown, type: 'string' | 'number') =>
    v === null || v === undefined || typeof v === type;
  if (
    !optional(name, 'string') ||
    !optional(timespanMinutes, 'number') ||
    !optional(quantity, 'number') ||
    !(uptime === undefined || typeof uptime === 'boolean')
  ) {
    throw new AlertRefusal(
      `Refused: alert ${alertId} as GlitchTip returned it has a field of an unexpected type, so it cannot be re-sent unchanged. No change was made.`,
    );
  }
  return {
    name: name ?? null,
    timespanMinutes: timespanMinutes ?? null,
    quantity: quantity ?? null,
    uptime: uptime ?? false,
  };
}

/** Refuses a trigger with only one of its two halves (spec: both or neither). */
export function assertWholeTrigger(scalars: AlertScalars): void {
  if ((scalars.timespanMinutes === null) !== (scalars.quantity === null)) {
    throw new AlertRefusal(
      'Refused: timespan_minutes and quantity must be set together or cleared together; the alert would end up with only one of them. No change was made.',
    );
  }
}

/**
 * Every stored recipient as the PUT must re-send it: `url` (`""` for email),
 * `tagsToAdd`, and for Zulip `config.bot_email/api_key/channel/topic`
 * [Confirmed: `_prepare_recipient_data` stores them snake_case in `config`].
 * A recipient the input schema cannot express would be deleted by the PUT,
 * so the whole write is refused instead.
 */
export function resendRecipients(alert: Alert, alertId: number): RecipientIn[] {
  const stored: unknown = alert.alertRecipients ?? [];
  if (!Array.isArray(stored)) {
    throw refusal(alertId, 'its recipient list', 'GlitchTip returned something other than a list');
  }
  return stored.map((recipient) => resend(recipient, alertId));
}

function resend(value: unknown, alertId: number): RecipientIn {
  if (typeof value !== 'object' || value === null) {
    throw refusal(alertId, 'a recipient', 'it is not an object');
  }
  const recipient = value as StoredRecipient;
  const what = `recipient ${typeof recipient.id === 'number' ? recipient.id : '?'}`;
  const type = recipient.recipientType as unknown;
  if (typeof type !== 'string' || !(RECIPIENT_TYPES as readonly string[]).includes(type)) {
    throw refusal(alertId, what, 'its type is not one this server can re-send');
  }
  const tagsToAdd = storedTags(recipient.tagsToAdd, alertId, what);
  if (type === 'email') return { recipientType: 'email', url: '', tagsToAdd };
  const url = recipient.url;
  if (typeof url !== 'string' || !isHttpUrl(url)) {
    throw refusal(alertId, what, 'its URL is missing or not an http(s) URL');
  }
  if (type === 'zulip') return { ...zulipConfig(recipient.config, alertId, what), url, tagsToAdd };
  const webhookType = type as (typeof WEBHOOK_TYPES)[number];
  return { recipientType: webhookType, url, tagsToAdd };
}

function storedTags(tags: unknown, alertId: number, what: string): string[] | null {
  if (tags === null || tags === undefined) return null;
  if (Array.isArray(tags) && tags.every((t) => typeof t === 'string')) return tags;
  throw refusal(alertId, what, 'its tags are not a list of strings');
}

function zulipConfig(config: unknown, alertId: number, what: string) {
  const c = (typeof config === 'object' && config !== null ? config : {}) as Record<
    string,
    unknown
  >;
  const { bot_email, api_key, channel, topic } = c;
  if (typeof bot_email !== 'string' || typeof api_key !== 'string' || typeof channel !== 'string') {
    throw refusal(alertId, what, 'its Zulip settings are incomplete');
  }
  return {
    recipientType: 'zulip' as const,
    botEmail: bot_email,
    apiKey: api_key,
    channel,
    topic: typeof topic === 'string' ? topic : ZULIP_DEFAULT_TOPIC,
  };
}

/** Names the rule and the recipient, never a recipient's value. */
function refusal(alertId: number, what: string, why: string): AlertRefusal {
  return new AlertRefusal(
    `Refused: ${flatten(what)} of alert ${alertId} cannot be re-sent as stored (${why}); re-sending it would delete it. No change was made.`,
  );
}
