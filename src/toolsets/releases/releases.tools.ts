import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import {
  cursorParam,
  formatParam,
  limitParam,
  organizationParam,
  READ_ONLY,
} from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { callForRelease, callForReleaseFile } from './release-errors';
import {
  commitListView,
  deployListView,
  releaseDetailView,
  releaseFileDetailView,
  releaseFileListView,
  releaseListView,
} from './releases.format';
import {
  fileIdParam,
  projectParam,
  RELEASE_UNTRUSTED_NOTE,
  requiredProjectParam,
  versionParam,
} from './releases.params';
import { DEPLOY_COMMIT_SCOPES, RELEASE_SCOPES } from './releases.scopes';

const listReleasesArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

const getReleaseArgs = z.object({
  organization: organizationParam,
  version: versionParam,
  project: projectParam,
  format: formatParam,
});

const listReleaseDeploysArgs = z.object({
  organization: organizationParam,
  version: versionParam,
  format: formatParam,
});

const listReleaseCommitsArgs = z.object({
  organization: organizationParam,
  version: versionParam,
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe(
      'Commits to show, 1–1000 (default 100), applied client-side to the whole stored list.',
    ),
  format: formatParam,
});

const listReleaseFilesArgs = z.object({
  organization: organizationParam,
  version: versionParam,
  project: projectParam,
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

const getReleaseFileArgs = z.object({
  organization: organizationParam,
  version: versionParam,
  project: requiredProjectParam,
  file_id: fileIdParam,
  format: formatParam,
});

@GlitchTipTools()
export class ReleasesTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'list_releases',
    description:
      'List releases of an organization, or of one project with `project`, with commit and ' +
      `deploy counts. Scope: project:releases. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: listReleasesArgs,
    annotations: { title: 'List releases', ...READ_ONLY },
  })
  async listReleases(
    @Payload() args: z.infer<typeof listReleasesArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = args.project
      ? await glitchtip.client.page(
          { name: 'list project releases', scopes: RELEASE_SCOPES, org },
          (api) =>
            api.GET('/api/0/projects/{organization_slug}/{project_slug}/releases/', {
              params: {
                path: { organization_slug: org, project_slug: args.project as string },
                query: { limit: args.limit, cursor: args.cursor },
              },
            }),
        )
      : await glitchtip.client.page({ name: 'list releases', scopes: RELEASE_SCOPES, org }, (api) =>
          api.GET('/api/0/organizations/{organization_slug}/releases/', {
            params: {
              path: { organization_slug: org },
              query: { limit: args.limit, cursor: args.cursor },
            },
          }),
        );
    return this.output.render(args.format, releaseListView(page, org, args.project));
  }

  @Tool({
    name: 'get_release',
    description:
      'Get one release in full: version, ref, url, repository, dates and linked projects. ' +
      `Scope: project:releases. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: getReleaseArgs,
    annotations: { title: 'Get release', ...READ_ONLY },
  })
  async getRelease(
    @Payload() args: z.infer<typeof getReleaseArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const release = await callForRelease(
      args.project
        ? glitchtip.client.call(
            { name: 'get project release', scopes: RELEASE_SCOPES, org },
            (api) =>
              api.GET('/api/0/projects/{organization_slug}/{project_slug}/releases/{version}/', {
                params: {
                  path: {
                    organization_slug: org,
                    project_slug: args.project as string,
                    version: args.version,
                  },
                },
              }),
          )
        : glitchtip.client.call({ name: 'get release', scopes: RELEASE_SCOPES, org }, (api) =>
            api.GET('/api/0/organizations/{organization_slug}/releases/{version}/', {
              params: { path: { organization_slug: org, version: args.version } },
            }),
          ),
      org,
      args.version,
      args.project,
    );
    return this.output.render(args.format, releaseDetailView(release));
  }

  @Tool({
    name: 'list_release_deploys',
    description:
      'List the deploys recorded for a release: environment, url and dates. ' +
      `Scope: project:releases, project:write or project:admin. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: listReleaseDeploysArgs,
    annotations: { title: 'List release deploys', ...READ_ONLY },
  })
  async listReleaseDeploys(
    @Payload() args: z.infer<typeof listReleaseDeploysArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const deploys = await callForRelease(
      glitchtip.client.call({ name: 'list deploys', scopes: DEPLOY_COMMIT_SCOPES, org }, (api) =>
        api.GET('/api/0/organizations/{organization_slug}/releases/{version}/deploys/', {
          params: { path: { organization_slug: org, version: args.version } },
        }),
      ),
      org,
      args.version,
    );
    return this.output.render(args.format, deployListView(org, args.version, deploys));
  }

  @Tool({
    name: 'list_release_commits',
    description:
      'List commits attached to a release. GlitchTip returns the whole stored list (up to 1000); ' +
      `limit trims it client-side. Scope: project:releases, project:write or project:admin. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: listReleaseCommitsArgs,
    annotations: { title: 'List release commits', ...READ_ONLY },
  })
  async listReleaseCommits(
    @Payload() args: z.infer<typeof listReleaseCommitsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const commits = await callForRelease(
      glitchtip.client.call({ name: 'list commits', scopes: DEPLOY_COMMIT_SCOPES, org }, (api) =>
        api.GET('/api/0/organizations/{organization_slug}/releases/{version}/commits/', {
          params: { path: { organization_slug: org, version: args.version } },
        }),
      ),
      org,
      args.version,
    );
    return this.output.render(
      args.format,
      commitListView(org, args.version, commits, commits.slice(0, args.limit)),
    );
  }

  @Tool({
    name: 'list_release_files',
    description:
      'List the source-map and artifact bundles attached to a release. ' +
      `Scope: project:releases. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: listReleaseFilesArgs,
    annotations: { title: 'List release files', ...READ_ONLY },
  })
  async listReleaseFiles(
    @Payload() args: z.infer<typeof listReleaseFilesArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await callForRelease(
      args.project
        ? glitchtip.client.page(
            { name: 'list project release files', scopes: RELEASE_SCOPES, org },
            (api) =>
              api.GET(
                '/api/0/projects/{organization_slug}/{project_slug}/releases/{version}/files/',
                {
                  params: {
                    path: {
                      organization_slug: org,
                      project_slug: args.project as string,
                      version: args.version,
                    },
                    query: { limit: args.limit, cursor: args.cursor },
                  },
                },
              ),
          )
        : glitchtip.client.page(
            { name: 'list release files', scopes: RELEASE_SCOPES, org },
            (api) =>
              api.GET('/api/0/organizations/{organization_slug}/releases/{version}/files/', {
                params: {
                  path: { organization_slug: org, version: args.version },
                  query: { limit: args.limit, cursor: args.cursor },
                },
              }),
          ),
      org,
      args.version,
      args.project,
    );
    return this.output.render(
      args.format,
      releaseFileListView(page, org, args.version, args.project),
    );
  }

  @Tool({
    name: 'get_release_file',
    description:
      'Get one source-map or artifact bundle attached to a release, with its headers. File ' +
      `contents are not available through this tool. Scope: project:releases. ${RELEASE_UNTRUSTED_NOTE}`,
    parameters: getReleaseFileArgs,
    annotations: { title: 'Get release file', ...READ_ONLY },
  })
  async getReleaseFile(
    @Payload() args: z.infer<typeof getReleaseFileArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const file = await callForReleaseFile(
      glitchtip.client.call(
        { name: 'get project release file', scopes: RELEASE_SCOPES, org },
        (api) =>
          api.GET(
            '/api/0/projects/{organization_slug}/{project_slug}/releases/{version}/files/{file_id}/',
            {
              params: {
                path: {
                  organization_slug: org,
                  project_slug: args.project,
                  version: args.version,
                  file_id: args.file_id,
                },
              },
            },
          ),
      ),
      args.version,
      args.file_id,
    );
    return this.output.render(args.format, releaseFileDetailView(args.version, file));
  }
}
