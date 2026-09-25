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
import { alertDetailView, alertListView } from './alerts.format';
import { ALERT_UNTRUSTED_NOTE, alertIdParam, projectParam } from './alerts.params';
import { ALERT_READ_SCOPES } from './alerts.scopes';
import { readAlert } from './alerts.store';

const listAlertsArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  limit: limitParam,
  cursor: cursorParam,
  format: formatParam,
});

const getAlertArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  alert_id: alertIdParam,
  format: formatParam,
});

@GlitchTipTools()
export class AlertsTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'list_project_alerts',
    description:
      "List a project's alert rules: when they fire (N events in M minutes, uptime failures) and " +
      'who they notify. Recipient URLs are shown masked (origin only). ' +
      `Scope: project:read, project:write or project:admin. ${ALERT_UNTRUSTED_NOTE}`,
    parameters: listAlertsArgs,
    annotations: { title: 'List project alerts', ...READ_ONLY },
  })
  async listProjectAlerts(
    @Payload() args: z.infer<typeof listAlertsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const page = await glitchtip.client.page(
      {
        name: 'list project alerts',
        scopes: ALERT_READ_SCOPES,
        resource: 'Project',
        id: args.project,
        org,
      },
      (api) =>
        api.GET('/api/0/projects/{organization_slug}/{project_slug}/alerts/', {
          params: {
            path: { organization_slug: org, project_slug: args.project },
            query: { limit: args.limit, cursor: args.cursor },
          },
        }),
    );
    return this.output.render(args.format, alertListView(page, args.project));
  }

  @Tool({
    name: 'get_project_alert',
    description:
      'Get one alert rule with every recipient and the tags it adds. GlitchTip has no ' +
      'single-alert endpoint, so this searches the first 1000 alerts of the project. ' +
      `Scope: project:read, project:write or project:admin. ${ALERT_UNTRUSTED_NOTE}`,
    parameters: getAlertArgs,
    annotations: { title: 'Get project alert', ...READ_ONLY },
  })
  async getProjectAlert(
    @Payload() args: z.infer<typeof getAlertArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const { alert } = await readAlert(glitchtip.client, {
      org,
      project: args.project,
      alertId: args.alert_id,
    });
    return this.output.render(args.format, alertDetailView(alert));
  }
}
