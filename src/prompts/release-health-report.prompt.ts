import { Payload } from '@nestjs/microservices';
import { Prompt, type PromptResult } from '@rekog/mcp-nest';
import { z } from 'zod';
import { GlitchTipTools } from '../mcp/toolset.decorators';
import { promptOrganizationParam, promptProjectParam, promptVersionParam } from './prompt-params';
import { json, orgLine, RULES, step, withOrg, withOrgAndProject } from './prompt-text';
import { validatePromptArgs } from './prompt-validation';

export const RELEASE_HEALTH_REPORT_PROMPT_NAME = 'release-health-report';

const DESCRIPTION =
  "Report on one release's health: its deploys and commits, the issues carrying it and the ones " +
  'it introduced, their trend, and a verdict. Uses the releases and issues tools. Changes ' +
  'nothing in GlitchTip.';

const releaseHealthReportArgs = z.object({
  version: promptVersionParam,
  project: promptProjectParam,
  organization: promptOrganizationParam,
});

/** Every tool name this prompt's text can mention, named or in prose (D-27 acceptance 6). */
export const RELEASE_HEALTH_TOOLS = [
  'get_release',
  'list_release_deploys',
  'list_release_commits',
  'list_issues',
  'get_issues_stats',
  'get_issue',
  'whoami',
] as const;

const WHITESPACE = /\s/;

/** `IQ(sort)`: the issue search for this release, sorted one way. */
function issueQuery(
  version: string,
  sort: 'count' | 'first_seen',
  organization: string | undefined,
  project: string | undefined,
): Record<string, unknown> {
  return withOrgAndProject({ query: `release:${version}`, sort, limit: 25 }, organization, project);
}

/** The whitespace variant's `list_issues` call: `query` first, then organization/project, then sort/limit. */
function whitespaceIssueQuery(
  organization: string | undefined,
  project: string | undefined,
): Record<string, unknown> {
  return { ...withOrgAndProject({ query: '' }, organization, project), sort: 'count', limit: 25 };
}

function orgSuffix(organization: string | undefined): string {
  return organization === undefined ? '' : `, "organization":${json(organization)}`;
}

function releaseHealthReportText(
  version: string,
  organization: string | undefined,
  project: string | undefined,
): string {
  const r = withOrg({ version }, organization);
  const rp = project === undefined ? r : { ...r, project };
  const suffix = orgSuffix(organization);

  const steps: string[] = [
    `1. ${step('get_release', rp)}: when it was created and released, its projects, and its ` +
      'commit and deploy counts.',
    `2. ${step('list_release_deploys', r)}: where and when it was deployed.`,
    `3. ${step('list_release_commits', r)}: what changed in it.`,
  ];

  if (WHITESPACE.test(version)) {
    steps.push(
      '4. This version contains whitespace, which the issue search cannot express. Call ' +
        `${step('list_issues', whitespaceIssueQuery(organization, project))}, then call ` +
        'get_issue for at most 5 of the largest of them and keep those whose firstRelease or ' +
        'lastRelease is this version. Say in the report that the issue list for this release is ' +
        'a sample.',
      '5. get_issues_stats with "issue_ids" set to the ids of the kept issues, if any were kept, ' +
        `"period":"24h"${suffix}: whether they are rising or falling.`,
    );
  } else {
    steps.push(
      `4. ${step('list_issues', issueQuery(version, 'count', organization, project))}: the ` +
        'issues with events tagged with this release, largest first.',
      `5. ${step('list_issues', issueQuery(version, 'first_seen', organization, project))}: the ` +
        'newest of them.',
      '6. get_issues_stats with "issue_ids" set to the ids of up to 10 of the largest issues ' +
        `from step 4, "period":"24h"${suffix}: whether they are rising or falling.`,
      `7. For up to 5 issues from step 5: get_issue with its "issue_id"${suffix}. An issue ` +
        'whose firstRelease is this version appeared with this release.',
    );
  }

  return [
    `Report on the health of GlitchTip release ${json(version)} with the smart-glitchtip-mcp ` +
      'tools. Call them in this order, with exactly the arguments shown.',
    orgLine(organization),
    '',
    ...steps,
    '',
    'Then write a release health report:',
    '- Verdict: healthy, watch or unhealthy, and the reason. New error- or fatal-level issues ' +
      'first seen in this release, and rising counts, weigh most.',
    '- Deploys: environments and times.',
    '- Issues this release introduced: id, shortId, level, events, users.',
    '- The largest issues carrying this release, with their trend.',
    '- Changes that may explain them: commits whose files match in-app frames or culprits, ' +
      'where you can tell.',
    '- Recommended next steps, as suggestions to the user. For the worst new issue, suggest ' +
      'running the triage-issue prompt if the server offers it.',
    '',
    RULES,
  ].join('\n');
}

/**
 * `release-health-report`: collects one release's evidence with the releases
 * and issues tools and tells the agent to write a health report. No
 * constructor dependencies (D-27): it cannot read configuration, so it
 * cannot leak it.
 */
@GlitchTipTools()
export class ReleaseHealthReportPrompt {
  @Prompt({
    name: RELEASE_HEALTH_REPORT_PROMPT_NAME,
    description: DESCRIPTION,
    parameters: releaseHealthReportArgs,
  })
  getReleaseHealthReport(@Payload() args: Record<string, string> | undefined): PromptResult {
    const parsed = validatePromptArgs(
      releaseHealthReportArgs,
      RELEASE_HEALTH_REPORT_PROMPT_NAME,
      args,
    );
    return {
      description: DESCRIPTION,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: releaseHealthReportText(parsed.version, parsed.organization, parsed.project),
          },
        },
      ],
    };
  }
}
