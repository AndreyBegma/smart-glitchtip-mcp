import type { CallToolResult } from '@modelcontextprotocol/server';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { error } from '../../format/result';
import { ToolOutput } from '../../format/tool-output';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import {
  formatParam,
  mutation,
  organizationParam,
  requiredOrganizationParam,
} from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { linkView, overageStatusView, subscriptionView } from './billing.format';
import { BILLING_UNKNOWN_NOTE, billingDisabledSentence, fetchBillingEnabled } from './billing.gate';
import { capCentsParam, priceIdParam, STRIPE_UNTRUSTED_SENTENCE } from './billing.params';
import {
  createSubscriptionResponseSchema,
  linkSessionSchema,
  overageStatusSchema,
  parseOrMalformed,
} from './billing.validate';
import { asMemberCall, asOwnerCall } from './billing-errors';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07); see toolset.registry.

const setOverageArgs = z
  .object({
    organization: requiredOrganizationParam,
    enabled: z.boolean().describe('Turn metered overage billing on or off.'),
    cap_cents: capCentsParam.optional(),
    confirm: z
      .string()
      .optional()
      .describe('When enabling: must equal `cap_cents` written as a string.'),
    format: formatParam,
  })
  .refine((v) => v.enabled || v.cap_cents === undefined, {
    message: 'cap_cents is not accepted when enabled is false.',
    path: ['cap_cents'],
  })
  .refine((v) => v.enabled || v.confirm === undefined, {
    message: 'confirm is not accepted when enabled is false.',
    path: ['confirm'],
  })
  .refine((v) => !v.enabled || v.cap_cents !== undefined, {
    message: 'cap_cents is required when enabled is true.',
    path: ['cap_cents'],
  })
  .refine((v) => !v.enabled || v.confirm === String(v.cap_cents), {
    message: 'confirm must equal cap_cents written as a string, e.g. "500000".',
    path: ['confirm'],
  });

const createCheckoutArgs = z.object({
  organization: organizationParam,
  price: priceIdParam,
  format: formatParam,
});

const createPortalArgs = z.object({ organization: organizationParam, format: formatParam });

const subscribeFreeArgs = z.object({
  organization: organizationParam,
  price: priceIdParam,
  format: formatParam,
});

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

