import { flatten } from '../../format/sanitize';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { ApiBody, ApiResult } from './api-response';

// How an escape-hatch result reads (FEAT-20260925-015 "Tools"). The body is
// redacted already; it is GlitchTip data of unknown origin, so it is fenced
// with the most exposed source (BUG-20260925-006 §5).

const FIELD = 'api.body';
const SOURCE = 'glitchtip-event';
/** A cursor shown bare, so it can be passed back as it is; anything else is fenced. */
const PLAIN_CURSOR = /^[A-Za-z0-9:._=+/-]{1,200}$/;

export function apiResultView(result: ApiResult): View {
  return {
    text: () => resultText(result),
    json: () => ({
      status: result.status,
      nextCursor: result.nextCursor ?? null,
      ...jsonBody(result.body),
    }),
    untrusted: { field: FIELD, source: SOURCE },
  };
}

function resultText({ request, status, nextCursor, body }: ApiResult): string {
  const heading = `${request} → ${status}`;
  if (body.kind === 'none') return `${heading} — no content.`;
  const lines = [heading];
  if (nextCursor !== undefined) lines.push(`next cursor: ${cursorText(nextCursor)}`);
  lines.push(...bodyLines(body));
  return lines.join('\n');
}

function bodyLines(body: Exclude<ApiBody, { kind: 'none' }>): string[] {
  switch (body.kind) {
    case 'json': {
      const lines = fencedBody(JSON.stringify(body.value, null, 2) ?? 'null');
      if (Array.isArray(body.value) && body.value.length === 0) lines.push('Empty list.');
      return lines;
    }
    case 'unparsed-json':
      return [
        'GlitchTip declared JSON but the body did not parse; it is shown as text.',
        ...fencedBody(body.text),
      ];
    case 'text':
      return [`content-type: ${body.contentType}`, ...fencedBody(body.text)];
    case 'binary':
      return [`content-type: ${body.contentType}, ${body.bytes} bytes; the body is not shown.`];
  }
}

/**
 * The text budget cuts on a line boundary, so one long line (a minified
 * body, a long string value) would be dropped whole. Long lines are wrapped
 * first, and the result says so, so a cut keeps a prefix of the body.
 */
const WRAP_AT = 1000;

function fencedBody(text: string): string[] {
  const lines = text.split('\n');
  if (lines.every((line) => line.length <= WRAP_AT)) return [untrusted(FIELD, text, SOURCE)];
  return [
    `Lines longer than ${WRAP_AT} characters are wrapped.`,
    untrusted(FIELD, lines.flatMap(wrapLine).join('\n'), SOURCE),
  ];
}

function wrapLine(line: string): string[] {
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > WRAP_AT) {
    // Never split a surrogate pair.
    const cut = isLowSurrogate(rest.charCodeAt(WRAP_AT)) ? WRAP_AT - 1 : WRAP_AT;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  pieces.push(rest);
  return pieces;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function cursorText(cursor: string): string {
  return PLAIN_CURSOR.test(cursor) ? cursor : untrusted('api.cursor', flatten(cursor), SOURCE);
}

function jsonBody(body: ApiBody): Record<string, unknown> {
  switch (body.kind) {
    case 'none':
      return { body: null };
    case 'json':
      return { body: body.value };
    case 'unparsed-json':
      return { body: body.text, note: 'GlitchTip declared JSON but the body did not parse.' };
    case 'text':
      return { contentType: body.contentType, body: body.text };
    case 'binary':
      return { contentType: body.contentType, bytes: body.bytes, body: null };
  }
}
