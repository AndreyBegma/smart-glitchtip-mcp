import { keyValues, table } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';

type Product = components['schemas']['StripeProductExpandedPriceSchema'];
type Price = components['schemas']['StripeNestedPriceSchema'];
type Subscription = components['schemas']['StripeSubscriptionSchema'];
type Usage = components['schemas']['SubscriptionUsageSchema'];
type DailyEntry = components['schemas']['DailyEventCountEntry'];
type Settings = components['schemas']['SettingsOut'];
type SocialApp = components['schemas']['SocialAppSchema'];
type Overage = components['schemas']['OverageStatusSchema'];

// Views project GlitchTip's payloads down to the fields an agent uses (D-12).
// Stripe product name/description/marketingFeatures and instance/provider
// names an operator configured are untrusted text (D-18) and are wrapped
// with untrusted() in text output; json declares its own `untrusted` fence.
// Every field read here is guarded against a malformed/partial response
// (optional chaining, `?? ''`) so a bad payload degrades the text, never
// throws (ToolOutput maps a thrown TypeError to the `malformed` message).

const FIELD_CAP = 2000;

function capText(text: string, limit = FIELD_CAP): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function appendNote(body: string, note?: string): string {
  return note ? `${body}\n\n${note}` : body;
}

/** A plain confirmation or gate message with no richer shape (D-12). */
export function messageView(text: string): View {
  return { text: () => text, json: () => ({ result: text }) };
}

function priceLine(price: Price): string {
  const stripeID = untrusted('price.stripeID', capText(price.stripeID), 'external');
  const interval = untrusted('price.interval', capText(price.interval), 'external');
  return `${stripeID} ${price.price} / ${interval}`;
}

function otherPrices(product: Product): Price[] {
  return product.prices.filter((price) => price.stripeID !== product.defaultPrice.stripeID);
}

export function billingPlansListView(products: readonly Product[], note?: string): View {
  return {
    untrusted: { field: 'plans', source: 'external' },
    text: () => {
      if (products.length === 0) return appendNote('This instance lists no public plans.', note);
      const blocks = products.map((product) => {
        const rest = otherPrices(product);
        const stripeID = untrusted('stripeID', capText(product.stripeID), 'external');
        const lines = [
          `${stripeID} — events quota: ${product.events}`,
          `  default price: ${priceLine(product.defaultPrice)}`,
          rest.length > 0
            ? `  other prices: ${rest.map(priceLine).join('; ')}`
            : '  other prices: none',
          `  name: ${untrusted('name', capText(product.name), 'external')}`,
          `  description: ${untrusted('description', capText(product.description), 'external')}`,
          `  features: ${untrusted('features', capText(product.marketingFeatures.join('; ')), 'external')}`,
        ];
        return lines.join('\n');
      });
      return appendNote(blocks.join('\n\n'), note);
    },
    json: () => ({
      plans: products.map((product) => ({
        stripeID: product.stripeID,
        events: product.events,
        defaultPrice: product.defaultPrice,
        prices: otherPrices(product),
        name: product.name,
        description: product.description,
        marketingFeatures: product.marketingFeatures,
      })),
      ...(note ? { note } : {}),
    }),
  };
}

export function subscriptionView(
  subscription: Subscription | null,
  org: string,
  note?: string,
): View {
  return {
    untrusted: { field: 'subscription', source: 'external' },
    text: () => {
      if (!subscription) return appendNote(`No active subscription for ${org}.`, note);
      const cycleStart = subscription.subscriptionCycleStart ?? subscription.currentPeriodStart;
      const cycleEnd = subscription.subscriptionCycleEnd ?? subscription.currentPeriodEnd;
      const body = keyValues([
        ['plan', untrusted('product.name', capText(subscription.product.name), 'external')],
        ['events quota', subscription.product.events],
        ['price', priceLine(subscription.price)],
        ['status', subscription.status ?? 'none'],
        ['collectionMethod', subscription.collectionMethod],
        ['currentPeriodStart', subscription.currentPeriodStart],
        ['currentPeriodEnd', subscription.currentPeriodEnd],
        ['subscriptionCycleStart', cycleStart],
        ['subscriptionCycleEnd', cycleEnd],
      ]);
      return appendNote(body, note);
    },
    json: () =>
      subscription === null
        ? { subscription: null, ...(note ? { note } : {}) }
        : { subscription, ...(note ? { note } : {}) },
  };
}

export function eventUsageView(usage: Usage, windowLine: string): View {
  return {
    text: () =>
      `${keyValues([
        ['total', usage.total],
        ['eventCount', usage.eventCount],
        ['transactionEventCount', usage.transactionEventCount],
        ['uptimeCheckEventCount', usage.uptimeCheckEventCount],
        ['logEventCount', usage.logEventCount],
        ['fileSizeMb', usage.fileSizeMb],
      ])}\n\n${windowLine}`,
    json: () => ({ ...usage, windowLine }),
  };
}

