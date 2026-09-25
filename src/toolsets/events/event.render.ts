import { keyValues } from '../../format/table';
import { untrusted } from '../../format/untrusted';
import { safeStringify, truncate } from './event.guards';
import { redactHeaderPairs, redactQueryString, redactUrl } from './event.redact';
import type {
  ParsedBreadcrumb,
  ParsedEvent,
  ParsedException,
  ParsedExceptionValue,
  ParsedFrame,
  ParsedRequest,
  RenderOptions,
} from './event.types';

const CONTEXT_LINE_LIMIT = 160;
const VAR_LIMIT = 200;
/** Hard structural caps: independent of budget, so an attacker-sized chain or */
/** stacktrace can't blow the non-droppable core no matter how tight the budget is. */
const MAX_EXCEPTION_VALUES = 10;
const MAX_FRAMES = 50;
const TRUNCATION_MARKER = '\n… truncated for budget …';
const CLOSE_TAG = '</untrusted>';
/** Sections dropped, in this order, before the foundation's tail-cut budget runs (spec AC7). */
const DROPPABLE_SECTIONS = ['breadcrumbs', 'tags', 'context'] as const;
/** `format: "json"` on the three detail tools: no `path` param, so the hint differs from get_event_json's. */
const DETAIL_JSON_TRUNCATED_NOTICE = {
  truncated: true,
  hint: 'reduce breadcrumbs or use get_event_json with path',
};

interface Section {
  readonly key: string;
  readonly text: string;
}

/**
 * The full text rendering, trimmed section-by-section to fit `budget` (spec
 * AC7). The result is guaranteed `<= budget` (any fence still open at that
 * point is closed before the marker), so the foundation's tail-cut safety
 * net never has to fire — it would otherwise risk cutting an
 * `<untrusted>` fence in half.
 */
export function renderEventDetailText(
  parsed: ParsedEvent,
  options: RenderOptions,
  budget: number,
): string {
  const sections = buildSections(parsed, options, budget);
  let active = sections;
  for (const key of DROPPABLE_SECTIONS) {
    if (assemble(active).length <= budget) break;
    active = active.filter((section) => section.key !== key);
  }
  const assembled = assemble(active);
  return assembled.length <= budget ? assembled : closeFencesAtCut(assembled, budget);
}

function assemble(sections: readonly Section[]): string {
  return sections.map((section) => section.text).join('\n\n');
}

/**
 * A last-resort cut ahead of the foundation's own, guaranteed `<= budget`
 * and never leaving a fence open. Room for the marker *and* every closing
 * tag the cut could possibly need is reserved before cutting — using the
 * fence count of the *whole* text as the (monotonically safe) upper bound —
 * so appending the actual closing tags afterwards can never push past budget.
 */
function closeFencesAtCut(text: string, budget: number): string {
  const maxOpens = (text.match(/<untrusted /g) ?? []).length;
  const reserve = TRUNCATION_MARKER.length + maxOpens * CLOSE_TAG.length;
  const room = Math.max(0, budget - reserve);
  const cut = text.slice(0, room);
  const opens = (cut.match(/<untrusted /g) ?? []).length;
  const closes = (cut.match(/<\/untrusted>/g) ?? []).length;
  const closing = CLOSE_TAG.repeat(Math.max(0, opens - closes));
  return `${cut}${closing}${TRUNCATION_MARKER}`;
}

function buildSections(
  parsed: ParsedEvent,
  options: RenderOptions,
  budget: number,
): readonly Section[] {
  const candidates: ReadonlyArray<readonly [string, string | undefined]> = [
    ['header', renderHeader(parsed)],
    ['exception', renderExceptionSection(parsed.exception, options, budget)],
    ['message', renderMessageSection(parsed.message)],
    ['breadcrumbs', renderBreadcrumbsSection(parsed.breadcrumbs, options.breadcrumbs)],
    ['request', renderRequestSection(parsed.request, options.includeRequestHeaders)],
    ['tags', renderTagsSection(parsed.tags)],
    ['context', renderContextSection(parsed.contexts)],
    ['user', renderUserSection(parsed.user)],
    ['errors', renderErrorsSection(parsed.errors)],
    ['footer', renderFooter(parsed)],
  ];
  return candidates
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, text]) => ({ key, text }));
}

/** `id`/dates are server-assigned; `level`/`platform`/`release`/`environment` are event-reported (D-18). */
function renderHeader(parsed: ParsedEvent): string {
  const lines = keyValues([
    ['event id', parsed.id],
    ['date received', parsed.dateReceived],
    ['level', parsed.level],
    ['platform', parsed.platform],
    ['release', parsed.release],
    ['environment', parsed.environment],
    ['next event', parsed.nextEventID],
    ['previous event', parsed.previousEventID],
  ]);
  return untrusted('header', lines);
}

