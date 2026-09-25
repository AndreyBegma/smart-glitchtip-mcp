import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { alertCall } from './alert-errors';
import { type Alert, alertChangedView, numberText, resultView } from './alerts.format';
import {
  ALERT_UNTRUSTED_NOTE,
  alertIdParam,
  projectParam,
  recipientsParam,
  triggerCountParam,
} from './alerts.params';
import {
  type AlertScalars,
  assertWholeTrigger,
  recipientToWire,
  resendRecipients,
  storedScalars,
} from './alerts.payload';
import { ALERT_ADMIN_SCOPES, ALERT_WRITE_SCOPES } from './alerts.scopes';
import { secretsFrom } from './alerts.secrets';
import { readAlert, writeAlert } from './alerts.store';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.

const NAME_MAX = 255;
const nameParam = z.string().max(NAME_MAX).describe('Alert name.');
const BOTH_OR_NEITHER = 'timespan_minutes and quantity must be given together, or neither';

const createAlertArgs = z
  .object({
    organization: organizationParam,
    project: projectParam,
    name: nameParam.optional(),
    timespan_minutes: triggerCountParam
      .optional()
      .describe('Fire when `quantity` events arrive within this many minutes (1–32767).'),
    quantity: triggerCountParam
      .optional()
      .describe('Number of events within `timespan_minutes` that fires the alert (1–32767).'),
    uptime: z.boolean().default(false).describe('Also fire on any uptime monitor check failure.'),
    recipients: recipientsParam
      .default([])
      .describe('0–20 recipients. None: GlitchTip emails the project’s team members.'),
    format: formatParam,
  })
  .refine((v) => (v.timespan_minutes === undefined) === (v.quantity === undefined), {
    message: BOTH_OR_NEITHER,
  });

const updateAlertArgs = z
  .object({
    organization: organizationParam,
    project: projectParam,
    alert_id: alertIdParam,
    name: nameParam.optional(),
    timespan_minutes: triggerCountParam
      .nullable()
      .optional()
      .describe('New timespan in minutes (1–32767); null clears the event trigger with quantity.'),
    quantity: triggerCountParam
      .nullable()
      .optional()
      .describe('New event count (1–32767); null clears the event trigger with timespan_minutes.'),
    uptime: z.boolean().optional().describe('Fire on uptime monitor check failures.'),
    format: formatParam,
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.timespan_minutes !== undefined ||
      v.quantity !== undefined ||
      v.uptime !== undefined,
    { message: 'nothing to update: give at least one of name, timespan_minutes, quantity, uptime' },
  )
  .refine(
    (v) =>
      v.timespan_minutes === undefined ||
      v.quantity === undefined ||
      (v.timespan_minutes === null) === (v.quantity === null),
    { message: BOTH_OR_NEITHER },
  );

const deleteAlertArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  alert_id: alertIdParam,
  confirm: z
    .string()
    .describe('Must equal `alert_id` written as a string; guards against deleting the wrong one.'),
  format: formatParam,
});

@GlitchTipTools()
export class AlertsMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'create_project_alert',
    description:
      'Create an alert rule for a project. Without recipients GlitchTip emails the project’s ' +
      'team members. Needs the admin organization role or membership of a team of the project. ' +
      `Scope: project:write or project:admin. ${ALERT_UNTRUSTED_NOTE}`,
    parameters: createAlertArgs,
    annotations: {
      title: 'Create project alert',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async createProjectAlert(
    @Payload() args: z.infer<typeof createAlertArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const secrets = secretsFrom(
      args.recipients.map((r) => ('url' in r ? r.url : undefined)),
      args.recipients.map((r) => (r.type === 'zulip' ? r.api_key : undefined)),
    );
    const alert = await alertCall(
      glitchtip.client.call<Alert | undefined>(
        { name: 'create project alert', scopes: ALERT_WRITE_SCOPES, org },
        (api) =>
          api.POST('/api/0/projects/{organization_slug}/{project_slug}/alerts/', {
            params: { path: { organization_slug: org, project_slug: args.project } },
            body: {
              name: args.name,
              timespanMinutes: args.timespan_minutes,
              quantity: args.quantity,
              uptime: args.uptime,
              alertRecipients: args.recipients.map(recipientToWire),
            },
          }),
      ),
      {
        secrets,
        notFound:
          `Could not create an alert in ${args.project}: the project was not found in ${org}, ` +
          'or your organization role is below admin and you are not in a team of the project.',
      },
    );
    return this.output.render(
      args.format,
      alertChangedView(`Created alert ${numberText(alert?.id)} in ${args.project}.`, alert),
    );
  }

  @Tool({
    name: 'update_project_alert',
    description:
      'Change an alert rule’s name, event trigger or uptime flag. Its recipients are kept: the ' +
      'tool reads the alert first and re-sends every recipient, because GlitchTip drops any ' +
      'recipient a write leaves out. Use add_alert_recipient / remove_alert_recipient for ' +
      `recipients. Scope: project:write or project:admin. ${ALERT_UNTRUSTED_NOTE}`,
    parameters: updateAlertArgs,
    annotations: {
      title: 'Update project alert',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async updateProjectAlert(
    @Payload() args: z.infer<typeof updateAlertArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const target = { org, project: args.project, alertId: args.alert_id };
    const { alert, secrets } = await readAlert(glitchtip.client, target);
    const scalars = mergeScalars(storedScalars(alert, args.alert_id), args);
    assertWholeTrigger(scalars);
    const recipients = resendRecipients(alert, args.alert_id);
    const updated = await writeAlert(glitchtip.client, target, scalars, recipients, secrets);
    return this.output.render(
      args.format,
      alertChangedView(`Updated alert ${args.alert_id} in ${args.project}.`, updated),
    );
  }

  @Tool({
    name: 'delete_project_alert',
    description:
      'Permanently delete an alert rule and its recipients. `confirm` must equal `alert_id` ' +
      'as a string. Needs the admin organization role. Scope: project:admin.',
    parameters: deleteAlertArgs,
    annotations: {
      title: 'Delete project alert',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async deleteProjectAlert(
    @Payload() args: z.infer<typeof deleteAlertArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== String(args.alert_id)) {
      return error(`Not deleted: confirm must equal the alert id "${args.alert_id}" exactly.`);
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await alertCall(
      glitchtip.client.call(
        { name: 'delete project alert', scopes: ALERT_ADMIN_SCOPES, org },
        (api) =>
          api.DELETE('/api/0/projects/{organization_slug}/{project_slug}/alerts/{alert_id}/', {
            params: {
              path: { organization_slug: org, project_slug: args.project, alert_id: args.alert_id },
            },
          }),
      ),
      {
        secrets: [],
        notFound:
          `Alert ${args.alert_id} was not found in ${args.project}, ` +
          'or your organization role is below admin.',
      },
    );
    return this.output.render(
      args.format,
      resultView(`Deleted alert ${args.alert_id} from ${args.project}.`),
    );
  }
}

/** The stored scalars with the caller's changes applied; omitted fields stay as stored. */
function mergeScalars(
  stored: AlertScalars,
  changes: {
    readonly name?: string;
    readonly timespan_minutes?: number | null;
    readonly quantity?: number | null;
    readonly uptime?: boolean;
  },
): AlertScalars {
  return {
    name: changes.name ?? stored.name,
    timespanMinutes:
      changes.timespan_minutes === undefined ? stored.timespanMinutes : changes.timespan_minutes,
    quantity: changes.quantity === undefined ? stored.quantity : changes.quantity,
    uptime: changes.uptime ?? stored.uptime,
  };
}
