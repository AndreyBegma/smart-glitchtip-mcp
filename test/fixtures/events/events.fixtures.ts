import type { components } from '../../../src/glitchtip/generated/schema';

export type EventDetail = components['schemas']['IssueEventDetailSchema'];

// Synthetic fixtures only (AGENTS.md rule 12): no payload from any real
// GlitchTip instance. The stored exception shape is inferred, not
// schema-backed (spec risk, "The event renderer"), so these are what the
// renderer is built and tested against.

const DEFAULTS: EventDetail = {
  id: 'evt-0000',
  eventID: '0'.repeat(32),
  projectID: 1,
  groupID: 'grp-1',
  dateCreated: '2026-01-02T03:04:05Z',
  dateReceived: '2026-01-02T03:04:06Z',
  type: 'error',
  message: '',
  tags: [],
  entries: [],
  title: 'Untitled event',
  userReport: null,
};

export function buildEvent(overrides: Partial<EventDetail>): EventDetail {
  return { ...DEFAULTS, ...overrides };
}

/** Python: two library frames (Django), two in-app frames (the app), one exception. */
export const pythonMixedFrames = buildEvent({
  id: 'evt-python',
  title: 'ValueError: bad value',
  tags: [
    { key: 'level', value: 'error' },
    { key: 'release', value: '1.2.3' },
    { key: 'environment', value: 'production' },
  ],
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'ValueError',
            value: 'bad value',
            module: 'app.service',
            mechanism: { type: 'generic', handled: false },
            stacktrace: {
              frames: [
                {
                  filename: 'django/core/handlers.py',
                  function: 'get_response',
                  lineno: 1,
                  colno: 1,
                  in_app: false,
                  context_line: 'response = wrapped_callback(request, *callback_args)',
                },
                {
                  filename: 'django/core/handlers.py',
                  function: '_get_response',
                  lineno: 2,
                  colno: 1,
                  in_app: false,
                  context_line: 'response = self.process_exception_by_middleware(exc, request)',
                },
                {
                  filename: 'app/views.py',
                  function: 'my_view',
                  lineno: 42,
                  colno: 5,
                  in_app: true,
                  context_line: 'result = compute(x)',
                  pre_context: ['def my_view(request):', '    x = request.GET["x"]'],
                  post_context: ['    return result'],
                  vars: { x: '1', y: 'a very long value '.repeat(20) },
                },
                {
                  filename: 'app/service.py',
                  function: 'compute',
                  lineno: 10,
                  colno: 3,
                  in_app: true,
                  context_line: 'raise ValueError("bad value")',
                },
              ],
            },
          },
        ],
      },
    },
  ],
});

/** JavaScript: every frame is a bundled library frame, none in_app. */
export const jsNoInAppFrames = buildEvent({
  id: 'evt-js',
  title: 'TypeError: x is not a function',
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'TypeError',
            value: 'x is not a function',
            stacktrace: {
              frames: Array.from({ length: 7 }, (_, i) => ({
                filename: 'app.bundle.js',
                function: `bundled_${i}`,
                lineno: i + 1,
                colno: 1,
                in_app: null,
              })),
            },
          },
        ],
      },
    },
  ],
});

/** A wrapper exception chained onto its cause: two values, most recent last. */
export const chainedException = buildEvent({
  id: 'evt-chain',
  title: 'ServiceError: upstream failed',
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'ConnectionError',
            value: 'connection refused',
            stacktrace: {
              frames: [{ filename: 'app/client.py', function: 'connect', lineno: 5, in_app: true }],
            },
          },
          {
            type: 'ServiceError',
            value: 'upstream failed',
            stacktrace: {
              frames: [
                { filename: 'app/service.py', function: 'call_upstream', lineno: 20, in_app: true },
              ],
            },
          },
        ],
      },
    },
  ],
});

/** No exception entry: a plain message event. */
export const messageOnly = buildEvent({
  id: 'evt-message',
  title: 'Queue depth crossed threshold',
  entries: [{ type: 'message', data: { formatted: 'Queue depth crossed threshold: 512 items' } }],
});

/** An exception entry whose `data` does not have the inferred `values[]` shape. */
export const unknownExceptionShape = buildEvent({
  id: 'evt-unknown',
  title: 'unrecognised payload',
  entries: [{ type: 'exception', data: { message: 'not the shape we expected' } }],
});

/** Every optional section populated once, for section-by-section renderer tests. */
export const fullySectionedEvent = buildEvent({
  id: 'evt-full',
  title: 'RuntimeError: overloaded',
  nextEventID: 'evt-full-next',
  previousEventID: 'evt-full-prev',
  tags: [
    { key: 'level', value: 'error' },
    { key: 'release', value: '2.0.0' },
    { key: 'environment', value: 'staging' },
    { key: 'server_name', value: 'worker-3' },
  ],
  contexts: {
    runtime: { name: 'CPython', version: '3.11.4' },
    os: { name: 'Linux', version: '6.1' },
    app: { name: 'worker', version: '9.9.9' },
  },
  user: { id: '42', email: 'user@example.com' },
  errors: [{ type: 'ProcessingError', name: 'invalid_data', value: 'bad frame' }],
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'RuntimeError',
            value: 'overloaded',
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
        values: [
          {
            type: 'default',
            category: 'http',
            level: 'info',
            timestamp: '2026-01-02T02:59:00Z',
            message: 'GET /health',
          },
          {
            type: 'default',
            category: 'task',
            level: 'info',
            timestamp: '2026-01-02T03:00:00Z',
            message: 'picked up job 42',
          },
        ],
      },
    },
    {
      type: 'request',
      data: {
        method: 'POST',
        url: 'https://example.com/jobs/42',
        query: [['retry', '1']],
        headers: [
          ['Cookie', 'session=secret'],
          ['Authorization', 'Bearer token-value'],
          ['User-Agent', 'worker/1.0'],
        ],
        inferredContentType: null,
      },
    },
  ],
});