function renderExceptionSection(
  exception: ParsedException | undefined,
  options: RenderOptions,
  budget: number,
): string | undefined {
  if (!exception) return undefined;
  if (!exception.recognised) {
    return 'exception data in an unrecognised shape — use get_event_json';
  }
  const ordered = [...exception.values].reverse();
  const shown = ordered.slice(0, MAX_EXCEPTION_VALUES);
  const omitted = ordered.length - shown.length;
  const blocks = shown.map((value) => renderExceptionValue(value, options, budget));
  if (omitted > 0)
    blocks.push(`… ${omitted} earlier exception${omitted === 1 ? '' : 's'} omitted …`);
  return untrusted('exception', blocks.join('\n\n'));
}

function renderExceptionValue(
  value: ParsedExceptionValue,
  options: RenderOptions,
  budget: number,
): string {
  const heading = `${value.type ?? 'Error'}: ${value.value ?? ''}`.trim();
  const full = [heading, ...renderFrameLines(value.frames, options)].join('\n');
  if (full.length <= budget) return full;
  // Too big even on its own (a pathological frame count): fall back to just
  // the most recent frame so the stack trace's most useful line survives.
  const top = selectDisplayFrames(value.frames)[0];
  const lines = top ? renderFrame(top, options) : [];
  return [heading, ...lines].join('\n');
}

/** Most-recent-call-first, in-app frames kept, library runs collapsed (spec "The event renderer"). */
function renderFrameLines(frames: readonly ParsedFrame[], options: RenderOptions): string[] {
  const ordered = capFrames(frames);
  const anyInApp = ordered.some((frame) => frame.inApp === true);
  if (!anyInApp) return ordered.slice(0, 5).flatMap((frame) => renderFrame(frame, options));
  const lines: string[] = [];
  let collapsed = 0;
  for (const frame of ordered) {
    if (!frame.inApp) {
      collapsed++;
      continue;
    }
    if (collapsed > 0) {
      lines.push(`  … ${collapsed} library frames …`);
      collapsed = 0;
    }
    lines.push(...renderFrame(frame, options));
  }
  if (collapsed > 0) lines.push(`  … ${collapsed} library frames …`);
  return lines;
}

/** Most-recent-call-first, capped to MAX_FRAMES regardless of how many the payload claims. */
function capFrames(frames: readonly ParsedFrame[]): readonly ParsedFrame[] {
  return [...frames].reverse().slice(0, MAX_FRAMES);
}

function renderFrame(frame: ParsedFrame, options: RenderOptions): string[] {
  const location = `${frame.filename ?? frame.module ?? '?'}:${frame.lineno ?? '?'}:${frame.colno ?? '?'}`;
  const lines = [`  at ${frame.function ?? '?'} (${location})`];
  if (frame.contextLine) lines.push(`    ${truncate(frame.contextLine, CONTEXT_LINE_LIMIT)}`);
  if (options.includeContext) {
    for (const line of [...(frame.preContext ?? []), ...(frame.postContext ?? [])]) {
      lines.push(`    ${truncate(line, CONTEXT_LINE_LIMIT)}`);
    }
  }
  if (options.includeVars && frame.vars) {
    const rendered = Object.entries(frame.vars)
      .map(([key, value]) => `${key}=${truncate(stringifyVar(value), VAR_LIMIT)}`)
      .join(', ');
    if (rendered) lines.push(`    vars: ${rendered}`);
  }
  return lines;
}

function stringifyVar(value: unknown): string {
  return typeof value === 'string' ? value : safeStringify(value);
}

function renderMessageSection(message: string | undefined): string | undefined {
  return message ? untrusted('message', message) : undefined;
}

function renderBreadcrumbsSection(
  breadcrumbs: readonly ParsedBreadcrumb[],
  count: number,
): string | undefined {
  if (count <= 0 || breadcrumbs.length === 0) return undefined;
  const lines = breadcrumbs
    .slice(-count)
    .map((crumb) =>
      `${crumb.timestamp ?? '?'} ${crumb.level ?? 'info'} ${crumb.category ?? '?'}: ${crumb.message ?? ''}`.trimEnd(),
    );
  return untrusted('breadcrumbs', lines.join('\n'));
}

