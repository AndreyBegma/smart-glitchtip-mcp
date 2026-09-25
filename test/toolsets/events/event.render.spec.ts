import { describe, expect, it } from 'vitest';
import { parseEvent } from '../../../src/toolsets/events/event.parser';
import {
  renderEventDetailJson,
  renderEventDetailText,
} from '../../../src/toolsets/events/event.render';
import type { RenderOptions } from '../../../src/toolsets/events/event.types';
import {
  buildEvent,
  chainedException,
  fullySectionedEvent,
  jsNoInAppFrames,
  malformedVars,
  messageOnly,
  pythonMixedFrames,
  unknownExceptionShape,
  untrustedFrameEscape,
} from '../../fixtures/events/events.fixtures';

// Acceptance 3, 4, 5, 7, 8: the renderer against each required fixture shape.

const DEFAULT_OPTIONS: RenderOptions = {
  includeVars: false,
  includeContext: false,
  includeRequestHeaders: false,
  breadcrumbs: 10,
};

const HUGE_BUDGET = 1_000_000;

function render(
  event: Parameters<typeof parseEvent>[0],
  options = DEFAULT_OPTIONS,
  budget = HUGE_BUDGET,
) {
  return renderEventDetailText(parseEvent(event), options, budget);
}

describe('exception chain (acceptance 3)', () => {
  it('orders frames most-recent-call first and collapses consecutive library frames', () => {
    const text = render(pythonMixedFrames);
    const computeIndex = text.indexOf('at compute');
    const myViewIndex = text.indexOf('at my_view');
    const collapseIndex = text.indexOf('… 2 library frames …');
    expect(computeIndex).toBeGreaterThan(-1);
    expect(myViewIndex).toBeGreaterThan(computeIndex);
    expect(collapseIndex).toBeGreaterThan(myViewIndex);
    expect(text).not.toContain('at get_response');
    expect(text).not.toContain('at _get_response');
  });

  it('falls back to the 5 most recent frames when nothing is in_app', () => {
    const text = render(jsNoInAppFrames);
    expect(text).toContain('at bundled_6');
    expect(text).toContain('at bundled_2');
    expect(text).not.toContain('at bundled_1');
    expect(text).not.toContain('at bundled_0');
    expect(text.match(/at bundled_/g)).toHaveLength(5);
  });

  it('orders a chained exception most-recent value first', () => {
    const text = render(chainedException);
    const serviceIndex = text.indexOf('ServiceError: upstream failed');
    const connectionIndex = text.indexOf('ConnectionError: connection refused');
    expect(serviceIndex).toBeGreaterThan(-1);
    expect(connectionIndex).toBeGreaterThan(serviceIndex);
  });

  it('shows a fallback note for an unrecognised exception shape, never a crash', () => {
    const text = render(unknownExceptionShape);
    expect(text).toContain('exception data in an unrecognised shape — use get_event_json');
  });

  it('omits the exception section for a message-only event', () => {
    const text = render(messageOnly);
    expect(text).not.toContain('unrecognised shape');
    expect(text).toContain('Queue depth crossed threshold: 512 items');
  });
});

describe('renderer options (acceptance 4)', () => {
  it('omits vars, context and request headers by default', () => {
    const text = render(fullySectionedEvent);
    expect(text).not.toContain('vars:');
    expect(text).not.toContain('Cookie');
    expect(text).not.toContain('Authorization');
  });

  it('include_vars adds local variables, cut to 200 characters', () => {
    const text = render(pythonMixedFrames, { ...DEFAULT_OPTIONS, includeVars: true });
    expect(text).toContain('vars:');
    expect(text).toContain('x=1');
    const varsLine = text.split('\n').find((line) => line.includes('vars:'));
    expect(varsLine?.length).toBeLessThan(260);
  });

  it('include_context adds the surrounding source lines', () => {
    const text = render(pythonMixedFrames, { ...DEFAULT_OPTIONS, includeContext: true });
    expect(text).toContain('def my_view(request):');
    expect(text).toContain('return result');
  });

  it('include_request_headers adds headers, with Cookie and Authorization redacted', () => {
    const text = render(fullySectionedEvent, { ...DEFAULT_OPTIONS, includeRequestHeaders: true });
    expect(text).toContain('User-Agent: worker/1.0');
    expect(text).toContain('Cookie: [redacted]');
    expect(text).toContain('Authorization: [redacted]');
    expect(text).not.toContain('session=secret');
    expect(text).not.toContain('token-value');
  });
});

describe('sections (acceptance 5)', () => {
  it('renders breadcrumbs, tags, context, user and errors when present', () => {
    const text = render(fullySectionedEvent);
    expect(text).toContain('picked up job 42');
    expect(text).toContain('release=2.0.0');
    expect(text).toContain('runtime: CPython 3.11.4');
    expect(text).toContain('id: 42');
    expect(text).toContain('email: user@example.com');
    expect(text).toContain('ProcessingError');
  });

  it('never shows user IP address or geo (there is no field for either on this schema)', () => {
    const text = render(fullySectionedEvent);
    expect(text).not.toContain('ip_address');
    expect(text).not.toContain('geo');
  });
});

