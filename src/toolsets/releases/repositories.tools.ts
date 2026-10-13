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
import { REPOSITORY_UNTRUSTED_NOTE } from './releases.params';
import { REPO_READ_SCOPES } from './releases.scopes';
import { repositoryListView } from './repositories.format';

const listRepositoriesArgs = z.object({
  organization: organizationParam,
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

@GlitchTipTools()
export class RepositoriesTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'list_repositories',
    description:
      'List the source repositories registered in an organization, newest first. ' +
      `Scope: org:read, org:write or org:admin. ${REPOSITORY_UNTRUSTED_NOTE}`,
    parameters: listRepositoriesArgs,
    annotations: { title: 'List repositories', ...READ_ONLY },
  })
  async listRepositories(
    @Payload() args: z.infer<typeof listRepositoriesArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      { name: 'list repositories', scopes: REPO_READ_SCOPES, org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/repos/', {
          params: {
            path: { organization_slug: org },
            query: { limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(args.format, repositoryListView(org, page));
  }
}
