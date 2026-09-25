import { describe, expect, it } from 'vitest';
import {
  eventDetailView,
  eventJsonView,
  eventListView,
} from '../../../src/toolsets/events/event.format';
import type { RenderOptions } from '../../../src/toolsets/events/event.types';
import {
  buildEvent,
  malformedListItem,
  pythonMixedFrames,
} from '../../fixtures/events/events.fixtures';

const FENCE = /^<untrusted source="glitchtip-event" field="payload">([\s\S]*)<\/untrusted>$/;
function unfence(text: string): unknown {
  const match = FENCE.exec(text);
  expect(match).not.toBeNull();
  return JSON.parse(match?.[1] ?? '');
}

const OPTIONS: RenderOptions = {
  includeVars: false,
  includeContext: false,
  includeRequestHeaders: false,
  breadcrumbs: 10,
};
const HUGE_BUDGET = 1_000_000;

describe('eventListView — null title/tags (review 9)', () => {
  it('falls back instead of throwing when title/tags arrive as null', () => {
    const page = { items: [malformedListItem], nextCursor: undefined };
    expect(() => eventListView(page, { includeGroupId: false }, HUGE_BUDGET)).not.toThrow();
    const view = eventListView(page, { includeGroupId: false }, HUGE_BUDGET);
    const text = view.text();
    expect(text).toContain('(no title)');
  });

  it('fences title and release/environment together, once per row (review 5)', () => {
    const page = {
      items: [
        {
          id: 'evt-1',
          eventID: 'a',
          projectID: 1,
          groupID: 'grp-1',
          dateCreated: 'x',
          dateReceived: '2026-01-02T03:04:06Z',
          type: 'error',
          message: '',
          tags: [{ key: 'release', value: '1.0' }],
          title: 'boom',
          entries: [],
        },
      ],
      nextCursor: undefined,
    };
    const text = eventListView(page, { includeGroupId: false }, HUGE_BUDGET).text();
    expect(text.match(/<untrusted /g)).toHaveLength(1);
    expect(text).toContain('release=1.0');
  });
});

// Final ruling (orchestrator, on review item 6): format: "json" returns the
// projected/redacted object unfenced — JSON.parse of the tool's own output
// must succeed with an object/array at the top level. The fence stays only
// on text output; fencing JSON output moves to the foundation
// (BUG-20260925-006), not this toolset's job.
describe('format: "json" is unfenced, parseable JSON (review 6, final ruling)', () => {
  it('eventJsonView.json() is the redacted object itself, no fence, redaction still holds', () => {
    const raw = { title: 'boom', user: { id: '1', ip_address: '203.0.113.9' } };
    const view = eventJsonView(raw, undefined, HUGE_BUDGET);
    const json = view.json() as { user: Record<string, unknown> };
    expect(json.user.ip_address).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('<untrusted');
  });

  it('eventJsonView.text() keeps the payload fence', () => {
    const view = eventJsonView({ title: 'boom' }, undefined, HUGE_BUDGET);
    expect(view.text()).toMatch(FENCE);
  });

  it('eventDetailView.json() is a plain object, top level unfenced', () => {
    const view = eventDetailView(pythonMixedFrames, OPTIONS, HUGE_BUDGET);
    const json = view.json() as { header: { id: string } };
    expect(json.header.id).toBe('evt-python');
    expect(JSON.stringify(json)).not.toContain('<untrusted');
  });

  it('eventListView.json() is a plain object with an events array, top level unfenced', () => {
    const page = { items: [], nextCursor: undefined };
    const view = eventListView(page, { includeGroupId: false }, HUGE_BUDGET);
    const json = view.json() as { events: unknown[] };
    expect(Array.isArray(json.events)).toBe(true);
    expect(JSON.stringify(json)).not.toContain('<untrusted');
  });
});

describe('JSON results degrade to a truncated notice, never a mid-cut (review 12)', () => {
  const withManyBreadcrumbs = buildEvent({
    id: 'evt-many-crumbs',
    title: 'boom',
    entries: [
      {
        type: 'breadcrumbs',
        data: {
          values: Array.from({ length: 100 }, (_, i) => ({
            type: 'default',
            category: 'task',
            level: 'info',
            message: `breadcrumb ${i} ${'x'.repeat(200)}`,
          })),
        },
      },
    ],
  });

  it('eventDetailView.json() with 100 large breadcrumbs at budget 20000 keeps header and exceptions, drops breadcrumbs to fit (review 1)', () => {
    const view = eventDetailView(withManyBreadcrumbs, { ...OPTIONS, breadcrumbs: 100 }, 20_000);
    const json = view.json() as {
      header: { id: string };
      exceptions: unknown[];
      breadcrumbs: unknown[];
    };
    expect(json.header.id).toBe('evt-many-crumbs');
    expect(Array.isArray(json.exceptions)).toBe(true);
    expect(json.breadcrumbs.length).toBeLessThan(100);
    expect(() => JSON.parse(JSON.stringify(json))).not.toThrow();
  });

  it('eventDetailView.json() falls back to a path-free hint only once even 0 breadcrumbs is too big (review 1)', () => {
    const view = eventDetailView(withManyBreadcrumbs, { ...OPTIONS, breadcrumbs: 100 }, 50);
    expect(view.json()).toEqual({
      truncated: true,
      hint: 'reduce breadcrumbs or use get_event_json with path',
    });
    // JSON.parse(JSON.stringify(...)) is what ToolOutput's format: "json" path does.
    expect(() => JSON.parse(JSON.stringify(view.json()))).not.toThrow();
  });

  it('eventJsonView.json() degrades the same way at a tiny budget', () => {
    const raw = { entries: Array.from({ length: 500 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) };
    const view = eventJsonView(raw, undefined, 500);
    expect(view.json()).toEqual({ truncated: true, hint: 'use path to select part of the event' });
  });

  it('eventJsonView.text() degrades to a fenced notice at a tiny budget', () => {
    const raw = { entries: Array.from({ length: 500 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) };
    const view = eventJsonView(raw, undefined, 500);
    expect(unfence(view.text())).toEqual({
      truncated: true,
      hint: 'use path to select part of the event',
    });
  });
});