@GlitchTipTools()
export class BillingMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
  ) {}

  @Tool({
    name: 'set_overage_billing',
    description:
      'Turn metered overage billing on or off for an organization. When on, events beyond the ' +
      'plan quota are billed up to the spend cap instead of being dropped. Disabling resets the ' +
      'spend cap to 0; re-enabling always needs a new cap_cents. Owner only.',
    parameters: setOverageArgs,
    annotations: {
      title: 'Set overage billing',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async setOverageBilling(
    @Payload() args: z.infer<typeof setOverageArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const enabled = await fetchBillingEnabled(glitchtip.client);
    if (enabled === false) {
      return error(billingDisabledSentence(glitchtip.instance.origin));
    }
    const raw = await asOwnerCall(
      glitchtip.client.call({ name: 'set overage billing', scopes: [] }, (api) =>
        api.POST('/api/0/stripe/organizations/{organization_slug}/overage/', {
          params: { path: { organization_slug: args.organization } },
          body: { enabled: args.enabled, capCents: args.cap_cents ?? 0 },
        }),
      ),
      args.organization,
    );
    const status = parseOrMalformed(overageStatusSchema, raw);
    return this.output.render(
      args.format,
      overageStatusView(
        status,
        args.organization,
        enabled === undefined ? BILLING_UNKNOWN_NOTE : undefined,
      ),
      'set overage billing',
    );
  }

  @Tool({
    name: 'create_checkout_link',
    description:
      'Create a Stripe Checkout link to subscribe an organization to a paid plan. Owner only. ' +
      "The link is short-lived and tied to the organization's billing: hand it to the person " +
      'who pays and do not post it anywhere shared.',
    parameters: createCheckoutArgs,
    annotations: {
      title: 'Create checkout link',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async createCheckoutLink(
    @Payload() args: z.infer<typeof createCheckoutArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const enabled = await fetchBillingEnabled(glitchtip.client);
    if (enabled === false) {
      return error(billingDisabledSentence(glitchtip.instance.origin));
    }
    const raw = await asOwnerCall(
      glitchtip.client.call({ name: 'create checkout link', scopes: [] }, (api) =>
        api.POST(
          '/api/0/stripe/organizations/{organization_slug}/create-stripe-subscription-checkout/',
          {
            params: { path: { organization_slug: org } },
            body: { price: args.price },
          },
        ),
      ),
      org,
    );
    const session = parseOrMalformed(linkSessionSchema, raw);
    if (!isAbsoluteHttpsUrl(session.url)) {
      return error('GlitchTip returned an unexpected checkout response');
    }
    return this.output.render(
      args.format,
      linkView(session.url, enabled === undefined ? BILLING_UNKNOWN_NOTE : undefined),
    );
  }

  @Tool({
    name: 'create_billing_portal_link',
    description:
      "Create a Stripe billing-portal link where the organization's owner manages payment " +
      'method, invoices and cancellation. Owner only. The link is short-lived and tied to the ' +
      "organization's billing: hand it to the person who pays and do not post it anywhere shared.",
    parameters: createPortalArgs,
    annotations: {
      title: 'Create billing portal link',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async createBillingPortalLink(
    @Payload() args: z.infer<typeof createPortalArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const enabled = await fetchBillingEnabled(glitchtip.client);
    if (enabled === false) {
      return error(billingDisabledSentence(glitchtip.instance.origin));
    }
    const raw = await asOwnerCall(
      glitchtip.client.call({ name: 'create billing portal link', scopes: [] }, (api) =>
        api.POST('/api/0/stripe/organizations/{organization_slug}/create-billing-portal/', {
          params: { path: { organization_slug: org } },
        }),
      ),
      org,
    );
    const session = parseOrMalformed(linkSessionSchema, raw);
    if (!isAbsoluteHttpsUrl(session.url)) {
      return error('GlitchTip returned an unexpected billing-portal response');
    }
    return this.output.render(
      args.format,
      linkView(session.url, enabled === undefined ? BILLING_UNKNOWN_NOTE : undefined),
    );
  }

  @Tool({
    name: 'subscribe_free_plan',
    description:
      'Subscribe an organization to a free (zero-price) plan. Paid plans go through ' +
      '`create_checkout_link`.' +
      STRIPE_UNTRUSTED_SENTENCE,
    parameters: subscribeFreeArgs,
    annotations: {
      title: 'Subscribe to the free plan',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async subscribeFreePlan(
    @Payload() args: z.infer<typeof subscribeFreeArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const glitchtip = this.instances.connect(ctx.getRawRequest());
    const org = await glitchtip.organization(args.organization);
    const enabled = await fetchBillingEnabled(glitchtip.client);
    if (enabled === false) {
      return error(billingDisabledSentence(glitchtip.instance.origin));
    }
    const organizationDetail = await asMemberCall(
      glitchtip.client.call({ name: 'get organization', scopes: [] }, (api) =>
        api.GET('/api/0/organizations/{organization_slug}/', {
          params: { path: { organization_slug: org } },
        }),
      ),
      org,
    );
    const raw = await asOwnerCall(
      glitchtip.client.call({ name: 'subscribe to plan', scopes: [] }, (api) =>
        api.POST('/api/0/stripe/subscriptions/', {
          body: { price: args.price, organization: organizationDetail.id },
        }),
      ),
      org,
    );
    const created = parseOrMalformed(createSubscriptionResponseSchema, raw);
    return this.output.render(
      args.format,
      subscriptionView(
        created.subscription,
        org,
        enabled === undefined ? BILLING_UNKNOWN_NOTE : undefined,
      ),
    );
  }
}
