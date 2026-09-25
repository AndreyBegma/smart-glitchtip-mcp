import { keyValues } from '../../format/table';
import { untrusted } from '../../format/untrusted';
import { truncate } from './event.guards';
import { redactHeaderPairs } from './event.redact';
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
/** Sections dropped, in this order, before the foundation's tail-cut budget runs (spec AC7). */
const DROPPABLE_SECTIONS = ['breadcrumbs', 'tags', 'context'] as const;

interface Section {
  readonly key: string;
  readonly text: string;
}

/** The full text rendering, trimmed section-by-section to fit `budget` (spec AC7). */
export function renderEventDetailText(
  parsed: ParsedEvent,
  options: RenderOptions,
  budget: number,
): string {
  const sections = buildSections(parsed, options);
  let active = sections;
  for (const key of DROPPABLE_SECTIONS) {
    if (assemble(active).length <= budget) break;
    active = active.filter((section) => section.key !== key);
  }
  return assemble(active);
}

function assemble(sections: readonly Section[]): string {
  return sections.map((section) => section.text).join('\n\n');
}

function buildSections(parsed: ParsedEvent, options: RenderOptions): readonly Section[] {
  const candidates: ReadonlyArray<readonly [string, string | undefined]> = [
    ['header', renderHeader(parsed)],
    ['exception', renderExceptionSection(parsed.exception, options)],
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

function renderHeader(parsed: ParsedEvent): string {
  return keyValues([
    ['event id', parsed.id],
    ['date received', parsed.dateReceived],
    ['level', parsed.level],
    ['platform', parsed.platform],
    ['release', parsed.release],
    ['environment', parsed.environment],
    ['next event', parsed.nextEventID],
    ['previous event', parsed.previousEventID],
  ]);
}

function renderExceptionSection(
  exception: ParsedException | undefined,
  options: RenderOptions,
): string | undefined {
  if (!exception) return undefined;
  if (!exception.recognised) {
    return 'exception data in an unrecognised shape — use get_event_json';
  }
  const blocks = [...exception.values]
    .reverse()
    .map((value) => renderExceptionValue(value, options));
  return untrusted('exception', blocks.join('\n\n'));
}

function renderExceptionValue(value: ParsedExceptionValue, options: RenderOptions): string {
  const heading = `${value.type ?? 'Error'}: ${value.value ?? ''}`.trim();
  return [heading, ...renderFrameLines(value.frames, options)].join('\n');
}

/** Most-recent-call-first, in-app frames kept, library runs collapsed (spec "The event renderer"). */
function renderFrameLines(frames: readonly ParsedFrame[], options: RenderOptions): string[] {
  const ordered = [...frames].reverse();
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

function renderFrame(frame: ParsedFrame, options: RenderOptions): string[] {
  const location = `${frame.filename ?? frame.module ?? '?'}:${frame.lineno ?? '?'}:${frame.colno ?? '?'}`;
  const lines = [`  at ${frame.function ?? '?'} (${location})`];
  if (frame.contextLine) lines.push(`    ${truncate(frame.contextLine, CONTEXT_LINE_LIMIT)}`);
  if (options.includeContext) {
    for (const line of [...(frame.preContext ?? []), ...(frame.postContext ?? [])]) {
      lines.push(`    ${line}`);
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
  return typeof value === 'string' ? value : JSON.stringify(value);
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
  const summary = [request.method, request.url]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  if (summary) lines.push(summary);
  if (request.query) lines.push(`query: ${request.query}`);
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

/** The `json` format projection (spec: "header, exceptions with in-app frames, breadcrumbs"). */
export function renderEventDetailJson(parsed: ParsedEvent, options: RenderOptions): unknown {
  return {
    header: {
      id: parsed.id,
      dateReceived: parsed.dateReceived,
      level: parsed.level ?? null,
      platform: parsed.platform ?? null,
      release: parsed.release ?? null,
      environment: parsed.environment ?? null,
      nextEventID: parsed.nextEventID ?? null,
      previousEventID: parsed.previousEventID ?? null,
    },
    exceptions: projectExceptions(parsed.exception, options),
    breadcrumbs: parsed.breadcrumbs.slice(-options.breadcrumbs).map((crumb) => ({ ...crumb })),
  };
}

function projectExceptions(
  exception: ParsedException | undefined,
  options: RenderOptions,
): unknown {
  if (!exception) return [];
  if (!exception.recognised) return 'unrecognised';
  return [...exception.values].reverse().map((value) => ({
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
  const ordered = [...frames].reverse();
  const anyInApp = ordered.some((frame) => frame.inApp === true);
  return anyInApp ? ordered.filter((frame) => frame.inApp) : ordered.slice(0, 5);
}
