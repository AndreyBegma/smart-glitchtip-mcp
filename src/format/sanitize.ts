/**
 * Neutralises control and invisible characters that untrusted GlitchTip text
 * (D-18) can carry without breaking an `untrusted()` fence: C0 controls,
 * DEL, C1 controls, zero-width characters and joiners, bidi overrides and
 * isolates, the word joiner, BOM, and the line/paragraph separators. None of
 * these change what a fence looks like, but they can hide or reorder text an
 * agent — or a person reading a transcript — sees (BUG-20260925-016). Each
 * contiguous run collapses to one replacement character.
 *
 * The character-class bodies below are assembled from numeric code points at
 * module load, not written as source escapes: several of these code points
 * (the zero-width, bidi and separator characters) render as their actual
 * invisible glyph rather than as literal `\uXXXX` text when authored, which
 * would corrupt the regex source. Building them from `String.fromCharCode`
 * keeps this file plain ASCII.
 */

function charRange(from: number, to: number): string {
  return `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
}

function char(code: number): string {
  return String.fromCharCode(code);
}

// DEL and C1 controls (0x7F-0x9F), zero-width space/joiners/LRM/RLM
// (0x200B-0x200F), bidi embeddings/overrides (0x202A-0x202E), word joiner
// (0x2060), bidi isolates (0x2066-0x2069), BOM (0xFEFF). Above C0, everything
// this module neutralises except the line/paragraph separators, which
// `pathSegmentParam` (`../mcp/tool-params.ts`) also refuses outright.
export const HIGH_INVISIBLE_AND_BIDI_CLASS =
  charRange(0x7f, 0x9f) +
  charRange(0x200b, 0x200f) +
  charRange(0x202a, 0x202e) +
  char(0x2060) +
  charRange(0x2066, 0x2069) +
  char(0xfeff);

/** The line/paragraph separator characters, as a character-class body. */
export const LINE_PARAGRAPH_CLASS = char(0x2028) + char(0x2029);

const SPACE_RUN_KEEP_NEWLINES = new RegExp(
  `[${charRange(0x00, 0x09)}${charRange(0x0b, 0x1f)}${HIGH_INVISIBLE_AND_BIDI_CLASS}]+`,
  'g',
);
const SPACE_RUN_ALL = new RegExp(
  `[${charRange(0x00, 0x1f)}${HIGH_INVISIBLE_AND_BIDI_CLASS}]+`,
  'g',
);
const LINE_PARAGRAPH_SEPARATORS = new RegExp(`[${LINE_PARAGRAPH_CLASS}]+`, 'g');

export interface NeutraliseOptions {
  readonly keepNewlines: boolean;
  /**
   * Whether a run of line/paragraph separators becomes `\n` (true) or a
   * space (false). Defaults to `keepNewlines`. `untrustedJson` sets this to
   * `false` independent of `keepNewlines`: `JSON.stringify` may leave
   * U+2028/U+2029 unescaped inside a string value (RFC 8259 permits it), and
   * turning one into a raw newline there would make that JSON string
   * invalid — where a plain literal `\n` already in the text (from
   * pretty-printing) is left alone either way.
   */
  readonly separatorsBecomeNewlines?: boolean;
}

export function neutralise(
  text: string,
  { keepNewlines, separatorsBecomeNewlines = keepNewlines }: NeutraliseOptions,
): string {
  const spaceRun = keepNewlines ? SPACE_RUN_KEEP_NEWLINES : SPACE_RUN_ALL;
  return text
    .replace(spaceRun, ' ')
    .replace(LINE_PARAGRAPH_SEPARATORS, separatorsBecomeNewlines ? '\n' : ' ');
}

/** The shared flatten (D-12): neutralised, then whitespace collapsed to one line. */
export function flatten(text: string): string {
  return neutralise(text, { keepNewlines: false }).replace(/\s+/g, ' ').trim();
}
