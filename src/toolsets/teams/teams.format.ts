import { keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

type TeamProject = components['schemas']['TeamProjectSchema'];
type Project = components['schemas']['ProjectSchema'];

// Team slugs and project names are operator-controlled and slug-restricted,
// not fenced (spec "Untrusted text"). Every field read here is guarded
// against a malformed/partial GlitchTip response so a missing optional part
// degrades the text; only a field of the wrong type (not the array
// TeamProjectSchema declares) throws, which ToolOutput turns into the
// `malformed` tool error (D-12, BUG-20260925-006).

const PROJECT_LIST_LIMIT = 10;

export function teamListView(page: Page<TeamProject>, org: string): View {
  const teams = page.items;
  return {
    text: () => {
      if (teams.length === 0) return `No teams in ${org}.`;
      const body = table(teams, [
        { header: 'slug', value: (t) => t.slug },
        { header: 'id', value: (t) => t.id },
        { header: 'memberCount', value: (t) => t.memberCount },
        { header: 'isMember', value: (t) => t.isMember },
        { header: 'projects', value: (t) => projectSlugsSummary(t.projects) },
      ]);
      return withCursor(body, page.nextCursor);
    },
    json: () => ({
      teams: teams.map((t) => ({
        slug: t.slug,
        id: t.id,
        memberCount: t.memberCount,
        isMember: t.isMember,
        projects: projectSlugs(t.projects),
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function teamDetailView(team: TeamProject): View {
  const projects = team.projects ?? [];
  return {
    text: () => {
      const header = keyValues([
        ['slug', team.slug],
        ['id', team.id],
        ['created', day(team.dateCreated)],
        ['memberCount', team.memberCount],
        ['isMember', team.isMember],
      ]);
      const projectLines =
        projects.length === 0
          ? 'projects: none'
          : `projects:\n${projects.map((p) => `  ${projectLine(p)}`).join('\n')}`;
      return `${header}\n${projectLines}\nUse list_members(team) (members toolset) for who is in it.`;
    },
    json: () => ({
      slug: team.slug,
      id: team.id,
      dateCreated: team.dateCreated,
      memberCount: team.memberCount,
      isMember: team.isMember,
      projects: projects.map((p) => ({
        slug: p.slug ?? null,
        name: p.name ?? null,
        platform: p.platform ?? null,
      })),
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

function projectLine(project: Project): string {
  return `${project.slug ?? '?'} (${project.name ?? '?'}, ${project.platform ?? '?'})`;
}

function projectSlugs(projects: readonly Project[] | null | undefined): string[] {
  return (projects ?? []).map((p) => p.slug ?? p.name ?? '?');
}

function projectSlugsSummary(projects: readonly Project[] | null | undefined): string {
  const slugs = projectSlugs(projects);
  if (slugs.length === 0) return '-';
  if (slugs.length <= PROJECT_LIST_LIMIT) return slugs.join(', ');
  const shown = slugs.slice(0, PROJECT_LIST_LIMIT);
  return `${shown.join(', ')}, +${slugs.length - PROJECT_LIST_LIMIT} more`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
