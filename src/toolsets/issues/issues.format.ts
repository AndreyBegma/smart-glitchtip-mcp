import { keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

type Issue = components['schemas']['IssueSchema'];
type IssueDetail = components['schemas']['IssueDetailSchema'];
type IssueActor = components['schemas']['IssueActorSchema'];
type IssueStats = components['schemas']['IssueStatsResponse'];
type IssueTag = components['schemas']['IssueTagSchema'];
type Commit = components['schemas']['CommitSchema'];
type IssueRelease = components['schemas']['IssueReleaseSchema'];

// Views project GlitchTip's payloads down to the fields an agent uses (D-12).
// Text fields event submitters control (title, culprit, tag keys/values,
// release versions, commit author/message) are wrapped with untrusted() in
// text output only (D-18); json keeps raw values, the same projection
// contract organizations.format.ts uses. Every field read here is guarded
// against a malformed/partial GlitchTip response (optional chaining, `?? ''`)
// so a bad payload degrades the text, never throws.

const TITLE_LIST_LIMIT = 120;
/** Caps a single untrusted field so a shared response-budget cut can't land mid-fence. */
const FIELD_CAP = 2000;

export function issueListView(
  page: Page<Issue>,
  org: string,
  project: string | undefined,
  query: string,
): View {
  const issues = page.items;
  return {
    text: () => {
      if (issues.length === 0) {
        const where = project ? `${org}/${project}` : org;
        return query === ''
          ? `No issues in ${where} (all statuses).`
          : `No issues match \`${query}\` in ${where}.`;
      }
      const body = table(issues, [
        { header: 'shortId', value: (i) => i.shortId },
        { header: 'id', value: (i) => i.id },
        { header: 'level', value: (i) => i.level },
        { header: 'status', value: (i) => i.status },
        { header: 'count', value: (i) => i.count },
        { header: 'users', value: (i) => i.userCount ?? 0 },
        { header: 'lastSeen', value: (i) => withRelative(i.lastSeen) },
        { header: 'project', value: (i) => i.project?.slug ?? i.project?.name ?? '-' },
        { header: 'assignee', value: (i) => actorLabel(i.assignedTo) },
      ]);
      const [header, ...rows] = body.split('\n');
      const withTitles = rows.map(
        (line, i) =>
          `${line}  ${untrusted('title', truncate(issues[i].title ?? '', TITLE_LIST_LIMIT))}`,
      );
      return withCursor([header, ...withTitles].join('\n'), page.nextCursor);
    },
    json: () => ({
      issues: issues.map((i) => ({
        shortId: i.shortId,
        id: i.id,
        level: i.level,
        status: i.status,
        count: i.count,
        userCount: i.userCount,
        lastSeen: i.lastSeen,
        project: i.project?.slug ?? i.project?.name ?? null,
        assignedTo: actorProjection(i.assignedTo),
        title: i.title,
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function issueDetailView(issue: IssueDetail): View {
  return {
    text: () => {
      const body = keyValues([
        ['shortId', issue.shortId],
        ['id', issue.id],
        ['level', issue.level],
        ['status', issue.status],
        ['count', issue.count],
        ['users', issue.userCount ?? 0],
        ['lastSeen', withRelative(issue.lastSeen)],
        ['firstSeen', withRelative(issue.firstSeen)],
        ['project', issue.project?.slug ?? issue.project?.name ?? '-'],
        ['assignee', actorLabel(issue.assignedTo)],
        ['type', issue.type],
        ['firstRelease', releaseVersionText('firstRelease', issue.firstRelease)],
        ['lastRelease', releaseVersionText('lastRelease', issue.lastRelease)],
        ['userReportCount', issue.userReportCount],
        ['numComments', issue.numComments],
        ['statusDetails', statusDetailsText(issue.statusDetails)],
        ['permalink', permalinkOf(issue)],
        ['title', untrusted('title', capText(flatten(issue.title ?? '')))],
        [
          'culprit',
          issue.culprit ? untrusted('culprit', capText(flatten(issue.culprit))) : undefined,
        ],
      ]);
      return `${body}\nUse get_latest_event (events toolset) for the stack trace.`;
    },
    json: () => ({
      shortId: issue.shortId,
      id: issue.id,
      level: issue.level,
      status: issue.status,
      count: issue.count,
      userCount: issue.userCount,
      lastSeen: issue.lastSeen,
      firstSeen: issue.firstSeen,
      project: issue.project?.slug ?? issue.project?.name ?? null,
      assignedTo: actorProjection(issue.assignedTo),
      type: issue.type,
      firstRelease: issue.firstRelease?.version ?? null,
      lastRelease: issue.lastRelease?.version ?? null,
      userReportCount: issue.userReportCount,
      numComments: issue.numComments,
      statusDetails: issue.statusDetails ?? null,
      permalink: permalinkOf(issue) ?? null,
      title: issue.title,
      culprit: issue.culprit ?? null,
    }),
  };
}

export function assignedIssueView(issueId: number, actor: IssueActor | null | undefined): View {
  const label = actorLabel(actor);
  return {
    text: () => `Issue ${issueId}: assignee is now ${label === '-' ? 'unassigned' : label}.`,
    json: () => ({ id: issueId, assignedTo: actorProjection(actor) }),
  };
}

export function issuesStatsView(rows: IssueStats[], period: '24h' | '14d'): View {
  return {
    text: () => {
      if (rows.length === 0) return 'No stats for the given issue ids.';
      return table(rows, [
        { header: 'id', value: (r) => r.id },
        { header: 'count', value: (r) => r.count },
        { header: 'users', value: (r) => r.userCount },
        { header: 'total', value: (r) => sumBuckets(r.stats?.[period]) },
        { header: 'series', value: (r) => seriesText(r.stats?.[period]) },
      ]);
    },
    json: () => ({
      period,
      issues: rows.map((r) => ({
        id: r.id,
        count: r.count,
        userCount: r.userCount,
        isUnhandled: r.isUnhandled,
        buckets: r.stats?.[period] ?? [],
      })),
    }),
  };
}

export function issueTagsView(issueId: number, key: string | undefined, tags: IssueTag[]): View {
  return {
    text: () => {
      if (tags.length === 0) {
        return key ? `No tag \`${key}\` on issue ${issueId}.` : `No tags on issue ${issueId}.`;
      }
      return tags
        .map((tag) => {
          const top = (tag.topValues ?? [])
            .slice(0, 5)
            .map((v) => `  ${untrusted('tag.value', flatten(v.value ?? ''))} (${v.count})`)
            .join('\n');
          const fencedKey = untrusted('tag.key', flatten(tag.key ?? ''));
          return `${fencedKey} (${tag.uniqueValues} unique, ${tag.totalValues} total)\n${top}`;
        })
        .join('\n\n');
    },
    json: () => ({
      issueId,
      tags: tags.map((tag) => ({
        key: tag.key,
        name: tag.name,
        uniqueValues: tag.uniqueValues,
        totalValues: tag.totalValues,
        topValues: (tag.topValues ?? [])
          .slice(0, 5)
          .map((v) => ({ value: v.value, count: v.count })),
      })),
    }),
  };
}

/** Not a table (D-18): untrusted author/message would exceed table()'s per-cell cap mid-fence. */
export function issueCommitsView(issueId: number, commits: Commit[]): View {
  return {
    text: () => {
      if (commits.length === 0) return `No commits found for issue ${issueId}.`;
      return commits
        .map((c) => {
          const id = (c.id ?? '').slice(0, 7) || '-';
          const author = untrusted(
            'commit.author',
            capText(flatten(c.authorName ?? c.authorEmail ?? '-')),
          );
          const message = untrusted('commit.message', capText(flatten(firstLine(c.message ?? ''))));
          return `${id}  ${author}\n${message}`;
        })
        .join('\n\n');
    },
    json: () => ({
      issueId,
      commits: commits.map((c) => ({
        id: c.id,
        author: c.authorName ?? c.authorEmail ?? null,
        message: firstLine(c.message ?? ''),
        dateCreated: c.dateCreated ?? null,
      })),
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

export function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Bounds a single field's length, independent of the whole-response budget (nit 10/11). */
export function capText(text: string, limit = FIELD_CAP): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function truncate(text: string, limit: number): string {
  return capText(flatten(text), limit);
}

/** Relative age of an ISO timestamp, coarsest unit only (e.g. "2h ago"). */
function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffMs = now - then;
  const abs = Math.abs(diffMs);
  const suffix = diffMs >= 0 ? 'ago' : 'from now';
  const units: readonly (readonly [string, number])[] = [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1_000],
  ];
  for (const [label, unitMs] of units) {
    if (abs >= unitMs) return `${Math.floor(abs / unitMs)}${label} ${suffix}`;
  }
  return 'just now';
}

function withRelative(iso: string | null | undefined, now?: number): string {
  if (!iso) return '-';
  return `${relativeTime(iso, now)} (${iso})`;
}

function actorLabel(actor: IssueActor | null | undefined): string {
  if (!actor) return '-';
  return actor.type === 'team' ? `team:${actor.slug ?? actor.name}` : `user:${actor.name}`;
}

function actorProjection(actor: IssueActor | null | undefined): unknown {
  return actor ? { type: actor.type, id: actor.id, name: actor.name } : null;
}

function permalinkOf(issue: IssueDetail): string | undefined {
  return issue.permalink && issue.permalink !== 'Not implemented' ? issue.permalink : undefined;
}

function releaseVersionText(
  field: string,
  release: IssueRelease | null | undefined,
): string | undefined {
  return release?.version ? untrusted(field, capText(flatten(release.version))) : undefined;
}

function statusDetailsText(details: Record<string, string> | null | undefined): string | undefined {
  if (!details) return undefined;
  const parts: string[] = [];
  if (details.inRelease) {
    parts.push(
      `inRelease: ${untrusted('statusDetails.inRelease', capText(flatten(details.inRelease)))}`,
    );
  }
  if (details.inNextRelease !== undefined) parts.push(`inNextRelease: ${details.inNextRelease}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function sumBuckets(buckets: number[][] | null | undefined): number {
  return (buckets ?? []).reduce((sum, bucket) => sum + (bucket?.[1] ?? 0), 0);
}

function seriesText(buckets: number[][] | null | undefined): string {
  const counts = (buckets ?? []).map((bucket) => bucket?.[1] ?? 0);
  return counts.length === 0 ? '-' : counts.join(',');
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim();
}
