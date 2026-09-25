import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import type { RawResponse } from '../../glitchtip/glitchtip.client';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import type { Redactor } from '../../glitchtip/redactor';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { ingestResultView, withHostNote } from './ingest.format';
import { listProjectKeys, selectKey } from './ingest.key-selection';
import { ingestFailureOutcome, ingestFallbackOutcome, parseEventId } from './ingest.outcome';
import {
  dsnParam,
  environmentParam,
  keyIdParam,
  levelParam,
  messageParam,
  projectParam,
  releaseParam,
  waitSecondsParam,
} from './ingest.params';
import { verifyEventVisible } from './ingest.verify';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.
// Both tools write a real event (spec "ingest"): hidden in read-only mode,
// not destructive, not idempotent.

const KEY_SELECTION_FIELDS = {
  organization: organizationParam,
  project: projectParam,
  key_id: keyIdParam.optional(),
  dsn: dsnParam.optional(),
};

function noBothKeyAndDsn(v: { key_id?: string; dsn?: string }): boolean {
  return v.key_id === undefined || v.dsn === undefined;
}
const NO_BOTH_ISSUE = { message: 'key_id and dsn cannot both be given.', path: ['dsn'] };

const sendTestEventArgs = z
  .object({
    ...KEY_SELECTION_FIELDS,
    message: messageParam,
    level: levelParam,
    environment: environmentParam,
    release: releaseParam,
    wait_seconds: waitSecondsParam,
    format: formatParam,
  })
  .refine(noBothKeyAndDsn, NO_BOTH_ISSUE);

const sendTestSecurityArgs = z
  .object({ ...KEY_SELECTION_FIELDS, format: formatParam })
  .refine(noBothKeyAndDsn, NO_BOTH_ISSUE);

const CSP_REPORT_BODY = {
  'csp-report': {
    'document-uri': 'https://smart-glitchtip-mcp.invalid/test',
    'blocked-uri': 'https://smart-glitchtip-mcp.invalid/blocked.js',
    'effective-directive': 'script-src',
    disposition: 'report',
    'original-policy': "script-src 'self'",
    'status-code': 200,
  },
};

function storeEventPayload(eventId: string, args: z.infer<typeof sendTestEventArgs>) {
  return {
    event_id: eventId.replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'other',
    level: args.level,
    logger: 'smart-glitchtip-mcp',
    message: args.message,
    tags: { 'smart-glitchtip-mcp': 'test' },
    ...(args.environment !== undefined ? { environment: args.environment } : {}),
    ...(args.release !== undefined ? { release: args.release } : {}),
  };
}

/** `undefined` for a successful send/report; the isError message otherwise. */
function ingestOutcomeMessage(
  response: RawResponse,
  projectID: number,
  successStatus: number,
  redactor: Redactor,
): string | undefined {
  if (response.status === successStatus) return undefined;
  return (
    ingestFailureOutcome(response, projectID)?.message ??
    ingestFallbackOutcome(response, redactor).message
  );
}

@GlitchTipTools()
export class IngestMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'send_test_event',
    description:
      "Check that a project's DSN accepts events: send one test event through the project's " +
      'client key to this GlitchTip instance and report what the ingest endpoint answered. The ' +
      'event is real: it creates an issue tagged `smart-glitchtip-mcp: test`, counts toward ' +
      'quota, and marks a new project as having received its first event.',
    parameters: sendTestEventArgs,
    annotations: {
      title: 'Send test event',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async sendTestEvent(
    @Payload() args: z.infer<typeof sendTestEventArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const keys = await listProjectKeys(glitchtip.client, org, args.project);
    const picked = selectKey(
      keys,
      org,
      args.project,
      { keyId: args.key_id, dsn: args.dsn },
      glitchtip.instance.origin,
    );
    if (!picked.ok) return error(picked.message);

    const eventId = randomUUID();
    const response = await glitchtip.client.raw(
      { name: 'send test event', scopes: [] },
      'POST',
      `/api/${picked.key.projectID}/store/`,
      { query: { sentry_key: picked.key.public }, body: storeEventPayload(eventId, args) },
    );

    const failure = ingestOutcomeMessage(
      response,
      picked.key.projectID,
      200,
      glitchtip.instance.redactor(),
    );
    if (failure) return error(withHostNote(failure, picked.dsnHostMismatch));

    const returnedId = parseEventId(response.text);
    const lines = [
      returnedId
        ? `Accepted: event ${returnedId} via key ${picked.key.id} (project ${picked.key.projectID}).`
        : `Accepted: event via key ${picked.key.id} (project ${picked.key.projectID}). ` +
          "GlitchTip's reply was not in the expected shape.",
    ];
    if (picked.dsnHostMismatch) lines.push(picked.dsnHostMismatch);
    if (args.wait_seconds > 0) {
      lines.push(
        await verifyEventVisible(glitchtip.client, org, args.project, eventId, args.wait_seconds),
      );
    }
    return this.output.render(
      args.format,
      ingestResultView(lines.join('\n'), {
        keyId: picked.key.id,
        projectID: picked.key.projectID,
        eventId: returnedId ?? null,
      }),
    );
  }

  @Tool({
    name: 'send_test_security_report',
    description:
      'Check that a project accepts browser CSP reports: send one test Content Security Policy ' +
      "violation through the project's security endpoint. It creates a real issue in the project.",
    parameters: sendTestSecurityArgs,
    annotations: {
      title: 'Send test security report',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async sendTestSecurityReport(
    @Payload() args: z.infer<typeof sendTestSecurityArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const keys = await listProjectKeys(glitchtip.client, org, args.project);
    const picked = selectKey(
      keys,
      org,
      args.project,
      { keyId: args.key_id, dsn: args.dsn },
      glitchtip.instance.origin,
    );
    if (!picked.ok) return error(picked.message);

    const response = await glitchtip.client.raw(
      { name: 'send test security report', scopes: [] },
      'POST',
      `/api/${picked.key.projectID}/security/`,
      { query: { sentry_key: picked.key.public }, body: CSP_REPORT_BODY },
    );

    const failure = ingestOutcomeMessage(
      response,
      picked.key.projectID,
      201,
      glitchtip.instance.redactor(),
    );
    if (failure) return error(withHostNote(failure, picked.dsnHostMismatch));

    const lines = [`Accepted via key ${picked.key.id}.`];
    if (picked.dsnHostMismatch) lines.push(picked.dsnHostMismatch);
    return this.output.render(
      args.format,
      ingestResultView(lines.join('\n'), { keyId: picked.key.id, projectID: picked.key.projectID }),
    );
  }
}
