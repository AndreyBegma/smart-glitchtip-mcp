import { keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

type Organization = components['schemas']['OrganizationSchema'];
type OrganizationDetail = components['schemas']['OrganizationDetailSchema'];
type Environment = components['schemas']['EnvironmentSchema'];

// Views project GlitchTip's payloads down to the fields an agent uses; the
// json format returns the same projection, never the raw payload (D-12).

export function organizationListView(page: Page<Organization>): View {
  const organizations = page.items.map((org) => ({
    slug: org.slug,
    name: org.name,
    dateCreated: org.dateCreated,
  }));
  return {
    text: () => {
      if (organizations.length === 0) return 'No organizations visible to this token.';
      const body = table(organizations, [
        { header: 'slug', value: (o) => o.slug },
        { header: 'name', value: (o) => o.name },
        { header: 'created', value: (o) => day(o.dateCreated) },
      ]);
      return withCursor(body, page.nextCursor);
    },
    json: () => ({ organizations, nextCursor: page.nextCursor ?? null }),
  };
}

export function organizationDetailView(org: OrganizationDetail): View {
  const projection = {
    slug: org.slug,
    name: org.name,
    dateCreated: org.dateCreated,
    isAcceptingEvents: org.isAcceptingEvents,
    openMembership: org.openMembership,
    access: org.access,
    projects: org.projects.map((p) => p.slug ?? p.name),
    teams: org.teams.map((t) => t.slug),
  };
  return {
    text: () =>
      keyValues([
        ['slug', projection.slug],
        ['name', projection.name],
        ['created', day(projection.dateCreated)],
        ['accepting events', projection.isAcceptingEvents],
        ['open membership', projection.openMembership],
        ['your access', projection.access.join(', ') || 'none'],
        ['projects', countedList(projection.projects)],
        ['teams', countedList(projection.teams)],
      ]),
    json: () => projection,
  };
}

export function environmentListView(
  org: string,
  visibility: string,
  page: Page<Environment>,
): View {
  const environments = page.items.map((env) => env.name);
  return {
    text: () => {
      if (environments.length === 0) {
        return `No environments in ${org} (visibility: ${visibility}).`;
      }
      return withCursor(environments.join('\n'), page.nextCursor);
    },
    json: () => ({ organization: org, environments, nextCursor: page.nextCursor ?? null }),
  };
}

/** Confirmation of a write: one line of text, the projected organization as json. */
export function changedOrganizationView(summary: string, org?: OrganizationDetail): View {
  return {
    text: () => summary,
    json: () => ({
      result: summary,
      organization: org ? { slug: org.slug, name: org.name } : null,
    }),
  };
}

function countedList(items: readonly string[]): string {
  return items.length === 0 ? '0' : `${items.length} (${items.join(', ')})`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
