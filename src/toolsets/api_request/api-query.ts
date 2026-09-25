import { z } from 'zod';
import type { RawQuery } from '../../glitchtip/request-guards';
import { ApiRequestRefusal } from './api-refusal';

// The `query` argument of the escape hatch (FEAT-20260925-015 "Path rules").

const MAX_KEYS = 30;
const MAX_STRING = 1000;
const MAX_ITEMS = 100;
const QUERY_KEY = /^[A-Za-z0-9_.\-[\]]{1,64}$/;

const text = z.string().max(MAX_STRING, `a query value must be at most ${MAX_STRING} characters`);
const item = z.union([text, z.number()]);
const list = z
  .array(item)
  .max(MAX_ITEMS, `an array query value must hold at most ${MAX_ITEMS} items`)
  .refine(
    (items) => new Set(items.map(String)).size === items.length,
    'an array query value must not contain duplicates',
  );

export const queryParam = z
  .record(
    z.string().regex(QUERY_KEY, 'a query key must match [A-Za-z0-9_.-[]], 1–64 characters'),
    z.union([text, z.number(), z.boolean(), list]),
  )
  .refine(
    (query) => Object.keys(query).length <= MAX_KEYS,
    `query may hold at most ${MAX_KEYS} keys`,
  )
  .optional()
  .describe(
    'Query parameters, e.g. {"query": "is:unresolved", "project": [1, 2]}. An array repeats the parameter.',
  );

export type ApiQuery = z.infer<typeof queryParam>;

/** The query to send: `cursor` is shorthand for `query.cursor`, and giving both is refused. */
export function rawQueryOf(query: ApiQuery, cursor: string | undefined): RawQuery {
  if (cursor !== undefined && query?.cursor !== undefined) {
    throw new ApiRequestRefusal(
      'Refused before any request: pass the cursor either as `cursor` or as `query.cursor`, not both.',
    );
  }
  return cursor === undefined ? { ...query } : { ...query, cursor };
}
