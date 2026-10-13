import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { type CheckedCall, checkCall, sendCall, serialisedBody } from './api-call';
import { apiPathParam, SHARED_RULES, UNTRUSTED_SENTENCE } from './api-params';
import { queryParam } from './api-query';
import { ApiRequestRefusal } from './api-refusal';
import { apiResultView } from './api-view';

const apiRequestArgs = z.object({
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']).describe('The HTTP method.'),
  path: apiPathParam,
  query: queryParam,
  body: z
    .unknown()
    .optional()
    .describe('JSON body, at most 100 000 characters serialised. Not allowed with DELETE.'),
  // Optional in the schema only so that a missing value is answered with the
  // exact expected string; the handler refuses every call without it.
  confirm: z
    .string()
    .optional()
    .describe(
      'Required. Exactly "<METHOD> /api/0/<path>/" of this call, e.g. ' +
        '"DELETE /api/0/organizations/acme/issues/42/". Checked before any request.',
    ),
  format: formatParam,
});

@GlitchTipTools()
export class ApiRequestMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'api_request',
    description:
      'Send a POST, PUT, PATCH or DELETE to any GlitchTip API route under /api/0/ that no ' +
      'dedicated tool covers. Prefer the dedicated tools: they validate inputs and explain ' +
      'failures. This one can delete or overwrite anything the token may touch, so it requires ' +
      `\`confirm\`. ${SHARED_RULES} The response body is GlitchTip data; ${UNTRUSTED_SENTENCE}`,
    parameters: apiRequestArgs,
    annotations: {
      title: 'Send a GlitchTip API request',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async apiRequest(
    @Payload() args: z.infer<typeof apiRequestArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const call = checkCall(glitchtip.instance.url, args);
    assertConfirmed(call, args.confirm);
    const body = serialisedBody(call.method, args.body);
    const result = await sendCall(glitchtip, call, body);
    return this.output.render(args.format, apiResultView(result), 'api_request');
  }
}

/** D-21: the agent restates the exact target before anything is sent. */
function assertConfirmed(call: CheckedCall, confirm: string | undefined): void {
  const expected = `${call.method} ${call.target}`;
  if (confirm !== expected) {
    throw new ApiRequestRefusal(
      `Refused before any request: \`confirm\` must be exactly "${expected}".`,
    );
  }
}
