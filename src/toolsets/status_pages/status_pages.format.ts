import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

// Views GlitchTip's status page payloads down to the fields an agent uses (D-12). A status page's
// name, and each attached monitor's name, are untrusted (D-18: "glitchtip-config" — set by an
// organization member). Every field read here is guarded against a malformed or partial GlitchTip
// response so a bad payload degrades the text, never throws (BUG-20260925-006).

export const FIELD_CAP = 2000;

export function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function capText(text: string, limit = FIELD_CAP): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function truncate(text: string, limit: number): string {
  return capText(flatten(text), limit);
}

type StatusPage = components['schemas']['StatusPageSchema'];
type Monitor = components['schemas']['MonitorSchema'];

function stateText(isUp: boolean | null | undefined): 'up' | 'down' | 'pending' {
  if (isUp === null || isUp === undefined) return 'pending';
  return isUp ? 'up' : 'down';
}

/**
 * Upstream ignores `organization_slug` on this list route [Confirmed:
 * list_status_pages filters by organization__users only]: the notice this
 * carries on every result (spec §"list_status_pages" — always present, even
 * when empty).
 */
export function allOrganizationsNotice(org: string): string {
  return (
    'GlitchTip lists status pages from all organizations you are a member of; ' +
    `this list is not limited to ${org}.`
  );
}

/**
 * `<instance>/status-pages/<org>/<slug>/` [Confirmed: apps/uptime/urls.py],
 * only when the page can be attributed to `org` (see `orgId`) and it has a slug.
 */
function publicUrl(instanceUrl: string, org: string, slug: string): string {
  return `${instanceUrl.replace(/\/+$/, '')}/status-pages/${org}/${slug}/`;
}

/** True when one of the page's monitors carries the requested org's numeric id. */
function belongsToOrg(page: StatusPage, orgId: number | undefined): boolean {
  if (orgId === undefined) return false;
  return (page.monitors ?? []).some((m) => m?.organizationID === orgId);
}

function monitorLine(monitor: Monitor): string {
  const id = monitor.id ?? '?';
  const name = untrusted(
    'monitor.name',
    truncate(monitor.name ?? '', FIELD_CAP),
    'glitchtip-config',
  );
  return `  ${id} ${name} ${stateText(monitor.isUp)}`;
}

function statusPageBlock(
  page: StatusPage,
  instanceUrl: string,
  org: string,
  orgId: number | undefined,
): string {
  const name = untrusted('name', truncate(page.name ?? '', FIELD_CAP), 'glitchtip-config');
  const visibility = page.isPublic ? 'public' : 'private';
  const monitors = page.monitors ?? [];
  const lines = [`name: ${name}`, `slug: ${page.slug ?? '?'}`, `visibility: ${visibility}`];
  if (page.slug && belongsToOrg(page, orgId))
    lines.push(`url: ${publicUrl(instanceUrl, org, page.slug)}`);
  lines.push(
    monitors.length === 0 ? 'monitors: none' : `monitors:\n${monitors.map(monitorLine).join('\n')}`,
  );
  return lines.join('\n');
}

function statusPageJson(
  page: StatusPage,
  instanceUrl: string,
  org: string,
  orgId: number | undefined,
): unknown {
  const monitors = page.monitors ?? [];
  return {
    name: page.name,
    slug: page.slug ?? null,
    public: page.isPublic,
    url: page.slug && belongsToOrg(page, orgId) ? publicUrl(instanceUrl, org, page.slug) : null,
    monitors: monitors.map((m) => ({
      id: m?.id ?? null,
      name: m?.name ?? null,
      state: stateText(m?.isUp),
    })),
  };
}

export function statusPageListView(
  page: Page<StatusPage>,
  instanceUrl: string,
  org: string,
  orgId: number | undefined,
): View {
  const pages = page.items;
  const notice = allOrganizationsNotice(org);
  return {
    untrusted: { field: 'status_pages', source: 'glitchtip-config' },
    text: () => {
      if (pages.length === 0) return `No status pages visible to this token.\n${notice}`;
      const blocks = pages.map((p) => statusPageBlock(p, instanceUrl, org, orgId));
      return `${blocks.join('\n\n')}\n${notice}`;
    },
    json: () => ({
      allOrganizationsNotice: notice,
      statusPages: pages.map((p) => statusPageJson(p, instanceUrl, org, orgId)),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function statusPageCreatedView(created: StatusPage, instanceUrl: string, org: string): View {
  const name = untrusted('name', truncate(created.name ?? '', FIELD_CAP), 'glitchtip-config');
  const visibility = created.isPublic ? 'public' : 'private';
  const url = created.slug ? publicUrl(instanceUrl, org, created.slug) : undefined;
  return {
    untrusted: { field: 'status_pages', source: 'glitchtip-config' },
    text: () => {
      const lines = [
        `Created status page in ${org}.`,
        `name: ${name}`,
        `slug: ${created.slug ?? '?'}`,
        `visibility: ${visibility}`,
      ];
      if (url) lines.push(`url: ${url}`);
      lines.push('No monitors attached — add them in the GlitchTip UI.');
      return lines.join('\n');
    },
    json: () => ({
      result: `Created status page in ${org}.`,
      name: created.name,
      slug: created.slug ?? null,
      public: created.isPublic,
      url: url ?? null,
    }),
  };
}

/** Confirmation of a write with nothing richer to show (D-12). */
export function resultView(summary: string, data: Record<string, unknown> = {}): View {
  return {
    text: () => summary,
    json: () => ({ result: summary, ...data }),
  };
}
