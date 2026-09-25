import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import {
  callForUser,
  deleteSocialAppOperation,
  renderRedacted,
  resultView,
  userOperation,
} from './admin.calls';
import {
  ADMIN_UNTRUSTED_NOTE,
  projectIdParam,
  socialAppIdParam,
  userNameParam,
  userOptionParam,
} from './admin.params';
import { notificationDefaultView } from './settings.format';
import { currentUserView } from './user.format';
import { userUpdateBody } from './user-update.payload';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.
// No `/users/…` route checks a scope upstream, so read-only mode and the set
// of tools that exist are the only guards (spec fact 2): deleting the user,
// changing e-mail addresses and SSO app create/update are deliberately not
// tools (D-23).

/** `ProjectAlertStatus` as the update route takes it [Confirmed]: -1 clears the override. */
const ALERT_MODES = { default: -1, on: 1, off: 0 } as const;

const updateUserArgs = z
  .object({
    name: userNameParam.optional(),
    timezone: userOptionParam.optional().describe('Timezone name, e.g. "Europe/Berlin".'),
    language: userOptionParam.optional().describe('Interface language code, e.g. "en".'),
    clock_24_hours: z.boolean().optional().describe('Show times on a 24-hour clock.'),
    preferred_theme: userOptionParam.optional().describe('Interface theme, e.g. "dark".'),
    format: formatParam,
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.timezone !== undefined ||
      v.language !== undefined ||
      v.clock_24_hours !== undefined ||
      v.preferred_theme !== undefined,
    {
      message:
        'nothing to update: give at least one of name, timezone, language, clock_24_hours, preferred_theme',
    },
  );

const updateNotificationsArgs = z.object({
  subscribe_by_default: z
    .boolean()
    .describe('Whether new projects notify the current user by default.'),
  format: formatParam,
});

const setAlertArgs = z.object({
  project_id: projectIdParam,
  mode: z
    .enum(['default', 'on', 'off'])
    .describe('on / off overrides the default for this project; default removes the override.'),
  format: formatParam,
});

const deleteSocialAppArgs = z.object({
  organization: organizationParam,
  social_app_id: socialAppIdParam,
  confirm: z
    .string()
    .describe(
      'Must equal `social_app_id` written as a string; guards against deleting the wrong one.',
    ),
  format: formatParam,
});

@GlitchTipTools()
export class AdminMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'update_current_user',
    description:
      "Change the current user's display name or preferences (timezone, language, 24-hour " +
      'clock, theme). Fields left out keep their value: the tool reads the user first and ' +
      're-sends them. Needs no scope; any valid token. ' +
      ADMIN_UNTRUSTED_NOTE,
    parameters: updateUserArgs,
    annotations: {
      title: 'Update current user',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async updateCurrentUser(
    @Payload() args: z.infer<typeof updateUserArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const stored = await callForUser(
      glitchtip.client.call<unknown>(userOperation('read current user'), (api) =>
        api.GET('/api/0/users/{user_id}/', { params: { path: { user_id: 'me' } } }),
      ),
    );
    const body = userUpdateBody(stored, args);
    const updated = await callForUser(
      glitchtip.client.call<unknown>(userOperation('update current user'), (api) =>
        api.PUT('/api/0/users/{user_id}/', { params: { path: { user_id: 'me' } }, body }),
      ),
    );
    return renderRedacted(this.output, {
      glitchtip,
      format: args.format,
      view: currentUserView(updated),
      tool: 'update_current_user',
    });
  }

  @Tool({
    name: 'update_notification_settings',
    description:
      'Set whether new projects notify the current user by default. Per-project overrides are ' +
      'kept; change those with set_project_alert_notification. Needs no scope; any valid token.',
    parameters: updateNotificationsArgs,
    annotations: {
      title: 'Update notification settings',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async updateNotificationSettings(
    @Payload() args: z.infer<typeof updateNotificationsArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const updated = await callForUser(
      glitchtip.client.call<unknown>(userOperation('update notification settings'), (api) =>
        api.PUT('/api/0/users/{user_id}/notifications/', {
          params: { path: { user_id: 'me' } },
          body: { subscribeByDefault: args.subscribe_by_default },
        }),
      ),
    );
    return renderRedacted(this.output, {
      glitchtip,
      format: args.format,
      view: notificationDefaultView(updated),
      tool: 'update_notification_settings',
    });
  }

  @Tool({
    name: 'set_project_alert_notification',
    description:
      'Turn alert notifications for one project on or off for the current user, or return it ' +
      'to the default (see get_notification_settings). Needs no scope; any valid token.',
    parameters: setAlertArgs,
    annotations: {
      title: 'Set project alert notification',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async setProjectAlertNotification(
    @Payload() args: z.infer<typeof setAlertArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    await callForUser(
      glitchtip.client.call(userOperation('set project alert notification'), (api) =>
        api.PUT('/api/0/users/{user_id}/notifications/alerts/', {
          params: { path: { user_id: 'me' } },
          body: { [String(args.project_id)]: ALERT_MODES[args.mode] },
        }),
      ),
      `GlitchTip answered 404: project ${args.project_id} is not visible to the current user, ` +
        'or the user is inactive.',
    );
    const summary = `Alert notifications for project ${args.project_id} set to ${args.mode}.`;
    return renderRedacted(this.output, {
      glitchtip,
      format: args.format,
      view: resultView(summary, { projectId: args.project_id, mode: args.mode }),
      tool: 'set_project_alert_notification',
    });
  }

  @Tool({
    name: 'delete_social_app',
    description:
      'Delete an SSO provider from the organization. Users keep their accounts, but anyone who ' +
      'signs in only through this provider (no password) loses that sign-in route. `confirm` ' +
      'must equal `social_app_id` as a string. Requires the manager role or above. Scope: ' +
      'org:write or org:admin.',
    parameters: deleteSocialAppArgs,
    annotations: {
      title: 'Delete SSO app',
      ...mutation({ destructive: true, idempotent: false }),
    },
  })
  async deleteSocialApp(
    @Payload() args: z.infer<typeof deleteSocialAppArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    if (args.confirm !== String(args.social_app_id)) {
      return error(
        `Not deleted: confirm must equal the SSO app id "${args.social_app_id}" exactly.`,
      );
    }
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    await glitchtip.client.call(deleteSocialAppOperation(org, args.social_app_id), (api) =>
      api.DELETE('/api/0/organizations/{organization_slug}/social-apps/{social_app_id}/', {
        params: { path: { organization_slug: org, social_app_id: args.social_app_id } },
      }),
    );
    return renderRedacted(this.output, {
      glitchtip,
      format: args.format,
      view: resultView(`Deleted SSO app ${args.social_app_id} from ${org}.`),
      tool: 'delete_social_app',
    });
  }
}
