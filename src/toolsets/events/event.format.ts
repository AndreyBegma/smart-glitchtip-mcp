import { withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';
import { truncate } from './event.guards';
import { parseEvent, parseTags } from './event.parser';
import { applyJsonPointer } from './event.pointer';
import { redactEventPayload } from './event.redact';
import { renderEventDetailJson, renderEventDetailText } from './event.render';
import type { RenderOptions } from './event.types';

type EventListItem = components['schemas']['IssueEventSchema'];
type EventDetail = components['schemas']['IssueEventDetailSchema'];

const TITLE_LIMIT = 120;

interface ListRow {
  readonly id: string;
  readonly dateReceived: string;
  readonly title: string;
  readonly release?: string;
  readonly environment?: string;
  readonly groupID: string;
}

/**
 * `list_issue_events` / `list_project_events`: one line per event. Titles are
 * event-originated (D-18) and fenced individually, not with the shared
 * `table()` helper, whose 80-character cell limit would cut a fence mid-tag.
 */
export function eventListView(
  page: Page<EventListItem>,
  options: { includeGroupId: boolean },
): View {
  const rows = page.items.map(toListRow);
  return {
    text: () => {
      if (rows.length === 0) return 'No events found.';
      const lines = rows.map((row) => renderListLine(row, options.includeGroupId));
      return withCursor(lines.join('\n'), page.nextCursor);
    },
    json: () => ({
      events: rows.map((row) => ({
        id: row.id,
        dateReceived: row.dateReceived,
        title: row.title,
        release: row.release ?? null,
        environment: row.environment ?? null,
        ...(options.includeGroupId ? { issueId: row.groupID } : {}),
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

function toListRow(event: EventListItem): ListRow {
  const byKey = new Map(parseTags(event.tags).map((tag) => [tag.key, tag.value]));
  return {
    id: event.id,
    dateReceived: event.dateReceived,
    title: event.title,
    release: byKey.get('release'),
    environment: byKey.get('environment'),
    groupID: event.groupID,
  };
}

function renderListLine(row: ListRow, includeGroupId: boolean): string {
  const tagSuffix = [
    row.release ? `release=${row.release}` : undefined,
    row.environment ? `environment=${row.environment}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
  return [
    row.id,
    day(row.dateReceived),
    includeGroupId ? `issue=${row.groupID}` : undefined,
    untrusted('title', truncate(row.title, TITLE_LIMIT)),
    tagSuffix || undefined,
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('  ');
}

/** `get_latest_event` / `get_event` / `get_project_event`. */
export function eventDetailView(event: EventDetail, options: RenderOptions, budget: number): View {
  const parsed = parseEvent(event);
  return {
    text: () => renderEventDetailText(parsed, options, budget),
    json: () => renderEventDetailJson(parsed, options),
  };
}

/** `get_event_json`: the redacted raw payload (D-20), optionally narrowed by a JSON Pointer. */
export function eventJsonView(raw: unknown, pointer: string | undefined): View {
  const redacted = redactEventPayload(raw);
  const selected = pointer === undefined ? redacted : applyJsonPointer(redacted, pointer);
  return {
    text: () => JSON.stringify(selected, null, 2),
    json: () => selected,
  };
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
