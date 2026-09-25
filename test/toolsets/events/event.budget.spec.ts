import { describe, expect, it } from 'vitest';
import { parseEvent } from '../../../src/toolsets/events/event.parser';
import { renderEventDetailText } from '../../../src/toolsets/events/event.render';
import type { RenderOptions } from '../../../src/toolsets/events/event.types';
import { buildEvent } from '../../fixtures/events/events.fixtures';

// Acceptance 7: section-priority trimming lives here, not in the foundation's
// budget.ts (which only tail-cuts as a safety net). Breadcrumbs, then tags,
// then context are dropped in that order before the stack section is touched.

const oversizedEvent = buildEvent({
  id: 'evt-budget',
  title: 'RuntimeError: budget test',
  tags: Array.from({ length: 50 }, (_, i) => ({ key: `tag_${i}`, value: 'x'.repeat(20) })),
  contexts: {
    runtime: { name: 'CPython', version: '3.11.4' },
    os: { name: 'Linux', version: '6.1' },
    browser: { name: 'n/a', version: 'n/a' },
    device: { name: 'n/a', version: 'n/a' },
    app: { name: 'worker', version: '9.9.9' },
  },
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'RuntimeError',
            value: 'budget test',
            stacktrace: {
              frames: [{ filename: 'app/worker.py', function: 'run', lineno: 7, in_app: true }],
            },
          },
        ],
      },
    },
    {
      type: 'breadcrumbs',
      data: {
        values: Array.from({ length: 100 }, (_, i) => ({
          type: 'default',
          category: 'task',
          level: 'info',
          timestamp: `2026-01-02T03:${String(i).padStart(2, '0')}:00Z`,
          message: `breadcrumb number ${i} with some padding text`,
        })),
      },
    },
  ],
});

const OPTIONS: RenderOptions = {
  includeVars: false,
  includeContext: false,
  includeRequestHeaders: false,
  breadcrumbs: 100,
};

describe('renderEventDetailText budget trimming (acceptance 7)', () => {
  const parsed = parseEvent(oversizedEvent);

  it('keeps every section under a generous budget', () => {
    const text = renderEventDetailText(parsed, OPTIONS, 1_000_000);
    expect(text).toContain('breadcrumb number 99');
    expect(text).toContain('tag_0=');
    expect(text).toContain('runtime: CPython 3.11.4');
  });

  it('drops breadcrumbs, then tags, then context, keeping the stack intact', () => {
    const text = renderEventDetailText(parsed, OPTIONS, 300);
    expect(text).toContain('RuntimeError: budget test');
    expect(text).toContain('at run (app/worker.py:7:');
    expect(text).not.toContain('breadcrumb number');
    expect(text).not.toContain('tag_0=');
    expect(text).not.toContain('runtime: CPython');
    expect(text).toContain('Full payload: get_event_json');
    expect(text.length).toBeLessThanOrEqual(300);
  });
});
