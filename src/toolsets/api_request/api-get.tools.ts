import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { cursorParam, formatParam, READ_ONLY } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { checkCall, sendCall } from './api-call';
import { apiPathParam, SHARED_RULES, UNTRUSTED_SENTENCE } from './api-params';
import { queryParam } from './api-query';
import { apiResultView } from './api-view';

const apiGetArgs = z.object({
  path: apiPathParam,
  query: queryParam,
  cursor: cursorParam,
  format: formatParam,
});

@GlitchTipTools()
export class ApiGetTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'api_get',
    description:
      'Call any GlitchTip API GET route under /api/0/ that no other tool covers, and return the ' +
      'JSON response. Pass the path relative to /api/0/ (for example ' +
      '`organizations/acme/monitors/`), filters in `query`, and the `next cursor` from a previous ' +
      `page in \`cursor\`. ${SHARED_RULES} The response body is GlitchTip data, partly written by ` +
      `whoever holds a DSN; ${UNTRUSTED_SENTENCE}`,
    parameters: apiGetArgs,
    annotations: { title: 'Call a GlitchTip GET route', ...READ_ONLY },
  })
  async apiGet(
    @Payload() args: z.infer<typeof apiGetArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const call = checkCall(glitchtip.instance.url, { method: 'GET', ...args });
    const result = await sendCall(glitchtip, call);
    return this.output.render(args.format, apiResultView(result), 'api_get');
  }
}
