import type { components } from '../../glitchtip/generated/schema';
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  asStringArray,
  safeStringify,
  truncate,
} from './event.guards';
import { isIpTagKey } from './event.redact';
import type {
  ParsedBreadcrumb,
  ParsedContextLine,
  ParsedEvent,
  ParsedException,
  ParsedExceptionValue,
  ParsedFrame,
  ParsedRequest,
  ParsedTag,
} from './event.types';

type EventDetail = components['schemas']['IssueEventDetailSchema'];

const CONTEXT_KEYS = ['runtime', 'os', 'browser', 'device', 'app'] as const;

// The stored shapes below are inferred, not schema-backed (spec risk, "The
// event renderer"), and every route that returns them is reachable by an
// event submitted through a public DSN. Every read here goes through
// asArray/asRecord/asString rather than trusting the generated type, and
// every event-supplied string is capped so one huge field can't by itself
// blow the response budget before section-priority trimming gets a say.
const EXCEPTION_TYPE_LIMIT = 200;
const EXCEPTION_VALUE_LIMIT = 1000;
const MESSAGE_LIMIT = 2000;
const BREADCRUMB_MESSAGE_LIMIT = 300;
const BREADCRUMB_CATEGORY_LIMIT = 100;
const FRAME_FIELD_LIMIT = 300;

/** Turns one GlitchTip event into the sections `event.format.ts` renders. */
export function parseEvent(event: EventDetail): ParsedEvent {
  const tags = parseTags(event.tags);
  const byKey = new Map(tags.map((tag) => [tag.key, tag.value]));
  return {
    id: event.id,
    dateReceived: event.dateReceived,
    platform: event.platform ?? undefined,
    level: byKey.get('level'),
    release: byKey.get('release'),
    environment: byKey.get('environment'),
    nextEventID: event.nextEventID ?? undefined,
    previousEventID: event.previousEventID ?? undefined,
    groupID: event.groupID,
    exception: parseException(event.entries),
    message: parseMessage(event.entries),
    breadcrumbs: parseBreadcrumbs(event.entries),
    request: parseRequest(event.entries),
    tags,
    contexts: parseContexts(event.contexts),
    user: parseUser(event.user),
    errors: parseErrors(event.errors),
  };
}

function capped(value: string | undefined, limit: number): string | undefined {
  return value === undefined ? undefined : truncate(value, limit);
}

/**
 * `entries` is typed as a discriminated-union array, but it's exactly as
 * inferred as the shapes inside it: a malformed payload could send it as an
 * object, drop it, or fill it with nulls. Treated as fully `unknown` here so
 * none of that reaches `.find`/`.map` and throws.
 */
function findEntryData(entries: unknown, type: string): Record<string, unknown> | undefined {
  const array = asArray(entries);
  if (!array) return undefined;
  for (const item of array) {
    const record = asRecord(item);
    if (record?.type === type) return asRecord(record.data) ?? {};
  }
  return undefined;
}

function parseException(entries: unknown): ParsedException | undefined {
  const data = findEntryData(entries, 'exception');
  if (!data) return undefined;
  const rawValues = asArray(data.values);
  if (!rawValues) return { recognised: false, values: [] };
  const values = rawValues
    .map(parseExceptionValue)
    .filter((value): value is ParsedExceptionValue => value !== undefined);
  return values.length > 0 ? { recognised: true, values } : { recognised: false, values: [] };
}

function parseExceptionValue(raw: unknown): ParsedExceptionValue | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const mechanism = asRecord(record.mechanism);
  return {
    type: capped(asString(record.type), EXCEPTION_TYPE_LIMIT),
    value: capped(asString(record.value), EXCEPTION_VALUE_LIMIT),
    module: asString(record.module),
    handled: mechanism ? asBoolean(mechanism.handled) : undefined,
    frames: parseFrames(record.stacktrace),
  };
}

function parseFrames(rawStacktrace: unknown): readonly ParsedFrame[] {
  const stacktrace = asRecord(rawStacktrace);
  const rawFrames = stacktrace ? asArray(stacktrace.frames) : undefined;
  if (!rawFrames) return [];
  return rawFrames.map(parseFrame).filter((frame): frame is ParsedFrame => frame !== undefined);
}

function parseFrame(raw: unknown): ParsedFrame | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  return {
    filename: capped(asString(record.filename), FRAME_FIELD_LIMIT),
    absPath: capped(asString(record.abs_path), FRAME_FIELD_LIMIT),
    function: capped(asString(record.function), FRAME_FIELD_LIMIT),
    module: capped(asString(record.module), FRAME_FIELD_LIMIT),
    lineno: asNumber(record.lineno),
    colno: asNumber(record.colno),
    contextLine: asString(record.context_line),
    preContext: asStringArray(record.pre_context),
    postContext: asStringArray(record.post_context),
    inApp: asBoolean(record.in_app),
    vars: asRecord(record.vars),
  };
}

