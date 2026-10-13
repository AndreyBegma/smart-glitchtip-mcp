import { flatten } from '../../format/sanitize';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

// Views GlitchTip's status page payloads down to the fields an agent uses (D-12). A status page's
// name, and each attached monitor's name, are untrusted (D-18: "glitchtip-config" — set by an
// organization member). Every field read here is guarded against a malformed or partial GlitchTip
// response so a bad payload degrades the text, never throws (BUG-20260925-006); typed fields
// (ids, timestamps, slugs) render plain only when they actually have the shape GlitchTip's schema
// promises — otherwise they are treated as untrusted text (fenced) and never trusted enough to
// build a URL from.

export const FIELD_CAP = 2000;

export function capText(text: string, limit = FIELD_CAP): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function truncate(text: string, limit: number): string {
  return capText(flatten(text), limit);
}

type StatusPage = components['schemas']['StatusPageSchema'];
type Monitor = components['schemas']['MonitorSchema'];

/** GlitchTip's SlugStr shape [Confirmed: apps/uptime/schema.py — StatusPageSchema.slug]. */
const SAFE_SLUG = /^[a-z0-9_-]+$/i;

function isSafeSlug(slug: string): boolean {
  return SAFE_SLUG.test(slug);
}

function stateText(isUp: boolean | null | undefined): 'up' | 'down' | 'pending' {
  if (isUp === true) return 'up';
  if (isUp === false) return 'down';
  return 'pending';
}

/** A monitor id is only ever meaningful as the number GlitchTip assigns it. */
function idText(id: number | null | undefined): string {
  return typeof id === 'number' ? String(id) : '?';
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
 * `<instance>/status-pages/<org>/<slug>/` [Confirmed: apps/uptime/urls.py].
 * Never called with a slug that failed `isSafeSlug` — an untrusted slug is
 * never interpolated into a URL this server hands back to an agent.
 */
function publicUrl(instanceUrl: string, org: string, slug: string): string {
  return `${instanceUrl.replace(/\/+$/, '')}/status-pages/${org}/${slug}/`;
}

/** True when one of the page's monitors carries the requested org's numeric id. */
function belongsToOrg(page: StatusPage, orgId: number | undefined): boolean {
  if (orgId === undefined) return false;
  return (page.monitors ?? []).some((m) => m?.organizationID === orgId);
}

/** A page's URL is shown only for a safe slug this server can attribute to `org`. */
function attributedUrl(
  page: StatusPage,
  instanceUrl: string,
  org: string,
  orgId: number | undefined,
): string | undefined {
  if (!page.slug || !isSafeSlug(page.slug) || !belongsToOrg(page, orgId)) return undefined;
  return publicUrl(instanceUrl, org, page.slug);
}

/** A page's slug, plain when it is a real slug, fenced otherwise (never trusted for a URL). */
function slugText(slug: string | null | undefined): string {
  if (!slug) return '?';
  return isSafeSlug(slug) ? slug : untrusted('slug', truncate(slug, FIELD_CAP), 'glitchtip-config');
}

/** `page.monitors` can itself carry a null entry; skipped here, like the json path already does. */
function realMonitors(monitors: readonly (Monitor | null)[] | null | undefined): Monitor[] {
  return (monitors ?? []).filter((m): m is Monitor => m != null);
}

function monitorLine(monitor: Monitor): string {
  const name = untrusted(
    'monitor.name',
    truncate(monitor.name ?? '', FIELD_CAP),
    'glitchtip-config',
  );
  return `  ${idText(monitor.id)} ${name} ${stateText(monitor.isUp)}`;
}

function statusPageBlock(
  page: StatusPage,
  instanceUrl: string,
  org: string,
  orgId: number | undefined,
): string {
  const name = untrusted('name', truncate(page.name ?? '', FIELD_CAP), 'glitchtip-config');
  const visibility = page.isPublic ? 'public' : 'private';
  const monitors = realMonitors(page.monitors);
  const lines = [`name: ${name}`, `slug: ${slugText(page.slug)}`, `visibility: ${visibility}`];
  const url = attributedUrl(page, instanceUrl, org, orgId);
  if (url) {
    lines.push(`url: ${url}`);
  } else if (page.slug) {
    // A slug exists but couldn't be attributed to `org` — say so, rather than silently omitting
    // the line, so an agent can tell "unknown" apart from "this page has no slug at all".
    lines.push('organization: unknown');
  }
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
  const monitors = realMonitors(page.monitors);
  return {
    name: page.name,
    slug: page.slug ?? null,
    public: page.isPublic,
    url: attributedUrl(page, instanceUrl, org, orgId) ?? null,
    monitors: monitors.map((m) => ({
      id: typeof m.id === 'number' ? m.id : null,
      name: m.name ?? null,
      state: stateText(m.isUp),
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
  // Fresh from our own POST: its organization is always the one just written to, so only the
  // safe-slug check gates whether a URL is built.
  const url =
    created.slug && isSafeSlug(created.slug)
      ? publicUrl(instanceUrl, org, created.slug)
      : undefined;
  return {
    untrusted: { field: 'status_pages', source: 'glitchtip-config' },
    text: () => {
      const lines = [
        `Created status page in ${org}.`,
        `name: ${name}`,
        `slug: ${slugText(created.slug)}`,
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
