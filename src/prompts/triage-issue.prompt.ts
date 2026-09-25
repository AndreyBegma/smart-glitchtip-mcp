import { Payload } from '@nestjs/microservices';
import { Prompt, type PromptResult } from '@rekog/mcp-nest';
import { z } from 'zod';
import { GlitchTipTools } from '../mcp/toolset.decorators';
import { promptIssueIdParam, promptOrganizationParam } from './prompt-params';
import { orgLine, RULES, step, withOrg } from './prompt-text';
import { validatePromptArgs } from './prompt-validation';

export const TRIAGE_ISSUE_PROMPT_NAME = 'triage-issue';

const DESCRIPTION =
  'Triage one GlitchTip issue: collect its details, latest stack trace, event spread, tags and ' +
  'suspect commits with the issues and events tools, then write a triage report with a likely ' +
  'cause and a suggested next step. Changes nothing in GlitchTip.';

const triageIssueArgs = z.object({
  issue_id: promptIssueIdParam,
  organization: promptOrganizationParam,
});

/** Every tool name this prompt's text can mention, named or in prose (D-27 acceptance 6). */
export const TRIAGE_ISSUE_TOOLS = [
  'get_issue',
  'get_latest_event',
  'get_event',
  'get_event_json',
  'list_issue_events',
  'list_issue_tags',
  'list_issue_commits',
  'list_issue_user_reports',
  'list_issue_comments',
  'whoami',
] as const;

function triageIssueText(issueId: number, organization: string | undefined): string {
  const a = withOrg({ issue_id: issueId }, organization);
  const aWithLimit = { ...a, limit: 10 };
  return [
    'Triage GlitchTip issue ' +
      `${issueId} with the smart-glitchtip-mcp tools. Call them in this order, with exactly the ` +
      'arguments shown; add only the options named.',
    orgLine(organization),
    '',
    `1. ${step('get_issue', a)}: status, level, event and user counts, first and last seen, ` +
      'first and last release, assignee.',
    `2. ${step('get_latest_event', a)}: the exception and the in-app frames. If they do not show ` +
      'the cause, call get_event for the same event with include_context: true, or ' +
      'get_event_json with a JSON Pointer path for one part of the payload.',
    `3. ${step('list_issue_events', aWithLimit)}: whether the events share one release and ` +
      'environment or spread across several.',
    `4. ${step('list_issue_tags', a)}: the spread of release, environment, browser, os and ` +
      'other tags.',
    `5. ${step('list_issue_commits', a)}: commits of the release where the issue first ` +
      'appeared, if any are linked.',
    '6. Only if get_issue shows user reports or comments: ' +
      `${step('list_issue_user_reports', a)} and ${step('list_issue_comments', a)}.`,
    '',
    'Then write a triage report:',
    '- What fails: the exception, and the in-app file and function where it is raised.',
    '- Scope: since when, how often, how many users, which releases and environments.',
    '- Likely cause, with the evidence for it (a frame, a breadcrumb, a tag, a commit). Keep ' +
      'what the data shows apart from what you infer, and give your confidence.',
    '- Suggested priority, and why.',
    '- Suggested next step: where to fix it, and whether the issue should be resolved, ignored ' +
      'or assigned, as a suggestion to the user, not an action.',
    '',
    RULES,
  ].join('\n');
}

/**
 * `triage-issue`: collects one issue's evidence with the issues and events
 * tools and tells the agent to write a triage report. No constructor
 * dependencies (D-27): it cannot read configuration, so it cannot leak it.
 */
@GlitchTipTools()
export class TriageIssuePrompt {
  @Prompt({
    name: TRIAGE_ISSUE_PROMPT_NAME,
    description: DESCRIPTION,
    parameters: triageIssueArgs,
  })
  getTriageIssue(@Payload() args: Record<string, string> | undefined): PromptResult {
    const parsed = validatePromptArgs(triageIssueArgs, TRIAGE_ISSUE_PROMPT_NAME, args);
    return {
      description: DESCRIPTION,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: triageIssueText(parsed.issue_id, parsed.organization) },
        },
      ],
    };
  }
}
