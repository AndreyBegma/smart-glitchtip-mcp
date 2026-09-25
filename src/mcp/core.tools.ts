import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { AgentFacingError } from '../agent-facing.error';
import { keyValues } from '../format/table';
import { ToolOutput } from '../format/tool-output';
import type { components } from '../glitchtip/generated/schema';
import {
  type GlitchTipConnection,
  InstanceResolver,
  NoDefaultOrganizationError,
} from '../glitchtip/instance.resolver';
import { formatParam, READ_ONLY } from './tool-params';
import { GlitchTipTools } from './toolset.decorators';

type ApiRoot = components['schemas']['APIRootSchema'];

const whoamiArgs = z.object({ format: formatParam });

/**
 * Tools registered whatever GLITCHTIP_TOOLSETS says: the diagnosis an agent
 * needs when every other tool fails.
 */
@GlitchTipTools()
export class CoreTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'whoami',
    description:
      'Show which GlitchTip instance and user this server is acting as, the instance version, ' +
      'and the scopes of the token in use. Call this first when a tool fails with a permission ' +
      'error. Needs no scope.',
    parameters: whoamiArgs,
    annotations: { title: 'Who am I', ...READ_ONLY },
  })
  async whoami(
    @Payload() args: z.infer<typeof whoamiArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const root = await glitchtip.client.call(
      {
        name: 'read the API root',
        scopes: [],
        requirement: 'no scope: any valid token (or none) may read it',
      },
      (api) => api.GET('/api/0/'),
    );
    const defaultOrganization = await describeDefaultOrganization(glitchtip);
    // Only fields listed here leave the server: APIRootSchema.auth also
    // carries the token itself (AGENTS.md rule 1).
    const projection = {
      instance: glitchtip.instance.url,
      version: root.version,
      user: root.user ? { email: root.user.email, name: root.user.name ?? null } : null,
      scopes: tokenScopes(root),
      defaultOrganization,
    };
    return this.output.render(args.format, {
      text: () =>
        keyValues([
          ['instance', projection.instance],
          ['version', projection.version],
          ['user', userLine(projection.user)],
          ['token scopes', projection.scopes?.join(', ') ?? 'no token in use'],
          ['default organization', projection.defaultOrganization],
        ]),
      json: () => projection,
    });
  }
}

function tokenScopes(root: ApiRoot): string[] | null {
  return root.auth ? [...root.auth.scopes] : null;
}

function userLine(user: { email: string; name: string | null } | null): string {
  if (!user) return 'anonymous (the token was not accepted, or none was sent)';
  return user.name ? `${user.name} <${user.email}>` : user.email;
}

// A secondary lookup: whoami answers even when it cannot be resolved.
async function describeDefaultOrganization(glitchtip: GlitchTipConnection): Promise<string> {
  try {
    return await glitchtip.organization();
  } catch (error) {
    if (error instanceof NoDefaultOrganizationError) {
      const count = `${error.visible.length}${error.more ? '+' : ''}`;
      return `none — ${count} visible, pass organization`;
    }
    if (error instanceof AgentFacingError) return `unavailable (${error.message})`;
    throw error;
  }
}
