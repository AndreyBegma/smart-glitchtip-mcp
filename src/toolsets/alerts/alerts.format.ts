import { flatten as sharedFlatten } from '../../format/sanitize';
import { keyValues, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

export type Alert = components['schemas']['ProjectAlertSchema'];
export type StoredRecipient = components['schemas']['AlertRecipientSchema'];
export type TestResult = components['schemas']['TestAlertResultSchema'];

// Views project GlitchTip's alert payloads down to what an agent uses (D-12).
// A recipient URL is a credential (spec "Recipient secrets"): it renders only
// masked — origin plus `/…` — in text and json alike, and a Zulip `api_key`
// never renders. Masked URLs and test-delivery messages are fenced (D-18);
// alert names, tags and Zulip channel/topic are operator-set and only
// flattened. A missing optional part renders as `?`; a field of the wrong
// type throws a TypeError, which ToolOutput turns into `malformed`.

const FIELD_CAP = 2000;
const EMAIL_TARGET = "email to the project's team members";
const UNPARSABLE = 'unparsable URL (masked)';

/**
 * The shared flatten (CR, LF, control and invisible characters → one space;
 * BUG-20260925-016), capped so one field cannot take the whole budget.
 */
export function flatten(text: string): string {
  const flat = sharedFlatten(text);
  return flat.length > FIELD_CAP ? `${flat.slice(0, FIELD_CAP - 1)}…` : flat;
}

/** A recipient URL as it may be shown: its origin, plus `/…` when it has more. */
export function maskUrl(url: unknown): string {
  if (typeof url !== 'string' || url === '') return '?';
  if (!URL.canParse(url)) return UNPARSABLE;
  const parsed = new URL(url);
  if (parsed.origin === 'null') return UNPARSABLE;
  const hasMore =
    (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash;
  return hasMore ? `${parsed.origin}/…` : parsed.origin;
}

/** A Zulip recipient's `config`, without the key. */
interface ZulipSettings {
  readonly botEmail: string | null;
  readonly channel: string | null;
  readonly topic: string | null;
}

function zulipSettings(config: unknown): ZulipSettings {
  const c = (typeof config === 'object' && config !== null ? config : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown) => (typeof v === 'string' ? flatten(v) : null);
  return { botEmail: str(c.bot_email), channel: str(c.channel), topic: str(c.topic) };
}

function tagsOf(recipient: StoredRecipient): string[] {
  const tags = recipient.tagsToAdd;
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => (typeof t === 'string' ? flatten(t) : '?'));
}

function typeOf(recipient: StoredRecipient): string {
  return typeof recipient.recipientType === 'string' && recipient.recipientType !== ''
    ? flatten(recipient.recipientType)
    : '?';
}

/** The masked target as text: the URL part fenced, everything else plain. */
function targetText(recipient: StoredRecipient): string {
  const type = typeOf(recipient);
  if (type === 'email') return EMAIL_TARGET;
  const url = untrusted('recipient.url', maskUrl(recipient.url), 'glitchtip-config');
  if (type !== 'zulip') return url;
  const z = zulipSettings(recipient.config);
  return `${url} channel ${z.channel ?? '?'} topic ${z.topic ?? '?'} bot ${z.botEmail ?? '?'}`;
}

function recipientLine(recipient: StoredRecipient, withTags: boolean): string {
  const line = `  - recipient ${recipient.id ?? '?'}  ${typeOf(recipient)}  ${targetText(recipient)}`;
  const tags = tagsOf(recipient);
  return withTags && tags.length > 0 ? `${line}\n    tags: ${tags.join(', ')}` : line;
}

function recipientJson(recipient: StoredRecipient, withTags: boolean) {
  const type = typeOf(recipient);
  return {
    id: recipient.id ?? null,
    recipientType: type,
    target: type === 'email' ? EMAIL_TARGET : maskUrl(recipient.url),
    ...(type === 'zulip' ? { zulip: zulipSettings(recipient.config) } : {}),
    ...(withTags ? { tagsToAdd: tagsOf(recipient) } : {}),
  };
}

/** "10 events in 5 minutes", "uptime failures", both, or what is missing. */
export function triggerText(alert: Alert): string {
  const parts: string[] = [];
  const { quantity, timespanMinutes } = alert;
  if (quantity != null || timespanMinutes != null) {
    parts.push(`${quantity ?? '?'} events in ${timespanMinutes ?? '?'} minutes`);
  }
  if (alert.uptime === true) parts.push('uptime failures');
  return parts.length > 0 ? parts.join('; ') : 'no trigger set';
}

function recipientsOf(alert: Alert): readonly StoredRecipient[] {
  return alert.alertRecipients ?? [];
}

function alertText(alert: Alert, withTags: boolean): string {
  const recipients = recipientsOf(alert);
  const header = keyValues([
    ['alert', alert.id ?? '?'],
    ['name', typeof alert.name === 'string' && alert.name !== '' ? flatten(alert.name) : 'unnamed'],
    ['trigger', triggerText(alert)],
  ]);
  const lines =
    recipients.length === 0
      ? ["recipients: none (GlitchTip emails the project's team members)"]
      : ['recipients:', ...recipients.map((r) => recipientLine(r, withTags))];
  return [header, ...lines].join('\n');
}

function alertJson(alert: Alert, withTags: boolean) {
  return {
    id: alert.id ?? null,
    name: alert.name ?? null,
    timespanMinutes: alert.timespanMinutes ?? null,
    quantity: alert.quantity ?? null,
    uptime: alert.uptime ?? null,
    recipients: recipientsOf(alert).map((r) => recipientJson(r, withTags)),
  };
}

export function alertListView(page: Page<Alert>, project: string): View {
  const alerts = page.items;
  return {
    untrusted: { field: 'alerts', source: 'glitchtip-config' },
    text: () => {
      if (alerts.length === 0) return `No alerts in ${project}.`;
      return withCursor(alerts.map((a) => alertText(a, false)).join('\n\n'), page.nextCursor);
    },
    json: () => ({
      alerts: alerts.map((a) => alertJson(a, false)),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function alertDetailView(alert: Alert): View {
  return {
    untrusted: { field: 'alert', source: 'glitchtip-config' },
    text: () => alertText(alert, true),
    json: () => alertJson(alert, true),
  };
}

/**
 * Confirmation of a write that returns the alert. `summary` is written by
 * this server and carries no recipient value; the alert renders masked below.
 */
export function alertChangedView(summary: string, alert: Alert | undefined, note?: string): View {
  return {
    untrusted: { field: 'alert', source: 'glitchtip-config' },
    text: () => {
      const body = alert ? alertText(alert, true) : 'GlitchTip returned no body (?).';
      return [summary, body, note].filter(Boolean).join('\n');
    },
    json: () => ({
      result: summary,
      note: note ?? null,
      alert: alert ? alertJson(alert, true) : null,
    }),
  };
}

/** Test-delivery results; `results` must already be scrubbed of secrets. */
export function testResultsView(alertId: number, results: readonly TestResult[]): View {
  return {
    untrusted: { field: 'results', source: 'external' },
    text: () => {
      if (results.length === 0) return `Alert ${alertId} has no matching recipients to test.`;
      const lines = results.map((r) => {
        const type = typeof r.recipientType === 'string' ? flatten(r.recipientType) : '?';
        const status = typeof r.status === 'string' ? flatten(r.status) : '?';
        const message =
          typeof r.message === 'string' && r.message !== ''
            ? `  ${untrusted('test.message', flatten(r.message), 'external')}`
            : '';
        return `${type}  ${status}${message}`;
      });
      return [`Test delivery for alert ${alertId}:`, ...lines].join('\n');
    },
    json: () => ({
      alertId,
      results: results.map((r) => ({
        recipientType: r.recipientType ?? null,
        status: r.status ?? null,
        message: r.message ?? null,
      })),
    }),
  };
}

/** Confirmation of a write with nothing richer to show (D-12). */
export function resultView(summary: string): View {
  return {
    text: () => summary,
    json: () => ({ result: summary }),
  };
}
