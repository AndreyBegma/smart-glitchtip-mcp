import { describe, expect, it } from 'vitest';
import { parseEvent } from '../../../src/toolsets/events/event.parser';
import {
  malformedEntriesObject,
  malformedErrorsObject,
  malformedErrorsWithNull,
  malformedExceptionDataNull,
  malformedNullEntries,
  malformedRequestHeadersObjectAndQueryString,
  malformedRequestNullPairs,
  malformedTagsNull,
  malformedTagsObject,
  malformedTagsWithNull,
} from '../../fixtures/events/events.fixtures';

// Review items 8-9 ("Defensive parsing — must degrade, never 'Internal
// error'"): every one of these deviates from the generated schema the way a
// real payload plausibly could. parseEvent must never throw.

describe('defensive parsing (review 8-9)', () => {
  it('treats entries sent as an object as empty, not a crash', () => {
    expect(() => parseEvent(malformedEntriesObject)).not.toThrow();
    const parsed = parseEvent(malformedEntriesObject);
    expect(parsed.exception).toBeUndefined();
  });

  it('skips null/non-record entries but still reads the ones that are valid', () => {
    const parsed = parseEvent(malformedNullEntries);
    expect(parsed.message).toBe('still readable');
  });

  it('treats an exception entry with data: null as an unrecognised shape', () => {
    const parsed = parseEvent(malformedExceptionDataNull);
    expect(parsed.exception).toEqual({ recognised: false, values: [] });
  });

  it('treats tags: null as no tags', () => {
    expect(() => parseEvent(malformedTagsNull)).not.toThrow();
    expect(parseEvent(malformedTagsNull).tags).toEqual([]);
  });

  it('treats tags sent as a plain object as no tags (the array shape is required)', () => {
    expect(() => parseEvent(malformedTagsObject)).not.toThrow();
    expect(parseEvent(malformedTagsObject).tags).toEqual([]);
  });

  it('skips a null entry in the tags array but keeps the rest', () => {
    const parsed = parseEvent(malformedTagsWithNull);
    expect(parsed.tags).toEqual([{ key: 'release', value: '1.0' }]);
  });

  it('treats errors sent as a plain object as no errors', () => {
    expect(() => parseEvent(malformedErrorsObject)).not.toThrow();
    expect(parseEvent(malformedErrorsObject).errors).toEqual([]);
  });

  it('skips a null entry in the errors array but keeps the rest', () => {
    const parsed = parseEvent(malformedErrorsWithNull);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain('ProcessingError');
  });

  it('reads request headers sent as an object and query sent as a string', () => {
    const parsed = parseEvent(malformedRequestHeadersObjectAndQueryString);
    expect(parsed.request?.query).toBe('q=1&r=2');
    expect(parsed.request?.headers).toContainEqual(['User-Agent', 'ua']);
  });

  it('skips null pairs in request query/headers but keeps the valid ones', () => {
    const parsed = parseEvent(malformedRequestNullPairs);
    expect(parsed.request?.query).toBe('ok=yes');
    expect(parsed.request?.headers).toEqual([
      ['User-Agent', 'ua'],
      ['Cookie', 'x'],
    ]);
  });
});
