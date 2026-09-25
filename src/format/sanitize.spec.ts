import { describe, expect, it } from 'vitest';
import { flatten, neutralise } from './sanitize';

// BUG-20260925-016 acceptance 1: every character class, with and without keepNewlines.

describe('neutralise', () => {
  it.each([
    ['C0 control', '\u0000\u0001'],
    ['tab', '\t'],
    ['DEL', '\u007f'],
    ['C1 control', '\u0085'],
    ['zero-width space', '​'],
    ['zero-width joiner', '‍'],
    ['word joiner', '⁠'],
    ['BOM', '﻿'],
    ['LRM', '‎'],
    ['RLM', '‏'],
    ['right-to-left override', '‮'],
    ['left-to-right isolate', '⁦'],
    ['pop directional isolate', '⁩'],
  ])('collapses a run of %s to one space', (_, char) => {
    expect(neutralise(`a${char}${char}b`, { keepNewlines: false })).toBe('a b');
    expect(neutralise(`a${char}${char}b`, { keepNewlines: true })).toBe('a b');
  });

  it('keeps newline and turns a run of tabs around it into single spaces when keepNewlines', () => {
    expect(neutralise('a\t\n\tb', { keepNewlines: true })).toBe('a \n b');
  });

  it('turns newline into a space when not keepNewlines', () => {
    expect(neutralise('a\nb', { keepNewlines: false })).toBe('a b');
  });

  it('maps a run of line/paragraph separators to newline when keepNewlines, space otherwise', () => {
    expect(neutralise('a  b', { keepNewlines: true })).toBe('a\nb');
    expect(neutralise('a  b', { keepNewlines: false })).toBe('a b');
  });

  it('separatorsBecomeNewlines overrides keepNewlines for separators only (BUG-20260925-016, untrustedJson)', () => {
    expect(neutralise('a\nb  c', { keepNewlines: true, separatorsBecomeNewlines: false })).toBe(
      'a\nb c',
    );
  });

  it('leaves plain ASCII untouched', () => {
    expect(neutralise('Hello, world! 42', { keepNewlines: true })).toBe('Hello, world! 42');
  });

  it('leaves unicode letters untouched', () => {
    expect(neutralise('版本-1', { keepNewlines: true })).toBe('版本-1');
  });
});

describe('flatten', () => {
  it('collapses control/invisible runs and ordinary whitespace to one line', () => {
    expect(flatten('a\u0000b\n\nc\t\td​​e')).toBe('a b c d e');
  });

  it('trims leading and trailing whitespace', () => {
    expect(flatten('  \n a \n ')).toBe('a');
  });

  it('leaves plain ASCII untouched', () => {
    expect(flatten('multi word line')).toBe('multi word line');
  });
});
