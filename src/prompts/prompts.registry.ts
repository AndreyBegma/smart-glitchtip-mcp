import type { Type } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import { TOOLSETS } from '../mcp/toolset.registry';
import type { ToolsetDefinition, ToolsetName } from '../toolsets/toolset';
import { ReleaseHealthReportPrompt } from './release-health-report.prompt';
import { TriageIssuePrompt } from './triage-issue.prompt';

export interface PromptDefinition {
  readonly controller: Type;
  readonly requires: readonly ToolsetName[];
}

export const PROMPTS: readonly PromptDefinition[] = [
  { controller: TriageIssuePrompt, requires: ['issues', 'events'] },
  { controller: ReleaseHealthReportPrompt, requires: ['releases', 'issues'] },
];

/**
 * A prompt is registered only when every toolset it names is enabled *and*
 * available (D-27): an entry the agent cannot act on is not offered (D-07),
 * same rule as `selectToolsets`. `config.readOnly` is not consulted — a
 * prompt's text never names a mutating tool.
 */
export function selectPrompts(
  config: AppConfig,
  /** Tests only: a registry to select toolset availability from instead of TOOLSETS. */
  toolsets: readonly ToolsetDefinition[] = TOOLSETS,
  /** Tests only: a registry to select from instead of PROMPTS. */
  prompts: readonly PromptDefinition[] = PROMPTS,
): Type[] {
  const availableByName = new Map(toolsets.map((toolset) => [toolset.name, toolset.available]));
  return prompts
    .filter((prompt) =>
      prompt.requires.every(
        (name) => config.toolsets.includes(name) && availableByName.get(name) === true,
      ),
    )
    .map((prompt) => prompt.controller);
}
