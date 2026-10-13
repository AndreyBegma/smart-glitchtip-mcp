import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { flatten } from '../../format/sanitize';
import { type OutputFormat, ToolOutput, type View } from '../../format/tool-output';
import { GlitchTipError } from '../../glitchtip/glitchtip.errors';
import { type GlitchTipConnection, InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, organizationParam, READ_ONLY } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { callForUser, listSocialAppsOperation, renderRedacted, userOperation } from './admin.calls';
import { ADMIN_UNTRUSTED_NOTE } from './admin.params';
import { instanceLicenseView, notificationSettingsView, type Optional } from './settings.format';
import { socialAppsView } from './social-apps.format';
import { parseSupportLink, type SupportLink } from './support-link';
import { currentUserView, userEmailsView } from './user.format';

// Every `/users/…` route acts on the token's own user whatever id it is
// given [Confirmed: apps/users/api.py], so no tool takes a user id: the path
// is always the literal `me`.

const formatOnlyArgs = z.object({ format: formatParam });

const listSocialAppsArgs = z.object({ organization: organizationParam, format: formatParam });

@GlitchTipTools()
export class AdminTools {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'get_current_user',
    description:
      'Show the GlitchTip user this server acts as: email, name, account flags, linked sign-in ' +
      'identities and preferences. Needs no scope; any valid token. ' +
      ADMIN_UNTRUSTED_NOTE,
    parameters: formatOnlyArgs,
    annotations: { title: 'Get current user', ...READ_ONLY },
  })
  async getCurrentUser(
    @Payload() args: z.infer<typeof formatOnlyArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const user = await callForUser(
      glitchtip.client.call<unknown>(userOperation('get current user'), (api) =>
        api.GET('/api/0/users/{user_id}/', { params: { path: { user_id: 'me' } } }),
      ),
    );
    return this.render(glitchtip, args.format, currentUserView(user), 'get_current_user');
  }

  @Tool({
    name: 'list_user_emails',
    description:
      "List the current user's email addresses and which one is primary and verified. Needs no " +
      `scope; any valid token. ${ADMIN_UNTRUSTED_NOTE}`,
    parameters: formatOnlyArgs,
    annotations: { title: 'List user emails', ...READ_ONLY },
  })
  async listUserEmails(
    @Payload() args: z.infer<typeof formatOnlyArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const emails = await callForUser(
      glitchtip.client.call<unknown>(userOperation('list user emails'), (api) =>
        api.GET('/api/0/users/{user_id}/emails/', { params: { path: { user_id: 'me' } } }),
      ),
    );
    return this.render(glitchtip, args.format, userEmailsView(emails), 'list_user_emails');
  }

  @Tool({
    name: 'get_notification_settings',
    description:
      "Show the current user's notification settings: whether new projects notify by default, " +
      'and per-project alert overrides (projects without one follow the default). Needs no ' +
      'scope; any valid token.',
    parameters: formatOnlyArgs,
    annotations: { title: 'Get notification settings', ...READ_ONLY },
  })
  async getNotificationSettings(
    @Payload() args: z.infer<typeof formatOnlyArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const settings = await callForUser(
      glitchtip.client.call<unknown>(userOperation('get notification settings'), (api) =>
        api.GET('/api/0/users/{user_id}/notifications/', { params: { path: { user_id: 'me' } } }),
      ),
    );
    const alerts = await optional(
      callForUser(
        glitchtip.client.call<unknown>(userOperation('get project alert overrides'), (api) =>
          api.GET('/api/0/users/{user_id}/notifications/alerts/', {
            params: { path: { user_id: 'me' } },
          }),
        ),
      ),
    );
    return this.render(
      glitchtip,
      args.format,
      notificationSettingsView(settings, alerts),
      'get_notification_settings',
    );
  }

  @Tool({
    name: 'get_instance_license',
    description:
      "Show the instance's support license status and billing contact. The license key itself " +
      'is never shown; open the personalised support link from the GlitchTip UI. Needs no ' +
      'scope; any valid token.',
    parameters: formatOnlyArgs,
    annotations: { title: 'Get instance license', ...READ_ONLY },
  })
  async getInstanceLicense(
    @Payload() args: z.infer<typeof formatOnlyArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    // The support link first: it carries the license key, which the second
    // call's error details and both renderings must then be scrubbed of.
    const link: Optional<SupportLink> = await optional(
      glitchtip.client
        .call<unknown>(userOperation('get support link'), (api) =>
          api.GET('/api/0/instance-license/support-link/'),
        )
        .then(parseSupportLink),
    );
    const extraSecrets = link.ok ? link.value.secrets : [];
    const license = await glitchtip.client.call<unknown>(
      userOperation('get instance license'),
      (api) => api.GET('/api/0/instance-license/'),
      { extraSecrets },
    );
    return this.render(
      glitchtip,
      args.format,
      instanceLicenseView(license, link),
      'get_instance_license',
      extraSecrets,
    );
  }

  @Tool({
    name: 'list_social_apps',
    description:
      "List the organization's own single-sign-on providers (OpenID Connect, Google Workspace). " +
      'Requires the manager role or above. Scope: org:read, org:write or org:admin. ' +
      ADMIN_UNTRUSTED_NOTE,
    parameters: listSocialAppsArgs,
    annotations: { title: 'List SSO apps', ...READ_ONLY },
  })
  async listSocialApps(
    @Payload() args: z.infer<typeof listSocialAppsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const apps = await glitchtip.client.call<unknown>(listSocialAppsOperation(org), (api) =>
      api.GET('/api/0/organizations/{organization_slug}/social-apps/', {
        params: { path: { organization_slug: org } },
      }),
    );
    return this.render(glitchtip, args.format, socialAppsView(apps, org), 'list_social_apps');
  }

  private render(
    glitchtip: GlitchTipConnection,
    format: OutputFormat,
    view: View,
    tool: string,
    extraSecrets: readonly string[] = [],
  ): CallToolResult {
    return renderRedacted(this.output, { glitchtip, format, view, tool, extraSecrets });
  }
}

/**
 * A GlitchTip failure of a secondary read, kept as its kind and agent-facing
 * message. That message can quote GlitchTip's detail, and here it lands
 * inside a successful result, so it is flattened to one line (and fenced by
 * the view).
 */
async function optional<T>(call: Promise<T>): Promise<Optional<T>> {
  try {
    return { ok: true, value: await call };
  } catch (err) {
    if (err instanceof GlitchTipError) {
      return { ok: false, kind: err.kind, reason: flatten(err.message) };
    }
    throw err;
  }
}