function renderRequestSection(
  request: ParsedRequest | undefined,
  includeHeaders: boolean,
): string | undefined {
  if (!request) return undefined;
  const lines: string[] = [];
  const url = request.url ? redactUrl(request.url) : undefined;
  const summary = [request.method, url].filter((part): part is string => Boolean(part)).join(' ');
  if (summary) lines.push(summary);
  if (request.query) lines.push(`query: ${redactQueryString(request.query)}`);
  if (includeHeaders && request.headers.length > 0) {
    for (const [name, value] of redactHeaderPairs(request.headers)) lines.push(`${name}: ${value}`);
  }
  return lines.length > 0 ? untrusted('request', lines.join('\n')) : undefined;
}

function renderTagsSection(tags: ParsedEvent['tags']): string | undefined {
  if (tags.length === 0) return undefined;
  return untrusted('tags', tags.map((tag) => `${tag.key}=${tag.value}`).join(' '));
}

function renderContextSection(contexts: ParsedEvent['contexts']): string | undefined {
  if (contexts.length === 0) return undefined;
  return untrusted('context', contexts.map((entry) => `${entry.name}: ${entry.line}`).join('\n'));
}

function renderUserSection(user: ParsedEvent['user']): string | undefined {
  if (!user) return undefined;
  const line = keyValues([
    ['id', user.id],
    ['email', user.email],
  ]);
  return line ? untrusted('user', line) : undefined;
}

function renderErrorsSection(errors: readonly string[]): string | undefined {
  return errors.length === 0 ? undefined : untrusted('errors', errors.join('\n'));
}

function renderFooter(parsed: ParsedEvent): string {
  return `Full payload: get_event_json(issue_id: ${parsed.groupID}, event_id: ${parsed.id}).`;
}

/**
 * The `json` format projection (spec: "header, exceptions with in-app
 * frames, breadcrumbs"), trimmed to fit `budget`: breadcrumbs are dropped
 * one at a time (most recent kept) before the header or exceptions are ever
 * touched. Falls back to a fixed, tiny, always-valid notice only if the
 * header and exceptions alone still don't fit — never a mid-object cut that
 * would leave the JSON unparseable (review item 12).
 */
export function renderEventDetailJson(
  parsed: ParsedEvent,
  options: RenderOptions,
  budget: number,
): unknown {
  const header = projectHeader(parsed);
  const exceptions = projectExceptions(parsed.exception, options);
  let breadcrumbCount = Math.min(options.breadcrumbs, parsed.breadcrumbs.length);
  let candidate = projectDetailJson(header, exceptions, parsed.breadcrumbs, breadcrumbCount);
  while (jsonLength(candidate) > budget && breadcrumbCount > 0) {
    breadcrumbCount--;
    candidate = projectDetailJson(header, exceptions, parsed.breadcrumbs, breadcrumbCount);
  }
  return jsonLength(candidate) <= budget ? candidate : DETAIL_JSON_TRUNCATED_NOTICE;
}

function projectHeader(parsed: ParsedEvent) {
  return {
    id: parsed.id,
    dateReceived: parsed.dateReceived,
    level: parsed.level ?? null,
    platform: parsed.platform ?? null,
    release: parsed.release ?? null,
    environment: parsed.environment ?? null,
    nextEventID: parsed.nextEventID ?? null,
    previousEventID: parsed.previousEventID ?? null,
  };
}

function projectDetailJson(
  header: unknown,
  exceptions: unknown,
  breadcrumbs: readonly ParsedBreadcrumb[],
  count: number,
) {
  return {
    header,
    exceptions,
    breadcrumbs: breadcrumbs.slice(-count).map((crumb) => ({ ...crumb })),
  };
}

function jsonLength(data: unknown): number {
  return JSON.stringify(data, null, 2).length;
}

function projectExceptions(
  exception: ParsedException | undefined,
  options: RenderOptions,
): unknown {
  if (!exception) return [];
  if (!exception.recognised) return 'unrecognised';
  return [...exception.values]
    .reverse()
    .slice(0, MAX_EXCEPTION_VALUES)
    .map((value) => ({
      type: value.type ?? null,
      value: value.value ?? null,
      frames: selectDisplayFrames(value.frames).map((frame) => ({
        inApp: frame.inApp ?? null,
        function: frame.function ?? null,
        filename: frame.filename ?? null,
        lineno: frame.lineno ?? null,
        colno: frame.colno ?? null,
        contextLine:
          frame.contextLine && options.includeContext
            ? truncate(frame.contextLine, CONTEXT_LINE_LIMIT)
            : null,
      })),
    }));
}

function selectDisplayFrames(frames: readonly ParsedFrame[]): readonly ParsedFrame[] {
  const ordered = capFrames(frames);
  const anyInApp = ordered.some((frame) => frame.inApp === true);
  return anyInApp ? ordered.filter((frame) => frame.inApp) : ordered.slice(0, 5);
}
