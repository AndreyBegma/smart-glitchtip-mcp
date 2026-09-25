import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { callForRepositoryCreate } from './release-errors';
import { httpUrlParam, REPOSITORY_UNTRUSTED_NOTE } from './releases.params';
import { REPO_WRITE_SCOPES } from './releases.scopes';
import { repositoryCreatedView } from './repositories.format';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.

const createRepositoryArgs = z.object({
  organization: organizationParam,
  name: z.string().min(1).max(200).describe('Repository name.'),
  url: httpUrlParam(200).optional().describe('Repository URL.'),
  format: formatParam,
});

@GlitchTipTools()
export class RepositoriesMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'create_repository',
    description:
      'Register a source repository in an organization. A second call with the same name is ' +
      `refused: GlitchTip does not update an existing one. Scope: org:write or org:admin. ${REPOSITORY_UNTRUSTED_NOTE}`,
    parameters: createRepositoryArgs,
    annotations: {
      title: 'Create repository',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async createRepository(
    @Payload() args: z.infer<typeof createRepositoryArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const created = await callForRepositoryCreate(
      glitchtip.client.call({ name: 'create repository', scopes: REPO_WRITE_SCOPES, org }, (api) =>
        api.POST('/api/0/organizations/{organization_slug}/repos/', {
          params: { path: { organization_slug: org } },
          body: { name: args.name, url: args.url ?? '' },
        }),
      ),
      org,
      args.name,
    );
    return this.output.render(args.format, repositoryCreatedView(org, created));
  }
}