function parseMessage(entries: unknown): string | undefined {
  const data = findEntryData(entries, 'message');
  if (!data) return undefined;
  return capped(asString(data.formatted) ?? asString(data.message), MESSAGE_LIMIT);
}

function parseBreadcrumbs(entries: unknown): readonly ParsedBreadcrumb[] {
  const data = findEntryData(entries, 'breadcrumbs');
  if (!data) return [];
  const values = Object.values(data).find((value): value is unknown[] => Array.isArray(value));
  if (!values) return [];
  return values
    .map((raw): ParsedBreadcrumb | undefined => {
      const record = asRecord(raw);
      if (!record) return undefined;
      return {
        timestamp: asString(record.timestamp),
        level: asString(record.level),
        category: capped(asString(record.category), BREADCRUMB_CATEGORY_LIMIT),
        message: capped(asString(record.message), BREADCRUMB_MESSAGE_LIMIT),
      };
    })
    .filter((crumb): crumb is ParsedBreadcrumb => crumb !== undefined);
}

function parseRequest(entries: unknown): ParsedRequest | undefined {
  const data = findEntryData(entries, 'request');
  if (!data) return undefined;
  return {
    method: asString(data.method),
    url: asString(data.url),
    query: parseQueryString(data.query),
    headers: parsePairs(data.headers),
  };
}

function parseQueryString(raw: unknown): string | undefined {
  const direct = asString(raw);
  if (direct) return direct;
  const list = parsePairs(raw);
  if (list.length === 0) return undefined;
  return list.map(([key, value]) => `${key}=${value}`).join('&');
}

/**
 * `Request.headers`/`.query`: nominally an array of `[key, value]` pairs, but
 * an inferred shape — a real payload may send an object instead, or pairs
 * with a `null` entry or a `null` side. Both shapes are handled; anything
 * else degrades to no pairs rather than throwing.
 */
function parsePairs(raw: unknown): ReadonlyArray<readonly [string, string]> {
  const array = asArray(raw);
  if (array) {
    return array
      .filter((pair): pair is unknown[] => Array.isArray(pair))
      .filter(
        (pair): pair is [string, string] =>
          typeof pair[0] === 'string' && typeof pair[1] === 'string',
      )
      .map(([key, value]) => [key, value] as const);
  }
  const record = asRecord(raw);
  if (!record) return [];
  return Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
}

/** Drops `user.ip`/`ip`/`client_ip` tags (D-20) rather than showing them redacted. */
export function parseTags(tags: unknown): readonly ParsedTag[] {
  const array = asArray(tags);
  if (!array) return [];
  return array
    .map((raw): ParsedTag | undefined => {
      const record = asRecord(raw);
      if (!record) return undefined;
      const key = asString(record.key);
      const value = asString(record.value);
      if (key && value !== undefined) return { key, value };
      const [firstKey, firstValue] = Object.entries(record)[0] ?? [];
      return firstKey && typeof firstValue === 'string'
        ? { key: firstKey, value: firstValue }
        : undefined;
    })
    .filter((tag): tag is ParsedTag => tag !== undefined && !isIpTagKey(tag.key));
}

function parseContexts(contexts: EventDetail['contexts']): readonly ParsedContextLine[] {
  if (!contexts) return [];
  const lines: ParsedContextLine[] = [];
  for (const key of CONTEXT_KEYS) {
    const record = asRecord(contexts[key]);
    if (!record) continue;
    const name = asString(record.name);
    const version = asString(record.version);
    const line = [name, version].filter((part): part is string => part !== undefined).join(' ');
    if (line) lines.push({ name: key, line });
  }
  return lines;
}

function parseUser(user: unknown): ParsedEvent['user'] {
  const record = asRecord(user);
  if (!record) return undefined;
  const id = asString(record.id);
  const email = asString(record.email);
  return id === undefined && email === undefined ? undefined : { id, email };
}

function parseErrors(errors: unknown): readonly string[] {
  const array = asArray(errors);
  if (!array) return [];
  return array
    .map((raw): string | undefined => {
      const record = asRecord(raw);
      if (!record) return undefined;
      const type = asString(record.type) ?? 'error';
      const name = asString(record.name);
      const value =
        record.value === undefined || record.value === null
          ? undefined
          : safeStringify(record.value);
      return [type, name, value].filter((part): part is string => part !== undefined).join(' ');
    })
    .filter((line): line is string => line !== undefined);
}
