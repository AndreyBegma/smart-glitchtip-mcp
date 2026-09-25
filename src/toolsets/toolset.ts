import type { Type } from '@nestjs/common';

/**
 * Every toolset name the server knows (D-06 and the roadmap's phase 2 rows).
 * A name here with no implementation yet is accepted by configuration and
 * reported as "not yet available" at startup.
 */
export const TOOLSET_NAMES = [
  'organizations',
  'issues',
  'events',
  'projects',
  'teams',
  'members',
  'releases',
  'alerts',
  'monitors',
  'status_pages',
  'performance',
  'logs',
  'stats',
  'admin',
  'billing',
  'ingest',
  'uploads',
  'api_request',
] as const;

export type ToolsetName = (typeof TOOLSET_NAMES)[number];

export const DEFAULT_TOOLSETS: readonly ToolsetName[] = [
  'organizations',
  'issues',
  'events',
  'projects',
];

/**
 * What a toolset contributes. `read` controllers are registered whenever the
 * toolset is enabled; `write` controllers only when the server is not
 * read-only (D-07). Registration is the only place either rule is enforced.
 */
export interface ToolsetDefinition {
  readonly name: ToolsetName;
  readonly read: readonly Type[];
  readonly write: readonly Type[];
  readonly available: boolean;
}
