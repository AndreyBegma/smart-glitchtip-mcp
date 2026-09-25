import { AgentFacingError } from '../../agent-facing.error';
import { asRecord } from './event.guards';

/** `get_event_json`'s `path`: invalid syntax, or a segment nothing matches. */
export class InvalidPointerError extends AgentFacingError {}

/**
 * RFC 6901 JSON Pointer, applied to the (already redacted) event payload.
 * `""` returns the whole document, per the RFC's root-pointer case.
 */
export function applyJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  if (!pointer.startsWith('/')) {
    throw new InvalidPointerError(`Invalid JSON Pointer "${pointer}": must start with "/".`);
  }
  let current = document;
  const walked: string[] = [];
  for (const token of pointer.slice(1).split('/').map(unescapeToken)) {
    walked.push(token);
    current = step(current, token, pointer, walked.join('/'));
  }
  return current;
}

function step(current: unknown, token: string, pointer: string, walkedPath: string): unknown {
  if (Array.isArray(current)) {
    const index = arrayIndex(token);
    if (index === undefined || index >= current.length) {
      throw new InvalidPointerError(
        `JSON Pointer ${pointer}: no "${walkedPath}" in the event payload.`,
      );
    }
    return current[index];
  }
  const record = asRecord(current);
  if (!record || !Object.hasOwn(record, token)) {
    throw new InvalidPointerError(
      `JSON Pointer ${pointer}: no "${walkedPath}" in the event payload.`,
    );
  }
  return record[token];
}

function arrayIndex(token: string): number | undefined {
  return /^(0|[1-9]\d*)$/.test(token) ? Number(token) : undefined;
}

function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}
