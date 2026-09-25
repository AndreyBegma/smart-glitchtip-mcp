import { describe, expect, it } from 'vitest';
import { Redactor } from './redactor';

const SECRET = 'tok_ABCDEFGH';

describe('Redactor', () => {
  it('removes every whole occurrence, the longer secret first', () => {
    const redactor = new Redactor(['abc', `${SECRET}-abc`, SECRET]);
    expect(redactor.redact(`a ${SECRET}-abc b ${SECRET} c abc`)).toBe(
      'a [redacted] b [redacted] c [redacted]',
    );
  });

  it('ignores an empty or missing secret instead of splitting on it', () => {
    const redactor = new Redactor(['', undefined]);
    expect(redactor.redact('unchanged')).toBe('unchanged');
    expect(redactor.redactCutEnd('unchanged')).toBe('unchanged');
  });

  it('removes a start of 4 or more characters at the end, and nothing shorter', () => {
    const redactor = new Redactor([SECRET]);
    expect(redactor.redactCutEnd('value tok_ABC')).toBe('value [redacted]');
    expect(redactor.redactCutEnd('value tok_')).toBe('value [redacted]');
    expect(redactor.redactCutEnd('value tok')).toBe('value tok');
    expect(redactor.redactCutEnd('tok_ABC value')).toBe('tok_ABC value');
  });

  it('never shows its secrets when serialised', () => {
    expect(JSON.stringify({ r: new Redactor([SECRET]) })).not.toContain(SECRET);
  });
});
