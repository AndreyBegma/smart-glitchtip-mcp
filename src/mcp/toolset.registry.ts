import type { Type } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import { toolset as admin } from '../toolsets/admin';
import { toolset as alerts } from '../toolsets/alerts';
import { toolset as apiRequest } from '../toolsets/api_request';
import { toolset as billing } from '../toolsets/billing';
import { toolset as events } from '../toolsets/events';
import { toolset as ingest } from '../toolsets/ingest';
import { toolset as issues } from '../toolsets/issues';
import { toolset as logs } from '../toolsets/logs';
import { toolset as members } from '../toolsets/members';
import { toolset as monitors } from '../toolsets/monitors';
import { toolset as organizations } from '../toolsets/organizations';
import { toolset as performance } from '../toolsets/performance';
import { toolset as projects } from '../toolsets/projects';
import { toolset as releases } from '../toolsets/releases';
import { toolset as stats } from '../toolsets/stats';
import { toolset as statusPages } from '../toolsets/status_pages';
import { toolset as teams } from '../toolsets/teams';
import type { ToolsetDefinition, ToolsetName } from '../toolsets/toolset';
import { toolset as uploads } from '../toolsets/uploads';

// This file is final after FEAT-20260925-001: a toolset PR fills its own
// src/toolsets/<name>/index.ts and never edits this list.
export const TOOLSETS: readonly ToolsetDefinition[] = [
  organizations,
  issues,
  events,
  projects,
  teams,
  members,
  releases,
  alerts,
  monitors,
  statusPages,
  performance,
  logs,
  stats,
  admin,
  billing,
  ingest,
  uploads,
  apiRequest,
];

export interface ToolsetSelection {
  /** Tool controllers to register, and nothing else (D-07). */
  readonly controllers: Type[];
  /** Enabled toolsets that have no implementation yet. */
  readonly unavailable: ToolsetName[];
}

/**
 * The one place read-only mode and toolset selection are enforced: a tool
 * that is not returned here is never registered, so it is absent from
 * `tools/list` and unknown to `tools/call` (AGENTS.md rule 4).
 */
export function selectToolsets(
  config: AppConfig,
  /** Tests only: a registry to select from instead of TOOLSETS. */
  toolsets: readonly ToolsetDefinition[] = TOOLSETS,
): ToolsetSelection {
  const controllers: Type[] = [];
  const unavailable: ToolsetName[] = [];
  for (const toolset of toolsets) {
    if (!config.toolsets.includes(toolset.name)) continue;
    if (!toolset.available) unavailable.push(toolset.name);
    controllers.push(...toolset.read);
    if (writesAllowed(toolset, config)) controllers.push(...toolset.write);
  }
  return { controllers, unavailable };
}

function writesAllowed(toolset: ToolsetDefinition, config: AppConfig): boolean {
  if (config.readOnly) return false;
  return toolset.writeEnabled === undefined || toolset.writeEnabled(config);
}