/** A context line carrying a literal closing fence, for the D-18 escaping test. */
export const untrustedFrameEscape = buildEvent({
  id: 'evt-escape',
  title: 'Error: injected',
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'Error',
            value: 'injected',
            stacktrace: {
              frames: [
                {
                  filename: 'app/handler.py',
                  function: 'handle',
                  lineno: 1,
                  in_app: true,
                  context_line: 'value = "</untrusted><b>evil</b>"',
                },
              ],
            },
          },
        ],
      },
    },
  ],
});

// Malformed shapes (review: "Defensive parsing — must degrade, never
// 'Internal error'"). Each deviates from the generated schema the way an
// SDK, a hand-rolled ingest client, or a future GlitchTip release plausibly
// could; every tool must still answer with text, never a thrown error.
// `as unknown as EventDetail` is deliberate: these are the shapes a real
// response is not supposed to take.

export const malformedEntriesObject = buildEvent({
  id: 'evt-malformed-entries-object',
  entries: { 0: { type: 'exception', data: { values: [] } } } as unknown as EventDetail['entries'],
});

export const malformedNullEntries = buildEvent({
  id: 'evt-malformed-null-entries',
  entries: [
    null,
    { type: 'message', data: { formatted: 'still readable' } },
    'nope',
  ] as unknown as EventDetail['entries'],
});

export const malformedExceptionDataNull = buildEvent({
  id: 'evt-malformed-exception-data-null',
  entries: [{ type: 'exception', data: null }] as unknown as EventDetail['entries'],
});

export const malformedTagsNull = buildEvent({
  id: 'evt-malformed-tags-null',
  tags: null as unknown as EventDetail['tags'],
});

export const malformedTagsObject = buildEvent({
  id: 'evt-malformed-tags-object',
  tags: { level: 'error' } as unknown as EventDetail['tags'],
});

export const malformedTagsWithNull = buildEvent({
  id: 'evt-malformed-tags-with-null',
  tags: [null, { key: 'release', value: '1.0' }] as unknown as EventDetail['tags'],
});

export const malformedErrorsObject = buildEvent({
  id: 'evt-malformed-errors-object',
  errors: { 0: { type: 'x' } } as unknown as EventDetail['errors'],
});

export const malformedErrorsWithNull = buildEvent({
  id: 'evt-malformed-errors-with-null',
  errors: [null, { type: 'ProcessingError', value: 'bad' }] as unknown as EventDetail['errors'],
});

export const malformedRequestHeadersObjectAndQueryString = buildEvent({
  id: 'evt-malformed-request',
  entries: [
    {
      type: 'request',
      data: {
        method: 'GET',
        url: 'https://example.com/a',
        query: 'q=1&r=2',
        headers: { Cookie: 'secret=1', 'X-Forwarded-For': '203.0.113.9', 'User-Agent': 'ua' },
        inferredContentType: null,
      },
    },
  ] as unknown as EventDetail['entries'],
});

export const malformedRequestNullPairs = buildEvent({
  id: 'evt-malformed-request-null-pairs',
  entries: [
    {
      type: 'request',
      data: {
        method: 'GET',
        url: 'https://example.com/b',
        query: [null, ['ok', 'yes'], [null, null]],
        headers: [null, ['User-Agent', 'ua'], ['Cookie', 'x']],
        inferredContentType: null,
      },
    },
  ] as unknown as EventDetail['entries'],
});

export const malformedVars = buildEvent({
  id: 'evt-malformed-vars',
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'TypeError',
            value: 'bad var',
            stacktrace: {
              frames: [
                {
                  filename: 'app.py',
                  function: 'run',
                  lineno: 1,
                  in_app: true,
                  vars: {
                    ok: 'fine',
                    circular: (() => {
                      const value: Record<string, unknown> = {};
                      value.self = value;
                      return value;
                    })(),
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
});

type EventListItem = components['schemas']['IssueEventSchema'];

/** For `list_issue_events`/`list_project_events`: a row with `title`/`tags` sent as `null`. */
export const malformedListItem = {
  id: 'evt-malformed-list',
  eventID: 'a',
  projectID: 1,
  groupID: 'grp-1',
  dateCreated: 'x',
  dateReceived: '2026-01-02T03:04:06Z',
  type: 'error',
  message: '',
  tags: null,
  title: null,
  entries: [],
} as unknown as EventListItem;
