import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { alertCall, alertNotFoundMessage } from './alert-errors';
import {
  type Alert,
  alertChangedView,
  type StoredRecipient,
  type TestResult,
  testResultsView,
} from './alerts.format';
import {
  ALERT_UNTRUSTED_NOTE,
  alertIdParam,
  projectParam,
  recipientIdParam,
  recipientKey,
  recipientParam,
} from './alerts.params';
import { recipientToWire, resendRecipients, storedScalars } from './alerts.payload';
import { ALERT_WRITE_SCOPES } from './alerts.scopes';
import { mergeSecrets, scrub, secretsFrom } from './alerts.secrets';
import { readAlert, writeAlert } from './alerts.store';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07). add and remove are
// read-merge-writes of the whole alert (see alerts.store); test reads the
// alert first only to learn the secrets its delivery messages may quote.

const addRecipientArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  alert_id: alertIdParam,
  recipient: recipientParam,
  format: formatParam,
});

const removeRecipientArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  alert_id: alertIdParam,
  recipient_id: recipientIdParam,
  confirm: z
    .string()
    .describe(
      'Must equal `recipient_id` written as a string; guards against removing the wrong one.',
    ),
  format: formatParam,
});

const testAlertArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  alert_id: alertIdParam,
  recipient_id: recipientIdParam
    .optional()
    .describe('Test only this recipient (from get_project_alert); omit to test every recipient.'),
  format: formatParam,
});

const EMAIL_FALLBACK_NOTE = "The alert now falls back to emailing the project's team members.";

@GlitchTipTools()
export class AlertRecipientsMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'add_alert_recipient',
    description:
      'Add a recipient to an alert rule: email (the project’s team members), a webhook ' +
      '(webhook, discord, teams, googlechat, ntfy, feishu) or zulip. Every existing recipient is ' +
      `kept. Scope: project:write or project:admin. ${ALERT_UNTRUSTED_NOTE}`,
    parameters: addRecipientArgs,
    annotations: {
      title: 'Add alert recipient',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async addAlertRecipient(
    @Payload() args: z.infer<typeof addRecipientArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const target = { org, project: args.project, alertId: args.alert_id };
    const { alert, secrets } = await readAlert(glitchtip.client, target);
    const scalars = storedScalars(alert, args.alert_id);
    const kept = resendRecipients(alert, args.alert_id);
    const key = keyOfInput(args.recipient);
    const duplicate = recipientsOf(alert).find((r) => recipientKey(r.recipientType, r.url) === key);
    if (duplicate) {
      return error(
        `Not added: alert ${args.alert_id} already has this recipient (recipient ${duplicate.id ?? '?'}, ${args.recipient.type}).`,
      );
    }
    const allSecrets = mergeSecrets(secrets, inputSecrets(args.recipient));
    const added = recipientToWire(args.recipient);
    const updated = await writeAlert(
      glitchtip.client,
      target,
      scalars,
      [...kept, added],
      allSecrets,
    );
    const newId = updated
      ? recipientsOf(updated).find((r) => recipientKey(r.recipientType, r.url) === key)?.id
      : undefined;
    return this.output.render(
      args.format,
      alertChangedView(
        `Added recipient ${newId ?? '?'} (${args.recipient.type}) to alert ${args.alert_id}.`,
        updated,
      ),
    );
  }

  @Tool({
    name: 'remove_alert_recipient',
    description:
      'Remove one recipient from an alert rule; every other recipient is kept. A removed ' +
      'webhook URL or Zulip key cannot be recovered through this server. `confirm` must equal ' +
      `\`recipient_id\` as a string. Scope: project:write or project:admin. ${ALERT_UNTRUSTED_NOTE}`,
    parameters: removeRecipientArgs,
    annotations: {
      title: 'Remove alert recipient',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async removeAlertRecipient(
    @Payload() args: z.infer<typeof removeRecipientArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== String(args.recipient_id)) {
      return error(
        `Not removed: confirm must equal the recipient id "${args.recipient_id}" exactly.`,
      );
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const target = { org, project: args.project, alertId: args.alert_id };
    const { alert, secrets } = await readAlert(glitchtip.client, target);
    const stored = recipientsOf(alert);
    const index = stored.findIndex((r) => r?.id === args.recipient_id);
    if (index < 0) return error(notARecipient(args.recipient_id, args.alert_id));
    const scalars = storedScalars(alert, args.alert_id);
    const others = { ...alert, alertRecipients: stored.filter((_, i) => i !== index) };
    const kept = resendRecipients(others, args.alert_id);
    const updated = await writeAlert(glitchtip.client, target, scalars, kept, secrets);
    return this.output.render(
      args.format,
      alertChangedView(
        `Removed recipient ${args.recipient_id} from alert ${args.alert_id}.`,
        updated,
        kept.length === 0 ? EMAIL_FALLBACK_NOTE : undefined,
      ),
    );
  }

  @Tool({
    name: 'test_project_alert',
    description:
      'Send a test notification through an alert rule’s recipients now, and report per ' +
      'recipient whether it was sent. Email recipients are skipped. ' +
      `Scope: project:write or project:admin. ${ALERT_UNTRUSTED_NOTE}`,
    parameters: testAlertArgs,
    annotations: {
      title: 'Test project alert',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async testProjectAlert(
    @Payload() args: z.infer<typeof testAlertArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const { alert, secrets } = await readAlert(glitchtip.client, {
      org,
      project: args.project,
      alertId: args.alert_id,
    });
    const recipientId = args.recipient_id;
    if (recipientId !== undefined && !recipientsOf(alert).some((r) => r?.id === recipientId)) {
      return error(notARecipient(recipientId, args.alert_id));
    }
    const page = await alertCall(
      glitchtip.client.page<TestResult>(
        { name: 'test project alert', scopes: ALERT_WRITE_SCOPES, org },
        (api) =>
          api.POST('/api/0/projects/{organization_slug}/{project_slug}/alerts/{alert_id}/test/', {
            params: {
              path: { organization_slug: org, project_slug: args.project, alert_id: args.alert_id },
              query: { recipient_id: recipientId },
            },
          }),
      ),
      { secrets, notFound: alertNotFoundMessage(args.alert_id, args.project) },
    );
    const results = page.items.map((result) => ({
      ...result,
      message: typeof result?.message === 'string' ? scrub(result.message, secrets) : null,
    }));
    return this.output.render(args.format, testResultsView(args.alert_id, results));
  }
}

function recipientsOf(alert: Alert): readonly StoredRecipient[] {
  const recipients: unknown = alert.alertRecipients ?? [];
  return Array.isArray(recipients) ? recipients : [];
}

function keyOfInput(recipient: z.infer<typeof recipientParam>): string {
  return recipientKey(recipient.type, 'url' in recipient ? recipient.url : undefined);
}

function inputSecrets(recipient: z.infer<typeof recipientParam>) {
  return secretsFrom(
    ['url' in recipient ? recipient.url : undefined],
    [recipient.type === 'zulip' ? recipient.api_key : undefined],
  );
}

function notARecipient(recipientId: number, alertId: number): string {
  return `Recipient ${recipientId} is not a recipient of alert ${alertId}. Recipient ids come from get_project_alert.`;
}
