import type { components } from '../../glitchtip/generated/schema';
import { asArray, asBoolean, asNumber, asRecord, asString, asStringArray } from './event.guards';
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
type Entries = NonNullable<EventDetail['entries']>;
type Entry = Entries[number];

const CONTEXT_KEYS = ['runtime', 'os', 'browser', 'device', 'app'] as const;

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

function findEntry<T extends Entry['type']>(
  entries: Entries | undefined,
  type: T,
): Extract<Entry, { type: T }> | undefined {
  return entries?.find((entry): entry is Extract<Entry, { type: T }> => entry.type === type);
}

function parseException(entries: Entries | undefined): ParsedException | undefined {
  const entry = findEntry(entries, 'exception');
  if (!entry) return undefined;
  const rawValues = asArray(entry.data.values);
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
    type: asString(record.type),
    value: asString(record.value),
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
    filename: asString(record.filename),
    absPath: asString(record.abs_path),
    function: asString(record.function),
    module: asString(record.module),
    lineno: asNumber(record.lineno),
    colno: asNumber(record.colno),
    contextLine: asString(record.context_line),
    preContext: asStringArray(record.pre_context),
    postContext: asStringArray(record.post_context),
    inApp: asBoolean(record.in_app),
    vars: asRecord(record.vars),
  };
}

function parseMessage(entries: Entries | undefined): string | undefined {
  const entry = findEntry(entries, 'message');
  if (!entry) return undefined;
  return asString(entry.data.formatted) ?? asString(entry.data.message);
}

function parseBreadcrumbs(entries: Entries | undefined): readonly ParsedBreadcrumb[] {
  const entry = findEntry(entries, 'breadcrumbs');
  if (!entry) return [];
  const values = Object.values(entry.data).find((value) => Array.isArray(value));
  if (!values) return [];
  return values
    .map((raw): ParsedBreadcrumb | undefined => {
      const record = asRecord(raw);
      if (!record) return undefined;
      return {
        timestamp: asString(record.timestamp),
        level: asString(record.level),
        category: asString(record.category),
        message: asString(record.message),
      };
    })
    .filter((crumb): crumb is ParsedBreadcrumb => crumb !== undefined);
}

function parseRequest(entries: Entries | undefined): ParsedRequest | undefined {
  const entry = findEntry(entries, 'request');
  if (!entry) return undefined;
  const { data } = entry;
  return {
    method: data.method ?? undefined,
    url: data.url ?? undefined,
    query: pairsToQueryString(data.query),
    headers: pairs(data.headers),
  };
}

function pairsToQueryString(raw: (string | null)[][] | null | undefined): string | undefined {
  const list = pairs(raw);
  if (list.length === 0) return undefined;
  return list.map(([key, value]) => `${key}=${value}`).join('&');
}

/** `Request.headers`/`.query`: an array of `[key, value]` pairs, either side nullable. */
function pairs(
  raw: (string | null)[][] | null | undefined,
): ReadonlyArray<readonly [string, string]> {
  if (!raw) return [];
  return raw
    .filter(
      (pair): pair is [string, string] =>
        typeof pair[0] === 'string' && typeof pair[1] === 'string',
    )
    .map(([key, value]) => [key, value] as const);
}

export function parseTags(tags: EventDetail['tags']): readonly ParsedTag[] {
  return tags
    .map((raw): ParsedTag | undefined => {
      const key = asString(raw.key);
      const value = asString(raw.value);
      if (key && value !== undefined) return { key, value };
      const [firstKey, firstValue] = Object.entries(raw)[0] ?? [];
      return firstKey && typeof firstValue === 'string'
        ? { key: firstKey, value: firstValue }
        : undefined;
    })
    .filter((tag): tag is ParsedTag => tag !== undefined);
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

function parseErrors(errors: EventDetail['errors']): readonly string[] {
  if (!errors) return [];
  return errors.map((error) => {
    const value =
      error.value === undefined || error.value === null ? '' : ` ${JSON.stringify(error.value)}`;
    const name = error.name ? ` ${error.name}` : '';
    return `${error.type}${name}${value}`;
  });
}
