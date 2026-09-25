import { describe, expect, it } from 'vitest';
import { Redactor } from './redactor';

const TOKEN = 'tok_ABCDEFGH';
const HOOK = 'https://hooks.example.test/T000/XXsecretXX';

describe('Redactor', () => {
  it('removes every whole occurrence of the token and of each extra secret', () => {
    const redactor = new Redactor(TOKEN, [HOOK]);
    expect(redactor.redact(`a ${TOKEN} b ${HOOK} c ${TOKEN}`)).toBe(
      'a [redacted] b [redacted] c [redacted]',
    );
  });

  it('merges overlapping matches into one replacement (nit 5)', () => {
    const redactor = new Redactor('secretAAAAbbbb', ['bbbbCCCCsecret2']);
    expect(redactor.redact('x secretAAAAbbbbCCCCsecret2 y')).toBe('x [redacted] y');
    const repeating = new Redactor('abababab');
    expect(repeating.redact('-ababababab-')).toBe('-[redacted]-');
  });

  it('matches the JSON-escaped and \\uXXXX-escaped forms of a secret (should-fix 2)', () => {
    const quoted = 'sec"ret\\päss_12345';
    const redactor = new Redactor(undefined, [quoted]);
    const jsonForm = JSON.stringify(quoted).slice(1, -1);
    expect(redactor.redact(`a ${jsonForm} b`)).toBe('a [redacted] b');
    expect(redactor.redact(`a ${jsonForm.replace('ä', '\\u00e4')} b`)).toBe('a [redacted] b');
    expect(redactor.redact(`a ${jsonForm.replace('ä', '\\u00E4')} b`)).toBe('a [redacted] b');
  });

  it('ignores an extra secret shorter than 8 characters, but not a short token (nit 4)', () => {
    expect(new Redactor(undefined, ['', 'abc1234']).redact('abc1234')).toBe('abc1234');
    expect(new Redactor('tok1', []).redact('tok1')).toBe('[redacted]');
    expect(new Redactor(undefined, []).redact('unchanged')).toBe('unchanged');
  });

  it('removes a cut-off start of 4+ characters at the end, and nothing shorter', () => {
    const redactor = new Redactor(TOKEN);
    expect(redactor.redactCutEnd('value tok_ABC')).toBe('value [redacted]');
    expect(redactor.redactCutEnd('value tok_')).toBe('value [redacted]');
    expect(redactor.redactCutEnd('value tok')).toBe('value tok');
    expect(redactor.redactCutEnd('tok_ABC value')).toBe('tok_ABC value');
  });

  it('needs 6+ characters of a URL secret at the cut, so a bare scheme survives (nit 3)', () => {
    const redactor = new Redactor(undefined, [HOOK]);
    expect(redactor.redactCutEnd('Enter a valid URL: https')).toBe('Enter a valid URL: https');
    expect(redactor.redactCutEnd('Enter a valid URL: https:')).toBe(
      'Enter a valid URL: [redacted]',
    );
  });

  it('never shows its secrets when serialised', () => {
    const json = JSON.stringify({ r: new Redactor(TOKEN, [HOOK]) });
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(HOOK);
  });
});
