import { z } from 'zod';

// GlitchTip response shapes are checked against these before they reach a
// view (spec Errors: "every response is checked ... before it is rendered").
// A response that does not match is `malformed`, never a silent $NaN or an
// empty-looking success (`{}` for overage or usage must not render as one).
// `parseOrMalformed` throws a plain `TypeError`, which `ToolErrorFilter`
// already maps to the agent-facing `malformed` message for any handler, not
// only inside a `View` (BUG-20260925-006).

const priceSchema = z.object({
  stripeID: z.string().min(1),
  price: z.string().min(1),
  interval: z.string().min(1),
});

export const overageStatusSchema = z.object({
  enabled: z.boolean(),
  eligible: z.boolean(),
  configured: z.boolean(),
  capCents: z.number(),
  capUnits: z.number(),
  quota: z.number(),
  usage: z.number(),
  overageUnits: z.number(),
  overageCostCents: z.number(),
  throttleRate: z.number(),
});

export const subscriptionUsageSchema = z.object({
  total: z.number(),
  eventCount: z.number(),
  transactionEventCount: z.number(),
  uptimeCheckEventCount: z.number(),
  logEventCount: z.number(),
  fileSizeMb: z.number(),
});

const dailyEventCountEntrySchema = z.object({
  date: z.string().min(1),
  eventCount: z.number(),
  transactionEventCount: z.number(),
  uptimeCheckEventCount: z.number(),
  logEventCount: z.number(),
});

export const dailyEventsCountSchema = z.object({ data: z.array(dailyEventCountEntrySchema) });

const stripeProductSchema = z.object({
  stripeID: z.string().min(1),
  events: z.number(),
  name: z.string(),
  description: z.string(),
  default_price_id: z.string().nullish(),
});

// `status` and `collectionMethod` are Stripe-configured, free-form as far as
// this server is concerned: GlitchTip's declared enum is a snapshot of what
// Stripe offered when it was taken, not a contract Stripe keeps. Checking
// against it here would turn a new, legitimate value into `malformed` for
// the whole subscription; instead they are read as plain strings and fenced
// as untrusted text in `subscriptionView`, like stripeID and interval.
// `created`/`startDate` are in the generated schema but nothing here reads
// them, so they are not validated at all — requiring a shape this server
// never uses would fail a response for no benefit.
export const stripeSubscriptionSchema = z.object({
  stripeID: z.string().min(1),
  product: stripeProductSchema,
  price: priceSchema,
  status: z.string().nullable(),
  collectionMethod: z.string().min(1),
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  subscriptionCycleStart: z.string().nullish(),
  subscriptionCycleEnd: z.string().nullish(),
});

export const createSubscriptionResponseSchema = z.object({
  subscription: stripeSubscriptionSchema,
});

export const stripeProductExpandedPriceSchema = z.object({
  stripeID: z.string().min(1),
  defaultPrice: priceSchema,
  prices: z.array(priceSchema),
  marketingFeatures: z.array(z.string()),
  events: z.number(),
  name: z.string(),
  description: z.string(),
});

export const linkSessionSchema = z.object({ url: z.string().min(1) });

export const socialAppSchema = z.object({
  name: z.string(),
  provider: z.string(),
  brand: z.string(),
});

export const settingsOutSchema = z.object({
  version: z.string(),
  glitchtipInstanceName: z.string().nullable(),
  serverTimeZone: z.string(),
  environment: z.string().nullable(),
  billingEnabled: z.boolean(),
  iPaidForGlitchTip: z.boolean(),
  enableUserRegistration: z.boolean(),
  enableSocialAppsUserRegistration: z.boolean(),
  enableOrganizationCreation: z.boolean(),
  enabledFeatures: z.array(z.string()),
  socialApps: z.array(socialAppSchema),
});

export const loginSettingsOutSchema = z.object({ socialApps: z.array(socialAppSchema) });

/**
 * Parses `value` against `schema`; a mismatch is a `TypeError` (never a
 * `ZodError`, which `ToolErrorFilter` would not recognise), so it maps to
 * the same `malformed` tool result as any other unexpected GlitchTip shape.
 */
export function parseOrMalformed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new TypeError(
      `GlitchTip response did not match the expected shape: ${result.error.message}`,
    );
  }
  return result.data;
}
