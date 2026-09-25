import { withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';
import { asString, truncate } from './event.guards';
import { parseEvent, parseTags } from './event.parser';
import { applyJsonPointer } from './event.pointer';
import { redactEventPayload } from './event.redact';
import { renderEventDetailJson, renderEventDetailText } from './event.render';
import type { RenderOptions } from './event.types';

type EventListItem = components['schemas']['IssueEventSchema'];
type EventDetail = components['schemas']['IssueEventDetailSchema'];

const TITLE_LIMIT = 120;
/** What a JSON result returns instead of a corrupt, mid-object tail cut. */
const TRUNCATED_NOTICE = { truncated: true, hint: 'use path to select part of the event' };

interface ListRow {
  readonly id: string;
  readonly dateReceived: string;
  readonly title: string;
  readonly release?: string;
  readonly environment?: string;
  readonly groupID: string;
}

/**
 * `list_issue_events` / `list_project_events`: one line per event. Title and
 * release/environment are event-originated (D-18) and fenced together, once
 * per row, not with the shared `table()` helper, whose 80-character cell
 * limit would cut a fence mid-tag.
 */
export function eventListView(
  page: Page<EventListItem>,
  options: { includeGroupId: boolean },
  budget: number,
): View {
  const rows = page.items.map(toListRow);
  return {
    untrusted: { field: 'payload', source: 'glitchtip-event' },
    text: () => {
      if (rows.length === 0) return 'No events found.';
      const lines = rows.map((row) => renderListLine(row, options.includeGroupId));
      return withCursor(lines.join('\n'), page.nextCursor);
    },
    json: () =>
      boundedJson(
        {
          events: rows.map((row) => ({
            id: row.id,
            dateReceived: row.dateReceived,
            title: row.title,
            release: row.release ?? null,
            environment: row.environment ?? null,
            ...(options.includeGroupId ? { issueId: row.groupID } : {}),
          })),
          nextCursor: page.nextCursor ?? null,
        },
        budget,
      ),
  };
}

/** `id`/`dateReceived`/`title` are typed as always present; a real payload may still send `null`. */
function toListRow(event: EventListItem): ListRow {
  const byKey = new Map(parseTags(event.tags).map((tag) => [tag.key, tag.value]));
  return {
    id: asString(event.id) ?? '?',
    dateReceived: asString(event.dateReceived) ?? '',
    title: asString(event.title) ?? '(no title)',
    release: byKey.get('release'),
    environment: byKey.get('environment'),
    groupID: asString(event.groupID) ?? '?',
  };
}

function renderListLine(row: ListRow, includeGroupId: boolean): string {
  const tagSuffix = [
    row.release ? `release=${row.release}` : undefined,
    row.environment ? `environment=${row.environment}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
  const eventPart = [truncate(row.title, TITLE_LIMIT), tagSuffix]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return [
    row.id,
    day(row.dateReceived),
    includeGroupId ? `issue=${row.groupID}` : undefined,
    untrusted('event', eventPart),
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('  ');
}

/**
 * `get_latest_event` / `get_event` / `get_project_event`. `json()` is
 * already bounded by `renderEventDetailJson` itself (it drops breadcrumbs
 * before falling back to a notice, review item 1), so it isn't wrapped in
 * `boundedJson` again here.
 */
export function eventDetailView(event: EventDetail, options: RenderOptions, budget: number): View {
  const parsed = parseEvent(event);
  return {
    untrusted: { field: 'payload', source: 'glitchtip-event' },
    text: () => renderEventDetailText(parsed, options, budget),
    json: () => renderEventDetailJson(parsed, options, budget),
  };
}

/**
 * `get_event_json`: the redacted raw payload (D-20), optionally narrowed by
 * a JSON Pointer. The `text` result is fenced (D-18); `format: "json"`
 * returns the object itself, unfenced, so it parses cleanly — fencing JSON
 * output is the foundation's job (BUG-20260925-006), not this toolset's.
 */
export function eventJsonView(raw: unknown, pointer: string | undefined, budget: number): View {
  const redacted = redactEventPayload(raw);
  const selected = pointer === undefined ? redacted : applyJsonPointer(redacted, pointer);
  return {
    untrusted: { field: 'payload', source: 'glitchtip-event' },
    text: () => boundedText(selected, budget),
    json: () => boundedJson(selected, budget),
  };
}

/** The fenced text form (D-18), degrading to a fenced notice rather than a mid-JSON tail cut. */
function boundedText(data: unknown, budget: number): string {
  const full = untrusted('payload', JSON.stringify(data, null, 2));
  if (full.length <= budget) return full;
  return untrusted('payload', JSON.stringify(TRUNCATED_NOTICE, null, 2));
}

/**
 * The `json` format: the object itself (never fenced — `ToolOutput`
 * `JSON.stringify`s it, and a fence around that would only be valid once
 * escaped, i.e. not really a fence). Degrades to a fixed, tiny, always-valid
 * notice instead of a mid-object tail cut that would leave the JSON
 * unparseable (spec AC7's "stack intact" concern, applied to JSON output).
 */
function boundedJson(data: unknown, budget: number): unknown {
  const pretty = JSON.stringify(data, null, 2);
  return pretty.length <= budget ? data : TRUNCATED_NOTICE;
}

function day(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}
