/** What replaces a secret, whole or cut off. */
export const REDACTED = '[redacted]';

/** The shortest start of a secret still redacted where a text was cut. */
const SHORTEST_CUT_START = 4;
/**
 * The same for a secret that is a URL: its first characters are a scheme
 * ("https"), which an ordinary message ("Enter a valid URL: https") may end in.
 */
const SHORTEST_URL_CUT_START = 6;
/** An extra secret shorter than this is too common to scrub; the token always is. */
const SHORTEST_EXTRA_SECRET = 8;

/** One way a secret can read in text, and how short a cut-off start of it still counts. */
interface Form {
  readonly text: string;
  readonly shortestCutStart: number;
}

/**
 * Removes a fixed set of secrets — the API token and whatever a toolset adds
 * — from text that came back from GlitchTip (AGENTS.md rule 1). Each secret
 * is matched as written, JSON-escaped, and JSON-escaped with non-ASCII as
 * `\uXXXX` (how a Python `json.dumps` quotes it).
 *
 * The secrets live in a private field, so a redactor cannot leak them through
 * JSON.stringify, a log line or an inspected error.
 */
export class Redactor {
  readonly #forms: readonly Form[];

  constructor(token: string | undefined, extraSecrets: readonly string[] = []) {
    const secrets = extraSecrets.filter((s) => s.length >= SHORTEST_EXTRA_SECRET);
    if (token) secrets.push(token);
    this.#forms = [...new Set(secrets)].flatMap(formsOf);
  }

  /** Replaces every whole occurrence of every secret; overlapping ones become one. */
  redact(text: string): string {
    const ranges: [number, number][] = [];
    for (const { text: form } of this.#forms) {
      for (let at = text.indexOf(form); at !== -1; at = text.indexOf(form, at + 1)) {
        ranges.push([at, at + form.length]);
      }
    }
    if (ranges.length === 0) return text;
    ranges.sort((a, b) => a[0] - b[0]);
    let result = '';
    let copied = 0;
    let [start, end] = ranges[0];
    for (const [nextStart, nextEnd] of ranges.slice(1)) {
      if (nextStart < end) {
        end = Math.max(end, nextEnd);
        continue;
      }
      result += `${text.slice(copied, start)}${REDACTED}`;
      copied = end;
      [start, end] = [nextStart, nextEnd];
    }
    return `${result}${text.slice(copied, start)}${REDACTED}${text.slice(end)}`;
  }

  /**
   * Replaces the start of a secret that `text` ends with — what is left of a
   * secret where the text was cut. Call it only on text that was cut, after
   * `redact`: a start is 4+ characters (6+ for a URL).
   */
  redactCutEnd(text: string): string {
    let longest = 0;
    for (const { text: form, shortestCutStart } of this.#forms) {
      const most = Math.min(form.length - 1, text.length);
      for (let length = most; length >= shortestCutStart && length > longest; length--) {
        if (text.endsWith(form.slice(0, length))) {
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

function formsOf(secret: string): Form[] {
  const shortestCutStart = URL.canParse(secret) ? SHORTEST_URL_CUT_START : SHORTEST_CUT_START;
  const jsonEscaped = JSON.stringify(secret).slice(1, -1);
  const texts = new Set([
    secret,
    jsonEscaped,
    asciiEscaped(jsonEscaped, (hex) => hex),
    asciiEscaped(jsonEscaped, (hex) => hex.toUpperCase()),
  ]);
  return [...texts].map((text) => ({ text, shortestCutStart }));
}

/** Non-ASCII characters as `\uXXXX` (UTF-16 units, so astral characters become pairs). */
function asciiEscaped(text: string, hexCase: (hex: string) => string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    result += unit > 0x7f ? `\\u${hexCase(unit.toString(16).padStart(4, '0'))}` : text[i];
  }
  return result;
}