export function dailyEventUsageView(entries: readonly DailyEntry[], org: string): View {
  return {
    text: () => {
      if (entries.length === 0) return `No usage recorded in the current period for ${org}.`;
      const totals: DailyEntry = entries.reduce(
        (sum, e) => ({
          date: 'total',
          eventCount: sum.eventCount + e.eventCount,
          transactionEventCount: sum.transactionEventCount + e.transactionEventCount,
          uptimeCheckEventCount: sum.uptimeCheckEventCount + e.uptimeCheckEventCount,
          logEventCount: sum.logEventCount + e.logEventCount,
        }),
        {
          date: 'total',
          eventCount: 0,
          transactionEventCount: 0,
          uptimeCheckEventCount: 0,
          logEventCount: 0,
        },
      );
      return table(
        [...entries, totals],
        [
          { header: 'date', value: (e) => e.date },
          { header: 'errors', value: (e) => e.eventCount },
          { header: 'transactions', value: (e) => e.transactionEventCount },
          { header: 'uptime', value: (e) => e.uptimeCheckEventCount },
          { header: 'logs', value: (e) => e.logEventCount },
        ],
      );
    },
    json: () => ({ organization: org, days: entries }),
  };
}

function providerLines(apps: readonly SocialApp[]): string {
  if (apps.length === 0) return 'none';
  return apps
    .map(
      (app) =>
        `${untrusted('provider.name', capText(app.name), 'glitchtip-config')} (${app.provider}, ${app.brand})`,
    )
    .join('; ');
}

export function instanceSettingsView(
  settings: Settings,
  organizationLogin?: { org: string; apps: readonly SocialApp[] } | { error: string },
): View {
  return {
    untrusted: { field: 'settings', source: 'glitchtip-config' },
    text: () => {
      const lines = keyValues([
        ['version', settings.version],
        [
          'glitchtipInstanceName',
          settings.glitchtipInstanceName
            ? untrusted('instanceName', capText(settings.glitchtipInstanceName), 'glitchtip-config')
            : undefined,
        ],
        ['serverTimeZone', settings.serverTimeZone],
        ['environment', settings.environment ?? undefined],
        ['billingEnabled', settings.billingEnabled],
        ['iPaidForGlitchTip', settings.iPaidForGlitchTip],
        ['enableUserRegistration', settings.enableUserRegistration],
        ['enableSocialAppsUserRegistration', settings.enableSocialAppsUserRegistration],
        ['enableOrganizationCreation', settings.enableOrganizationCreation],
        ['enabledFeatures', settings.enabledFeatures.join(', ') || 'none'],
        ['sign-in providers', providerLines(settings.socialApps)],
      ]);
      const orgLine = !organizationLogin
        ? undefined
        : 'error' in organizationLogin
          ? `Organization login settings unavailable: ${organizationLogin.error}`
          : `organization login providers (${organizationLogin.org}): ${providerLines(organizationLogin.apps)}`;
      return [lines, orgLine].filter((v) => v !== undefined).join('\n\n');
    },
    json: () => ({
      version: settings.version,
      glitchtipInstanceName: settings.glitchtipInstanceName,
      serverTimeZone: settings.serverTimeZone,
      environment: settings.environment,
      billingEnabled: settings.billingEnabled,
      iPaidForGlitchTip: settings.iPaidForGlitchTip,
      enableUserRegistration: settings.enableUserRegistration,
      enableSocialAppsUserRegistration: settings.enableSocialAppsUserRegistration,
      enableOrganizationCreation: settings.enableOrganizationCreation,
      enabledFeatures: settings.enabledFeatures,
      signInProviders: settings.socialApps.map(providerProjection),
      ...(organizationLogin && !('error' in organizationLogin)
        ? {
            organizationLogin: {
              organization: organizationLogin.org,
              providers: organizationLogin.apps.map(providerProjection),
            },
          }
        : {}),
      ...(organizationLogin && 'error' in organizationLogin
        ? { organizationLoginError: organizationLogin.error }
        : {}),
    }),
  };
}

function providerProjection(app: SocialApp): { name: string; provider: string; brand: string } {
  return { name: app.name, provider: app.provider, brand: app.brand };
}

function currency(cents: number): string {
  return `$${(cents / 100).toFixed(2)} (${cents}c)`;
}

export function overageStatusView(status: Overage, org: string, note?: string): View {
  return {
    text: () =>
      appendNote(
        keyValues([
          ['organization', org],
          ['enabled', status.enabled],
          ['eligible', status.eligible],
          ['configured', status.configured],
          ['cap', currency(status.capCents)],
          ['capUnits', status.capUnits],
          ['quota', status.quota],
          ['usage', status.usage],
          ['overageUnits', status.overageUnits],
          ['overageCost', currency(status.overageCostCents)],
          ['throttleRate', status.throttleRate],
        ]),
        note,
      ),
    json: () => ({ organization: org, ...status, ...(note ? { note } : {}) }),
  };
}

/** The note, if any, goes on its own line above the URL — the URL always stays alone on its line. */
export function linkView(url: string, note?: string): View {
  return {
    text: () => (note ? `${note}\n${url}` : url),
    json: () => ({ url, ...(note ? { note } : {}) }),
  };
}
