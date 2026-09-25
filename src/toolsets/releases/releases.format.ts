import { type Column, keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

type Release = components['schemas']['ReleaseSchema'];
type Deploy = components['schemas']['DeploySchema'];
type Commit = components['schemas']['CommitSchema'];
type ReleaseFile = components['schemas']['DebugSymbolBundleSchema'];
type NameSlugProject = components['schemas']['NameSlugProjectSchema'];

// Views project GlitchTip's payloads down to the fields an agent uses (D-12).
// Version, shortVersion, ref, url, repository name, commit and deploy text,
// and file name/headers are untrusted (D-18): fenced with untrusted() in text
// output, and the whole json result wrapped in one fence per tool (see each
// view's `untrusted`). Every field read here is guarded against a malformed
// or partial GlitchTip response so a bad payload degrades the text, never
// throws (BUG-20260925-006).

const VERSION_LIST_LIMIT = 80;
/** Caps a single untrusted field so a shared response-budget cut can't land mid-fence. */
export const FIELD_CAP = 2000;
const COMMIT_MESSAGE_LIMIT = 120;

export function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function capText(text: string, limit = FIELD_CAP): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function truncate(text: string, limit: number): string {
  return capText(flatten(text), limit);
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim();
}

function releasedText(dateReleased: string | null | undefined): string {
  return dateReleased ?? 'unreleased';
}

function projectsListText(projects: readonly NameSlugProject[] | null | undefined): string {
  if (!projects || projects.length === 0) return '-';
  return projects.map((p) => p?.slug ?? p?.name ?? '?').join(', ');
}

function projectsDetailText(projects: readonly NameSlugProject[] | null | undefined): string {
  if (!projects || projects.length === 0) return '-';
  return projects
    .map((p) => (p?.name ? `${p?.slug ?? '?'} (${p.name})` : (p?.slug ?? '?')))
    .join(', ');
}

/** A table plus one untrusted-fenced value appended to each rendered row, at the end. */
export function withFencedTrailer<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  trailer: (row: Row) => string,
): string {
  const body = table(rows, columns);
  const [header, ...lines] = body.split('\n');
  const withTrailers = lines.map((line, i) => `${line}  ${trailer(rows[i])}`);
  return [header, ...withTrailers].join('\n');
}

