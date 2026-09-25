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

describe('every JSON result is one payload fence (review 6)', () => {
  it('eventJsonView: text and json are identical, and unfence()ing yields the redacted document', () => {
    const raw = { title: 'boom', user: { id: '1', ip_address: '203.0.113.9' } };
    const view = eventJsonView(raw, undefined, HUGE_BUDGET);
    expect(view.text()).toBe(view.json());
    const unfenced = unfence(view.text()) as { user: Record<string, unknown> };
    expect(unfenced.user.ip_address).toBeUndefined();
  });

  it('eventDetailView.json(): fenced, and the JSON inside stays valid', () => {
    const view = eventDetailView(pythonMixedFrames, OPTIONS, HUGE_BUDGET);
    const unfenced = unfence(view.json() as string) as { header: { id: string } };
    expect(unfenced.header.id).toBe('evt-python');
  });

  it('eventListView.json(): fenced, and the JSON inside stays valid', () => {
    const page = { items: [], nextCursor: undefined };
    const view = eventListView(page, { includeGroupId: false }, HUGE_BUDGET);
    const unfenced = unfence(view.json() as string) as { events: unknown[] };
    expect(unfenced.events).toEqual([]);
  });
});

describe('JSON results degrade to a truncated notice, never a mid-cut (review 12)', () => {
  it('eventDetailView.json() with 100 large breadcrumbs at a tiny budget still parses as JSON', () => {
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
    const view = eventDetailView(withManyBreadcrumbs, { ...OPTIONS, breadcrumbs: 100 }, 500);
    const text = view.json() as string;
    expect(() => unfence(text)).not.toThrow();
    expect(unfence(text)).toEqual({
      truncated: true,
      hint: 'use path to select part of the event',
    });
  });

  it('eventJsonView degrades the same way at a tiny budget', () => {
    const raw = { entries: Array.from({ length: 500 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) };
    const view = eventJsonView(raw, undefined, 500);
    expect(() => unfence(view.text())).not.toThrow();
    expect(unfence(view.text())).toEqual({
      truncated: true,
      hint: 'use path to select part of the event',
    });
  });
});
