import { describe, expect, it } from 'vitest';
import { pathSegmentParam } from './tool-params';

// BUG-20260925-006 acceptance 11: free-form path input is one segment.

const version = pathSegmentParam('version', 64);

describe('pathSegmentParam', () => {
  it.each([
    ['empty', '', /must not be empty/],
    ['dot', '.', /must not be "\." or "\.\." or only dots/],
    ['dot-dot', '..', /only dots/],
    ['three dots', '...', /only dots/],
    ['a slash', 'a/b', /must not contain \/, \\, %, control characters/],
    ['a backslash', 'a\\b', /control characters/],
    ['a percent escape', 'a%2Fb', /control characters/],
    ['a control character', 'a\u0000b', /control characters/],
    ['a newline', 'a\nb', /control characters/],
    ['DEL', 'a\u007fb', /control characters/],
    // BUG-20260925-016 acceptance 3: C1, line separator, bidi and zero-width characters.
    ['a C1 control', 'a\u0085b', /bidi\/invisible characters/],
    ['a line separator', 'a b', /bidi\/invisible characters/],
    ['a bidi override', 'a‮b', /bidi\/invisible characters/],
    ['a zero-width space', 'a​b', /bidi\/invisible characters/],
    ['too long', 'v'.repeat(65), /at most 64 characters/],
  ])('refuses %s', (_, value, message) => {
    const result = version.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(message);
    expect(result.error?.issues[0].message).toMatch(/^version /);
  });

  it.each(['1.0.0+build 5', 'v1..2', '.hidden', 'release-2026.09', '版本-1'])(
    'accepts %s',
    (value) => {
      expect(version.parse(value)).toBe(value);
    },
  );
});
