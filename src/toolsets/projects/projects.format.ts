import { keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

type ProjectListItem = components['schemas']['ProjectTeamSchema'];
type ProjectDetail = components['schemas']['ProjectOrganizationSchema'];
type TeamProjectItem = components['schemas']['ProjectSchema'];
type ProjectKey = components['schemas']['ProjectKeySchema'];
type ProjectEnvironment = components['schemas']['EnvironmentProjectSchema'];
type ProjectTeam = components['schemas']['TeamSchema'];
type CreatedProject = components['schemas']['ProjectSchema'];
type ChangedProjectTeam = components['schemas']['ProjectTeamSchema'];

/** What `create_project` and `update_project` both return: shape shared by ProjectSchema and ProjectOrganizationSchema. */
interface ProjectLike {
  readonly slug?: string | null;
  readonly name: string;
  readonly platform?: string | null;
  readonly eventThrottleRate: number;
}

// Views project GlitchTip's payloads down to the fields an agent uses; the
// json format returns the same projection, never the raw payload (D-12).

export function projectListView(page: Page<ProjectListItem>): View {
  const projects = page.items.map((p) => ({
    slug: p.slug ?? p.name,
    name: p.name,
    platform: p.platform ?? null,
    teams: p.teams.map((t) => t.slug),
    firstEvent: p.firstEvent ?? null,
    id: p.id,
  }));
  return {
    text: () => {
      if (projects.length === 0) return 'No projects in this organization.';
      const body = table(projects, [
        { header: 'slug', value: (p) => p.slug },
        { header: 'name', value: (p) => p.name },
        { header: 'platform', value: (p) => p.platform },
        { header: 'teams', value: (p) => (p.teams.length ? p.teams.join(', ') : '-') },
        { header: 'first event', value: (p) => p.firstEvent ?? 'no events yet' },
        { header: 'id', value: (p) => p.id },
      ]);
      return withCursor(body, page.nextCursor);
    },
    json: () => ({ projects, nextCursor: page.nextCursor ?? null }),
  };
}

export function projectDetailView(project: ProjectDetail): View {
  const projection = {
    slug: project.slug ?? project.name,
    name: project.name,
    id: project.id,
    platform: project.platform ?? null,
    dateCreated: project.dateCreated,
    firstEvent: project.firstEvent ?? null,
    eventThrottleRate: project.eventThrottleRate,
    scrubIPAddresses: project.scrubIPAddresses,
    isPublic: project.isPublic,
    isBookmarked: project.isBookmarked,
    organization: project.organization.slug,
  };
  return {
    text: () =>
      keyValues([
        ['slug', projection.slug],
        ['name', projection.name],
        ['id', projection.id],
        ['platform', projection.platform],
        ['created', day(projection.dateCreated)],
        ['first event', projection.firstEvent ?? 'no events yet'],
        ['event throttle rate', projection.eventThrottleRate],
        ['ip scrubbing', projection.scrubIPAddresses],
        ['public', projection.isPublic],
        ['bookmarked', projection.isBookmarked],
        ['organization', projection.organization],
      ]),
    json: () => projection,
  };
}

export function teamProjectListView(team: string, page: Page<TeamProjectItem>): View {
  const projects = page.items.map((p) => ({
    slug: p.slug ?? p.name,
    name: p.name,
    platform: p.platform ?? null,
    firstEvent: p.firstEvent ?? null,
    id: p.id,
  }));
  return {
    text: () => {
      if (projects.length === 0) return `No projects for team ${team}.`;
      const body = table(projects, [
        { header: 'slug', value: (p) => p.slug },
        { header: 'name', value: (p) => p.name },
        { header: 'platform', value: (p) => p.platform },
        { header: 'first event', value: (p) => p.firstEvent ?? 'no events yet' },
      ]);
      return withCursor(body, page.nextCursor);
    },
    json: () => ({ team, projects, nextCursor: page.nextCursor ?? null }),
  };
}

function keyRateLimitText(rateLimit: ProjectKey['rateLimit']): string {
  return rateLimit ? `${rateLimit.count} per ${rateLimit.window}s` : 'none';
}

function keyProjection(key: ProjectKey) {
  return {
    id: key.id,
    label: key.label ?? key.name ?? null,
    dateCreated: key.dateCreated,
    rateLimit: key.rateLimit ?? null,
    dsn: { public: key.dsn?.public ?? null, security: key.dsn?.security ?? null },
  };
}

export function projectKeyListView(page: Page<ProjectKey>): View {
  const keys = page.items;
  return {
    text: () => {
      if (keys.length === 0) return 'No client keys for this project.';
      const blocks = keys.map((key) =>
        keyValues([
          ['id', key.id],
          ['label', key.label ?? key.name],
          ['created', day(key.dateCreated)],
          ['rate limit', keyRateLimitText(key.rateLimit)],
          ['dsn.public', key.dsn?.public],
          ['dsn.security', key.dsn?.security],
        ]),
      );
      return withCursor(blocks.join('\n\n'), page.nextCursor);
    },
    json: () => ({ keys: keys.map(keyProjection), nextCursor: page.nextCursor ?? null }),
  };
}

export function projectKeyDetailView(key: ProjectKey): View {
  return {
    text: () =>
      keyValues([
        ['id', key.id],
        ['label', key.label ?? key.name],
        ['created', day(key.dateCreated)],
        ['rate limit', keyRateLimitText(key.rateLimit)],
        ['dsn.public', key.dsn?.public],
        ['dsn.security', key.dsn?.security],
      ]),
    json: () => keyProjection(key),
  };
}

/** Confirmation of a key write: summary line, plus id and DSN when the key is known. */
export function changedProjectKeyView(summary: string, key?: ProjectKey): View {
  return {
    text: () =>
      key
        ? [
            summary,
            keyValues([
              ['id', key.id],
              ['label', key.label ?? key.name],
              ['rate limit', keyRateLimitText(key.rateLimit)],
              ['dsn.public', key.dsn?.public],
              ['dsn.security', key.dsn?.security],
            ]),
          ].join('\n')
        : summary,
    json: () => ({ result: summary, key: key ? keyProjection(key) : null }),
  };
}

export function projectEnvironmentListView(
  project: string,
  visibility: string,
  page: Page<ProjectEnvironment>,
): View {
  const environments = page.items.map((e) => ({ name: e.name, hidden: e.isHidden }));
  return {
    text: () => {
      if (environments.length === 0) {
        return `No environments in ${project} (visibility: ${visibility}).`;
      }
      const body = table(environments, [
        { header: 'name', value: (e) => e.name },
        { header: 'hidden', value: (e) => e.hidden },
      ]);
      return withCursor(body, page.nextCursor);
    },
    json: () => ({ project, environments, nextCursor: page.nextCursor ?? null }),
  };
}

/** Confirmation of `set_project_environment_visibility`. */
export function changedEnvironmentView(summary: string, env?: ProjectEnvironment): View {
  return {
    text: () => summary,
    json: () => ({
      result: summary,
      environment: env ? { name: env.name, hidden: env.isHidden } : null,
    }),
  };
}

export function projectTeamListView(project: string, page: Page<ProjectTeam>): View {
  const teams = page.items.map((t) => ({ slug: t.slug, members: t.memberCount }));
  return {
    text: () => {
      if (teams.length === 0) return `No teams attached to project ${project}.`;
      const body = table(teams, [
        { header: 'slug', value: (t) => t.slug },
        { header: 'members', value: (t) => t.members },
      ]);
      return withCursor(body, page.nextCursor);
    },
    json: () => ({ project, teams, nextCursor: page.nextCursor ?? null }),
  };
}

/** Confirmation of `add_team_to_project` / `remove_team_from_project`: the project's current teams. */
export function changedProjectTeamView(summary: string, project?: ChangedProjectTeam): View {
  const teams = project?.teams.map((t) => t.slug) ?? null;
  return {
    text: () => (teams ? `${summary}\nteams: ${teams.length ? teams.join(', ') : '0'}` : summary),
    json: () => ({ result: summary, teams }),
  };
}

/** Confirmation of `update_project` / `delete_project`. */
export function changedProjectView(summary: string, project?: ProjectLike): View {
  return {
    text: () =>
      project
        ? [
            summary,
            keyValues([
              ['slug', project.slug],
              ['name', project.name],
              ['platform', project.platform],
              ['event throttle rate', project.eventThrottleRate],
            ]),
          ].join('\n')
        : summary,
    json: () => ({
      result: summary,
      project: project
        ? {
            slug: project.slug ?? null,
            name: project.name,
            platform: project.platform ?? null,
            eventThrottleRate: project.eventThrottleRate,
          }
        : null,
    }),
  };
}

/** `create_project`'s result: the new project, plus the DSN fetched right after (or why that failed). */
export function createdProjectView(
  project: CreatedProject,
  dsnPublic?: string,
  dsnFailure?: string,
): View {
  const base = changedProjectView(`Created project ${project.slug} (${project.name}).`, project);
  return {
    text: () => {
      const body = base.text();
      if (dsnPublic) return `${body}\ndsn.public: ${dsnPublic}`;
      if (dsnFailure) return `${body}\n${dsnFailure}`;
      return body;
    },
    json: () => ({ ...(base.json() as Record<string, unknown>), dsn: dsnPublic ?? null }),
  };
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
