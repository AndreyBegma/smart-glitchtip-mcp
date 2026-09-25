import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/config/config';
import { PROMPTS, selectPrompts } from '../../src/prompts/prompts.registry';
import { ReleaseHealthReportPrompt } from '../../src/prompts/release-health-report.prompt';
import { TriageIssuePrompt } from '../../src/prompts/triage-issue.prompt';
import type { ToolsetDefinition, ToolsetName } from '../../src/toolsets/toolset';

// Acceptance 11: a required toolset that is enabled but `available: false`
// (a test registry) removes the prompt; `readOnly` does not.

function config(toolsets: readonly ToolsetName[], readOnly = false): AppConfig {
  return { toolsets, readOnly } as AppConfig;
}

function toolset(name: ToolsetName, available: boolean): ToolsetDefinition {
  return { name, read: [], write: [], available };
}

describe('selectPrompts (acceptance 11)', () => {
  it('registers PROMPTS with their documented toolset requirements', () => {
    expect(PROMPTS).toEqual([
      { controller: TriageIssuePrompt, requires: ['issues', 'events'] },
      { controller: ReleaseHealthReportPrompt, requires: ['releases', 'issues'] },
    ]);
  });

  it('selects a prompt whose required toolsets are all enabled and available', () => {
    const toolsets = [toolset('issues', true), toolset('events', true)];
    expect(selectPrompts(config(['issues', 'events']), toolsets)).toEqual([TriageIssuePrompt]);
  });

  it('drops a prompt whose required toolset is enabled but not yet available', () => {
    const toolsets = [toolset('issues', true), toolset('events', false)];
    expect(selectPrompts(config(['issues', 'events']), toolsets)).toEqual([]);
  });

  it('drops a prompt whose required toolset is not enabled at all', () => {
    const toolsets = [toolset('issues', true), toolset('events', true)];
    expect(selectPrompts(config(['issues']), toolsets)).toEqual([]);
  });

  it('does not consult readOnly', () => {
    const toolsets = [toolset('issues', true), toolset('events', true)];
    const readOnly = selectPrompts(config(['issues', 'events'], true), toolsets);
    const notReadOnly = selectPrompts(config(['issues', 'events'], false), toolsets);
    expect(readOnly).toEqual(notReadOnly);
    expect(readOnly).toEqual([TriageIssuePrompt]);
  });

  it('selects both prompts when every toolset both require is enabled and available', () => {
    const toolsets = [toolset('issues', true), toolset('events', true), toolset('releases', true)];
    expect(selectPrompts(config(['issues', 'events', 'releases']), toolsets)).toEqual([
      TriageIssuePrompt,
      ReleaseHealthReportPrompt,
    ]);
  });
});

// Acceptance 9 (secrets): a prompt class cannot read configuration or the
// request, because it has no constructor parameters at all.
describe('prompt classes take no constructor dependencies (acceptance 9)', () => {
  it('TriageIssuePrompt has no constructor parameters', () => {
    const paramtypes = Reflect.getMetadata('design:paramtypes', TriageIssuePrompt) as
      | unknown[]
      | undefined;
    expect(paramtypes === undefined || paramtypes.length === 0).toBe(true);
  });

  it('ReleaseHealthReportPrompt has no constructor parameters', () => {
    const paramtypes = Reflect.getMetadata('design:paramtypes', ReleaseHealthReportPrompt) as
      | unknown[]
      | undefined;
    expect(paramtypes === undefined || paramtypes.length === 0).toBe(true);
  });
});
