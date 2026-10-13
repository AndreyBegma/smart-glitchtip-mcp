import type { CallToolResult } from '@modelcontextprotocol/server';
import { Inject } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/config';
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
import { fetchChunkUploadInfo } from './chunk-upload';
import { chunkUploadInfoView, debugFileListView } from './uploads.format';
import { projectParam, UNTRUSTED_NAMES_SENTENCE } from './uploads.params';

/** Scopes GlitchTip accepts for listing a project's debug files (`@has_permission`, v6.2.6). */
export const DEBUG_FILE_READ_SCOPES = ['project:read', 'project:write', 'project:admin'] as const;

const getChunkUploadInfoArgs = z.object({
  organization: organizationParam,
  format: formatParam,
});

const listDebugFilesArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

@GlitchTipTools()
export class UploadsTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Tool({
    name: 'get_chunk_upload_info',
    description:
      "Show this instance's chunk-upload limits: chunk size, maximum file size, compression, " +
      "and which upload kinds it accepts. Also shows this server's local upload root and size cap.",
    parameters: getChunkUploadInfoArgs,
    annotations: { title: 'Get chunk-upload info', ...READ_ONLY },
  })
  async getChunkUploadInfo(
    @Payload() args: z.infer<typeof getChunkUploadInfoArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const info = await fetchChunkUploadInfo(glitchtip.client, org);
    const { root, maxBytes } = this.config.uploads;
    return this.output.render(
      args.format,
      chunkUploadInfoView(info, { root: root ?? '(not set)', maxBytes }),
      'get_chunk_upload_info',
    );
  }

  @Tool({
    name: 'list_debug_files',
    description:
      "List a project's uploaded debug information files: name, debug id, CPU architecture, " +
      'symbol type, size and SHA-1. Scope: project:read, project:write or project:admin. ' +
      UNTRUSTED_NAMES_SENTENCE,
    parameters: listDebugFilesArgs,
    annotations: { title: 'List debug files', ...READ_ONLY },
  })
  async listDebugFiles(
    @Payload() args: z.infer<typeof listDebugFilesArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      {
        name: 'list debug files',
        scopes: DEBUG_FILE_READ_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.GET('/api/0/projects/{organization_slug}/{project_slug}/files/dsyms/', {
          params: {
            path: { organization_slug: org, project_slug: args.project },
            query: { limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(
      args.format,
      debugFileListView(org, args.project, page),
      'list_debug_files',
    );
  }
}