describe('untrusted content (acceptance 8)', () => {
  it('escapes a context line that carries a closing fence', () => {
    const text = render(untrustedFrameEscape);
    // Two real fences (header, exception): the payload's own "</untrusted>"
    // must not have added a third, unbalanced close.
    const opens = text.match(/<untrusted /g) ?? [];
    const closes = text.match(/<\/untrusted>/g) ?? [];
    expect(opens).toHaveLength(2);
    expect(closes).toHaveLength(2);
    expect(text).toContain('&lt;/untrusted>');
  });
});

describe('json format (acceptance 4)', () => {
  it('projects header, exceptions with in-app frames, and breadcrumbs — not the raw payload', () => {
    const projected = renderEventDetailJson(parseEvent(pythonMixedFrames), DEFAULT_OPTIONS) as {
      header: { id: string };
      exceptions: { frames: { inApp: boolean | null }[] }[];
    };
    expect(projected.header.id).toBe('evt-python');
    expect(projected.exceptions[0].frames).toHaveLength(2);
    expect(projected.exceptions[0].frames.every((frame) => frame.inApp === true)).toBe(true);
  });
});

describe('header fencing (review 5)', () => {
  it('fences the header, which carries event-reported release/environment/platform/level', () => {
    const text = render(fullySectionedEvent);
    const header =
      /<untrusted source="glitchtip-event" field="header">([\s\S]*?)<\/untrusted>/.exec(text);
    expect(header).not.toBeNull();
    expect(header?.[1]).toContain('release: 2.0.0');
    expect(header?.[1]).toContain('environment: staging');
  });
});

describe('fence-safe truncation (review 7)', () => {
  it('closes every open fence before the truncation marker when the core still overflows', () => {
    const bigValue = (n: number) => `V${n}-${'x'.repeat(900)}`;
    const manyValues = buildEvent({
      id: 'evt-huge-chain',
      title: 'ChainedError: overloaded',
      entries: [
        {
          type: 'exception',
          data: {
            values: [0, 1, 2].map((n) => ({
              type: 'Error',
              value: bigValue(n),
              stacktrace: {
                frames: [{ filename: `app/${n}.py`, function: `f${n}`, lineno: 1, in_app: true }],
              },
            })),
          },
        },
      ],
    });
    const text = render(manyValues, DEFAULT_OPTIONS, 1200);
    const opens = text.match(/<untrusted /g) ?? [];
    const closes = text.match(/<\/untrusted>/g) ?? [];
    expect(opens.length).toBe(closes.length);
    expect(text).toContain('truncated for budget');
  });
});

describe('unserialisable vars (review 10)', () => {
  it('degrades a var that cannot be JSON.stringify-d instead of throwing', () => {
    expect(() => render(malformedVars, { ...DEFAULT_OPTIONS, includeVars: true })).not.toThrow();
    const text = render(malformedVars, { ...DEFAULT_OPTIONS, includeVars: true });
    expect(text).toContain('ok=fine');
    expect(text).toContain('circular=[unserialisable]');
  });
});

describe('exception value capping (review 11)', () => {
  it('caps a huge exception value and still keeps the header and the top frame at a tight budget', () => {
    const huge = buildEvent({
      id: 'evt-huge-value',
      title: 'MemoryError: huge',
      entries: [
        {
          type: 'exception',
          data: {
            values: [
              {
                type: 'MemoryError',
                value: 'x'.repeat(50_000),
                stacktrace: {
                  frames: [{ filename: 'app.py', function: 'allocate', lineno: 1, in_app: true }],
                },
              },
            ],
          },
        },
      ],
    });
    const text = render(huge, DEFAULT_OPTIONS, 2000);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain('evt-huge-value');
    expect(text).toContain('at allocate (app.py:1');
  });
});

describe('breadcrumb/message capping (review 13)', () => {
  it('caps an oversized breadcrumb message', () => {
    const huge = buildEvent({
      id: 'evt-huge-breadcrumb',
      entries: [
        {
          type: 'breadcrumbs',
          data: {
            values: [
              { type: 'default', category: 'log', level: 'info', message: 'z'.repeat(5000) },
            ],
          },
        },
      ],
    });
    const text = render(huge, { ...DEFAULT_OPTIONS, breadcrumbs: 10 });
    const line = text.split('\n').find((l) => l.includes('log:'));
    expect(line?.length).toBeLessThan(400);
  });

  it('caps an oversized Message section', () => {
    const huge = buildEvent({
      id: 'evt-huge-message',
      entries: [{ type: 'message', data: { formatted: 'm'.repeat(50_000) } }],
    });
    const text = render(huge);
    expect(text.length).toBeLessThan(3000);
  });
});