export function releaseListView(
  page: Page<Release>,
  org: string,
  project: string | undefined,
): View {
  const releases = page.items;
  return {
    untrusted: { field: 'releases', source: 'glitchtip-event' },
    text: () => {
      if (releases.length === 0) {
        return `No releases in ${project ? `${org}/${project}` : org}.`;
      }
      const body = withFencedTrailer(
        releases,
        [
          { header: 'released', value: (r) => releasedText(r.dateReleased) },
          { header: 'created', value: (r) => r.dateCreated },
          { header: 'projects', value: (r) => projectsListText(r.projects) },
          { header: 'commits', value: (r) => r.commitCount ?? 0 },
          { header: 'deploys', value: (r) => r.deployCount ?? 0 },
        ],
        (r) => untrusted('version', truncate(r.version ?? '', VERSION_LIST_LIMIT)),
      );
      return withCursor(body, page.nextCursor);
    },
    json: () => ({
      releases: releases.map((r) => ({
        version: r.version,
        dateReleased: r.dateReleased,
        dateCreated: r.dateCreated,
        projects: (r.projects ?? []).map((p) => p?.slug ?? p?.name ?? null),
        commitCount: r.commitCount,
        deployCount: r.deployCount,
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function releaseDetailView(release: Release): View {
  return {
    untrusted: { field: 'release', source: 'glitchtip-event' },
    text: () => {
      const body = keyValues([
        ['version', untrusted('version', truncate(release.version ?? '', FIELD_CAP))],
        [
          'shortVersion',
          untrusted('shortVersion', truncate(release.shortVersion ?? '', FIELD_CAP)),
        ],
        [
          'ref',
          release.ref
            ? untrusted('ref', truncate(release.ref, FIELD_CAP), 'glitchtip-config')
            : undefined,
        ],
        [
          'url',
          release.url
            ? untrusted('url', truncate(release.url, FIELD_CAP), 'glitchtip-config')
            : undefined,
        ],
        [
          'repository',
          release.repository?.name
            ? untrusted(
                'repository',
                truncate(release.repository.name, FIELD_CAP),
                'glitchtip-config',
              )
            : undefined,
        ],
        ['released', releasedText(release.dateReleased)],
        ['created', release.dateCreated],
        ['projects', projectsDetailText(release.projects)],
        ['commits', release.commitCount ?? 0],
        ['deploys', release.deployCount ?? 0],
      ]);
      return `${body}\nUse list_release_commits and list_release_deploys for details.`;
    },
    json: () => ({
      version: release.version,
      shortVersion: release.shortVersion,
      ref: release.ref ?? null,
      url: release.url ?? null,
      repository: release.repository?.name ?? null,
      dateReleased: release.dateReleased,
      dateCreated: release.dateCreated,
      projects: (release.projects ?? []).map((p) => ({
        slug: p?.slug ?? null,
        name: p?.name ?? null,
      })),
      commitCount: release.commitCount,
      deployCount: release.deployCount,
    }),
  };
}

/**
 * Confirmation of a release write. `summary` must not embed release text
 * itself (D-18): the response's version, ref and projects are rendered
 * separately, fenced, below it.
 */
export function releaseChangedView(
  summary: string,
  release: Release | undefined,
  note?: string,
): View {
  return {
    untrusted: { field: 'release', source: 'glitchtip-event' },
    text: () => {
      const lines = [summary];
      if (release) {
        lines.push(`version: ${untrusted('version', truncate(release.version ?? '', FIELD_CAP))}`);
        if (release.ref) {
          lines.push(
            `ref: ${untrusted('ref', truncate(release.ref, FIELD_CAP), 'glitchtip-config')}`,
          );
        }
        lines.push(`released: ${releasedText(release.dateReleased)}`);
        lines.push(`projects: ${projectsListText(release.projects)}`);
      }
      if (note) lines.push(note);
      return lines.join('\n');
    },
    json: () => ({
      result: summary,
      note: note ?? null,
      version: release?.version ?? null,
      ref: release?.ref ?? null,
      dateReleased: release?.dateReleased ?? null,
      projects: (release?.projects ?? []).map((p) => p?.slug ?? p?.name ?? null),
    }),
  };
}

export function deployListView(org: string, version: string, deploys: Deploy[]): View {
  return {
    untrusted: { field: 'deploys', source: 'glitchtip-config' },
    text: () => {
      if (deploys.length === 0) return `No deploys for release ${version} in ${org}.`;
      return withFencedTrailer(
        deploys,
        [
          { header: 'id', value: (d) => d.id ?? '-' },
          { header: 'started', value: (d) => d.dateStarted ?? '-' },
          { header: 'finished', value: (d) => d.dateFinished ?? '-' },
          { header: 'created', value: (d) => d.dateCreated },
        ],
        (d) =>
          `${untrusted('environment', truncate(d.environment ?? '', FIELD_CAP), 'glitchtip-config')}` +
          (d.url ? `  ${untrusted('url', truncate(d.url, FIELD_CAP), 'glitchtip-config')}` : ''),
      );
    },
    json: () => ({
      version,
      deploys: deploys.map((d) => ({
        id: d.id ?? null,
        environment: d.environment,
        url: d.url ?? null,
        dateStarted: d.dateStarted,
        dateFinished: d.dateFinished,
        dateCreated: d.dateCreated,
      })),
    }),
  };
}

export function deployCreatedView(version: string, deploy: Deploy): View {
  const summary = `Recorded a deploy of release ${version}.`;
  return {
    untrusted: { field: 'deploys', source: 'glitchtip-config' },
    text: () =>
      `${summary}\nenvironment: ${untrusted('environment', truncate(deploy.environment ?? '', FIELD_CAP), 'glitchtip-config')}`,
    json: () => ({
      result: summary,
      id: deploy.id ?? null,
      environment: deploy.environment,
      url: deploy.url ?? null,
      dateStarted: deploy.dateStarted,
      dateFinished: deploy.dateFinished,
    }),
  };
}

/** Not a table (D-18): untrusted author/message would exceed table()'s per-cell cap mid-fence. */
export function commitListView(
  org: string,
  version: string,
  commits: readonly Commit[],
  shown: readonly Commit[],
): View {
  return {
    untrusted: { field: 'commits', source: 'glitchtip-config' },
    text: () => {
      if (commits.length === 0) return `No commits on release ${version} in ${org}.`;
      const blocks = shown.map((c) => {
        const id = (c.id ?? '').slice(0, 12) || '-';
        const author = untrusted(
          'commit.author',
          truncate(c.authorName ?? c.authorEmail ?? '', FIELD_CAP),
          'glitchtip-config',
        );
        const message = untrusted(
          'commit.message',
          truncate(firstLine(c.message ?? ''), COMMIT_MESSAGE_LIMIT),
          'glitchtip-config',
        );
        return `${id}  ${author}\n${message}`;
      });
      const suffix =
        shown.length < commits.length
          ? `\nshowing ${shown.length} of ${commits.length} commits.`
          : '';
      return `${blocks.join('\n\n')}${suffix}`;
    },
    json: () => ({
      version,
      total: commits.length,
      commits: shown.map((c) => ({
        id: c.id,
        authorName: c.authorName ?? null,
        authorEmail: c.authorEmail ?? null,
        message: firstLine(c.message ?? ''),
        dateCreated: c.dateCreated ?? null,
      })),
    }),
  };
}

/** Confirmation of `add_release_commits`: the merge counts and the release's new total. */
export function commitsChangedView(summary: string, release: Release): View {
  return {
    untrusted: { field: 'commits', source: 'glitchtip-config' },
    text: () => `${summary} Release now has ${release.commitCount ?? 0} commits.`,
    json: () => ({ result: summary, commitCount: release.commitCount ?? 0 }),
  };
}

export function releaseFileListView(
  page: Page<ReleaseFile>,
  org: string,
  version: string,
  project: string | undefined,
): View {
  const files = page.items;
  return {
    untrusted: { field: 'files', source: 'glitchtip-config' },
    text: () => {
      if (files.length === 0) {
        const where = project ? `${org}/${project}` : org;
        return `No files attached to release ${version} in ${where}.`;
      }
      const body = withFencedTrailer(
        files,
        [
          { header: 'id', value: (f) => f.id },
          { header: 'size', value: (f) => humanSize(f.size ?? 0) },
          { header: 'sha1', value: (f) => f.sha1 ?? '-' },
          { header: 'created', value: (f) => f.dateCreated },
        ],
        (f) => untrusted('name', truncate(f.name ?? '', FIELD_CAP), 'glitchtip-config'),
      );
      return withCursor(body, page.nextCursor);
    },
    json: () => ({
      version,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size ?? 0,
        sha1: f.sha1 ?? null,
        dateCreated: f.dateCreated,
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function releaseFileDetailView(version: string, file: ReleaseFile): View {
  return {
    untrusted: { field: 'files', source: 'glitchtip-config' },
    text: () => {
      const headers = Object.entries(file.headers ?? {})
        .map(
          ([key, value]) =>
            `  ${key}: ${untrusted('headers', truncate(value ?? '', FIELD_CAP), 'glitchtip-config')}`,
        )
        .join('\n');
      const body = keyValues([
        ['id', file.id],
        ['name', untrusted('name', truncate(file.name ?? '', FIELD_CAP), 'glitchtip-config')],
        ['size', humanSize(file.size ?? 0)],
        ['sha1', file.sha1],
        ['created', file.dateCreated],
      ]);
      return headers ? `${body}\nheaders:\n${headers}` : body;
    },
    json: () => ({
      version,
      id: file.id,
      name: file.name,
      size: file.size ?? 0,
      sha1: file.sha1 ?? null,
      dateCreated: file.dateCreated,
      headers: file.headers ?? {},
    }),
  };
}

/** Confirmation of a mutation that has no richer shape to show (D-12). */
export function resultView(summary: string, data: Record<string, unknown> = {}): View {
  return {
    text: () => summary,
    json: () => ({ result: summary, ...data }),
  };
}

function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.trunc(bytes || 0))} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
