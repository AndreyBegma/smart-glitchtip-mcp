/** What replaces a secret, whole or cut off. */
export const REDACTED = '[redacted]';

/** The shortest start of a secret still redacted at the end of a text. */
const SHORTEST_CUT_START = 4;

/**
 * Removes a fixed set of secrets — the API token and whatever a toolset adds
 * — from text that came back from GlitchTip (AGENTS.md rule 1).
 *
 * The secrets live in a private field, so a redactor cannot leak them through
 * JSON.stringify, a log line or an inspected error. Empty strings are ignored.
 */
export class Redactor {
  /** Longest first, so a secret containing another is removed whole. */
  readonly #secrets: readonly string[];

  constructor(secrets: Iterable<string | undefined>) {
    const present = [...new Set(secrets)].filter((s): s is string => !!s);
    this.#secrets = present.sort((a, b) => b.length - a.length);
  }

  /** Replaces every whole occurrence of every secret. */
  redact(text: string): string {
    let result = text;
    for (const secret of this.#secrets) result = result.split(secret).join(REDACTED);
    return result;
  }

  /**
   * Replaces the start of a secret (4 characters or more) that `text` ends
   * with: what is left of a secret where the text was cut. Run after
   * `redact`, since a whole secret is never a start of itself here.
   */
  redactCutEnd(text: string): string {
    let longest = 0;
    for (const secret of this.#secrets) {
      const most = Math.min(secret.length - 1, text.length);
      for (let length = most; length >= SHORTEST_CUT_START && length > longest; length--) {
        if (text.endsWith(secret.slice(0, length))) {
          longest = length;
          break;
        }
      }
    }
    return longest === 0 ? text : `${text.slice(0, -longest)}${REDACTED}`;
  }

  toJSON(): string {
    return '[Redactor]';
  }
}
