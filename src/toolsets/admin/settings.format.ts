import type { View } from '../../format/tool-output';
import {
  booleanField,
  fenced,
  GAP,
  isFields,
  jsonBoolean,
  jsonString,
  numberField,
  objectBody,
  yesNo,
} from './admin.values';
import type { SupportLink } from './support-link';

// Notification settings and the instance license (spec
// "get_notification_settings", "get_instance_license"). Neither carries
// text a person wrote, so neither JSON view declares `untrusted`; the billing
// e-mail and support URL are instance configuration and are fenced in text
// with source glitchtip-config all the same (D-18).

/** A second, optional read: its value, or why it could not be had. */
export type Optional<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** Project alert status [Confirmed: `ProjectAlertStatus`]: 1 on, 0 off. */
const ALERT_STATUS: Readonly<Record<number, 'on' | 'off'>> = { 1: 'on', 0: 'off' };

interface Override {
  readonly projectId: number;
  readonly status: 'on' | 'off' | number | null;
}

interface Overrides {
  readonly list: readonly Override[];
  /** Entries whose key was not a project id, left out. */
  readonly skipped: number;
}

export function notificationSettingsView(body: unknown, alerts: Optional<unknown>): View {
  const settings = objectBody(body, 'the notification settings');
  const overrides = alerts.ok ? readOverrides(alerts.value) : alerts;
  return {
    text: () => {
      const lines = [`subscribe by default: ${yesNo(settings.subscribeByDefault)}`];
      if (!overrides.ok) {
        lines.push(`Per-project overrides unavailable: ${overrides.reason}`);
        return lines.join('\n');
      }
      const { list, skipped } = overrides.value;
      lines.push(list.length === 0 ? 'per-project overrides: none' : 'per-project overrides:');
      for (const o of list) lines.push(`project ${o.projectId}: ${statusText(o.status)}`);
      if (skipped > 0) lines.push(`(${skipped} override(s) without a numeric project id ${GAP})`);
      return lines.join('\n');
    },
    json: () => ({
      subscribeByDefault: jsonBoolean(settings.subscribeByDefault),
      overrides: overrides.ok ? overrides.value.list : null,
      overridesUnavailable: overrides.ok ? undefined : overrides.reason,
    }),
  };
}

export function notificationDefaultView(body: unknown): View {
  const settings = objectBody(body, 'the notification settings');
  const value = yesNo(settings.subscribeByDefault);
  return {
    text: () => `Subscribe to new projects by default: ${value}.`,
    json: () => ({ subscribeByDefault: booleanField(settings.subscribeByDefault) ?? null }),
  };
}

export function instanceLicenseView(body: unknown, link: Optional<SupportLink>): View {
  const license = objectBody(body, 'the instance license');
  return {
    text: () =>
      [
        `billing email: ${billingEmailText(license.billingEmail)}`,
        `support license: ${link.ok ? link.value.license : `unknown (support link unavailable: ${link.reason})`}`,
        `support URL: ${supportUrlText(link)}`,
      ].join('\n'),
    json: () => ({
      billingEmail: jsonString(license.billingEmail),
      supportLicense: link.ok ? link.value.license : 'unknown',
      supportUrl: link.ok ? (link.value.url ?? null) : null,
      supportLinkUnavailable: link.ok ? undefined : link.reason,
    }),
  };
}

function readOverrides(value: unknown): Optional<Overrides> {
  if (!isFields(value)) {
    return { ok: false, reason: 'the response was not an object of project ids.' };
  }
  const list: Override[] = [];
  let skipped = 0;
  for (const [key, status] of Object.entries(value)) {
    if (!/^\d{1,15}$/.test(key)) {
      skipped++;
      continue;
    }
    list.push({ projectId: Number(key), status: statusOf(status) });
  }
  list.sort((a, b) => a.projectId - b.projectId);
  return { ok: true, value: { list, skipped } };
}

function statusOf(value: unknown): Override['status'] {
  const n = numberField(value);
  if (n === undefined) return null;
  return ALERT_STATUS[n] ?? n;
}

function statusText(status: Override['status']): string {
  if (status === null) return `status ${GAP}`;
  return typeof status === 'number' ? `status ${status}` : status;
}

function billingEmailText(value: unknown): string {
  if (value === null || value === '') return 'none';
  return fenced('license.billingEmail', value, 'glitchtip-config');
}

function supportUrlText(link: Optional<SupportLink>): string {
  if (!link.ok) return GAP;
  const { url } = link.value;
  return url === undefined
    ? `${GAP} (missing from the response)`
    : fenced('license.supportUrl', url, 'glitchtip-config');
}
