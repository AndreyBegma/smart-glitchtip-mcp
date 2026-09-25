# Toolset `billing`

Default off (`GLITCHTIP_TOOLSETS` must list `billing`). The four mutating tools are registered
only when `GLITCHTIP_READ_ONLY=false`.

Every tool accepts `format`: `text` (default, compact) or `json` (the same projected fields as
JSON, never the raw GlitchTip payload). Every result is bounded by `MCP_RESPONSE_BUDGET`. All
tools carry `openWorldHint: true`.

No billing route in GlitchTip 6.2.6 carries `@has_permission`: a read needs the token's user to
be a member of the organization, a write needs them to be its owner. Both cases answer `404`, not
`403` — the tool names both causes. A `403` is still possible for other reasons and is mapped by
the foundation as usual.

| Tool | GlitchTip endpoint | readOnly | destructive | idempotent | Who may call it | Read-only mode |
|---|---|---|---|---|---|---|
| `list_billing_plans` | `GET /api/0/stripe/products/` | yes | no | yes | any authenticated user | listed |
| `get_subscription` | `GET /api/0/stripe/subscriptions/{organization_slug}/` | yes | no | yes | member | listed |
| `get_event_usage` | `GET /api/0/stripe/subscriptions/{organization_slug}/events_count/period/` | yes | no | yes | member | listed |
| `get_daily_event_usage` | `GET /api/0/stripe/subscriptions/{organization_slug}/events_count/daily/` | yes | no | yes | member | listed |
| `get_instance_settings` | `GET /api/settings/` (+ `GET /api/settings/{organization_slug}/`) | yes | no | yes | anyone (unauthenticated) | listed |
| `get_overage_status` | `GET /api/0/stripe/subscriptions/{organization_slug}/overage/` | yes | no | yes | member | listed |
| `set_overage_billing` | `POST /api/0/stripe/organizations/{organization_slug}/overage/` | no | no | yes | owner | hidden |
| `create_checkout_link` | `POST /api/0/stripe/organizations/{organization_slug}/create-stripe-subscription-checkout/` | no | no | no | owner | hidden |
| `create_billing_portal_link` | `POST /api/0/stripe/organizations/{organization_slug}/create-billing-portal/` | no | no | no | owner | hidden |
| `subscribe_free_plan` | `GET /api/0/organizations/{organization_slug}/` then `POST /api/0/stripe/subscriptions/` | no | no | no | owner | hidden |

## The billing gate

Self-hosted instances run without Stripe: `GET /api/settings/` (no auth, not cached) is checked
before every Stripe call.

- `billingEnabled === false`: the three member-read tools (`list_billing_plans`,
  `get_subscription`, `get_overage_status`) answer with a **success** naming the instance and
  pointing at `get_event_usage`; the four write tools answer `isError` with the same sentence,
  before any Stripe request. `get_event_usage` and `get_daily_event_usage` are unaffected — they
  work on self-hosted instances too, over a rolling 30-day window.
- The settings response is malformed, or the call itself fails: every tool **degrades** — it
  proceeds with the Stripe call and adds "Could not confirm whether billing is enabled on this
  instance." It never answers "Internal error". For `create_checkout_link` and
  `create_billing_portal_link` this note is placed on its own line **above** the URL in text
  output (the URL always stays alone on its own line); `format: "json"` carries it as a `note`
  field alongside `url`. Every other gated tool appends the note after its normal output.
- `get_instance_settings` skips the gate: it is the gate's own route.

Every GlitchTip response this toolset reads is checked against its expected shape before
rendering (numbers where numbers are required, known enum values for `status`/`collectionMethod`):
a response that does not match — `{}` for an overage or usage endpoint, for example — is
`isError` ("did not expect"), never rendered as `$NaN` or as an empty-looking success. Stripe's
free-form `stripeID` and price `interval` values are fenced as untrusted text in `text` output
alongside the product/plan name and description (they are configured by whoever administers the
Stripe account, not by this server's operator); `status` is checked against GlitchTip's own
`SubscriptionStatus` enum instead, so an unexpected value fails closed rather than being rendered
verbatim.

## Untrusted text

Stripe product `name`, `description` and `marketingFeatures`, and GlitchTip's configured instance
name and sign-in provider names, were not written by the operator of this server (D-18).
`list_billing_plans`, `get_subscription` and `subscribe_free_plan` fence them with
`source="external"`; `get_instance_settings` fences its names with `source="glitchtip-config"`.
Every description that returns such text ends with a sentence saying so — always its last
sentence.

## `list_billing_plans`

List the subscription plans this GlitchTip instance sells.

| Input | Type | Default |
|---|---|---|
| `format` | `"text"` \| `"json"` | `text` |

No `organization`: the route is instance-wide. Text output is one block per plan: `stripeID`,
events quota, default price and the other prices (id, amount, interval), then the fenced name,
description and marketing features. Empty, with billing on, reads "This instance lists no public
plans."

## `get_subscription`

Show an organization's active subscription: plan, price, status, collection method and the
current billing cycle.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `format` | `"text"` \| `"json"` | `text` |

`subscriptionCycleStart`/`End` fall back to `currentPeriodStart`/`End` when GlitchTip does not
return a cycle. No active subscription reads "No active subscription for `<org>`." (success).

## `get_event_usage`

Show how many events an organization has used in its current billing period, or N periods back.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `periods_ago` | integer 0–24 | 0 |
| `format` | `"text"` \| `"json"` | `text` |

A value above the retention limit comes back from GlitchTip as a `400` naming the limit, passed
through. The output states whether the window is a Stripe billing cycle or a rolling 30 days.

## `get_daily_event_usage`

Show day-by-day event usage for an organization's current period.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `format` | `"text"` \| `"json"` | `text` |

A table `date | errors | transactions | uptime | logs`, one row per day plus a totals row. Empty
`data` reads "No usage recorded in the current period for `<org>`." (success).

## `get_instance_settings`

Show this GlitchTip instance's public settings.

| Input | Type | Default |
|---|---|---|
| `include_organization_login` | boolean | `false` |
| `organization` | slug | the default organization (only used when the above is `true`) |
| `format` | `"text"` \| `"json"` | `text` |

An allowlist: `version`, `glitchtipInstanceName` (fenced), `serverTimeZone`, `environment`,
`billingEnabled`, `iPaidForGlitchTip`, `enableUserRegistration`,
`enableSocialAppsUserRegistration`, `enableOrganizationCreation`, `enabledFeatures`, and each
sign-in provider as `name` (fenced), `provider`, `brand`. Never rendered:
`chatwootWebsiteToken`, `stripePublicKey`, `sentryDSN`, `plausibleUrl`, `plausibleDomain`,
`sentryTracesSampleRate`, and a provider's `client_id`/`scopes`. With
`include_organization_login: true`, also reads `GET /api/settings/{organization_slug}/` and lists
the SSO providers that organization's own login page offers; a failure there leaves the first
part as a success with "Organization login settings unavailable: `<message>`." Both settings
routes are anonymous.

## `get_overage_status`

Show whether metered overage billing is on for an organization, whether it is eligible, the spend
cap, the quota, current usage and the overage cost so far.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `format` | `"text"` \| `"json"` | `text` |

Cent amounts are rendered as currency with the raw cents in brackets.

## `set_overage_billing`

Turn metered overage billing on or off for an organization.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | **required**: a spend commitment never relies on a default |
| `enabled` | boolean | required |
| `cap_cents` | integer 1–10,000,000 | required when `enabled: true`; not accepted when `false` |
| `confirm` | string | required when `enabled: true`: must equal `cap_cents` as a string |
| `format` | `"text"` \| `"json"` | `text` |

A missing or wrong `confirm`, or `cap_cents`/`confirm` sent with `enabled: false`, is a validation
error before any request. Disabling always sends `capCents: 0` to GlitchTip — the spend cap resets
to 0, and re-enabling later always needs a fresh `cap_cents`. Output: the status, as
`get_overage_status`.

## `create_checkout_link`

Create a Stripe Checkout link to subscribe an organization to a paid plan. Owner only. Not
idempotent: each call creates a new Checkout session (and a Stripe customer, if the organization
has none).

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `price` | `price_...` id, from `list_billing_plans` | required |
| `format` | `"text"` \| `"json"` | `text` |

Output: the URL on its own line, nothing else. A response whose `url` does not parse as an
absolute `https:` URL is `isError`. The server never opens or fetches the URL.

## `create_billing_portal_link`

Create a Stripe billing-portal link where the organization's owner manages payment method,
invoices and cancellation. Owner only, not idempotent.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `format` | `"text"` \| `"json"` | `text` |

Output and response check as `create_checkout_link` (the `isError` wording for a bad `url` says
"billing-portal response", not "checkout response").

## `subscribe_free_plan`

Subscribe an organization to a free (zero-price) plan. Paid plans go through
`create_checkout_link`. Not idempotent.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `price` | `price_...` id | required |
| `format` | `"text"` \| `"json"` | `text` |

Reads the organization first (`GET /api/0/organizations/{organization_slug}/`) to get its numeric
id as a string, which the subscribe body needs; a failure of that read stops the tool before the
`POST`. GlitchTip answers `404` for a non-zero, metered or inactive price, and `400` ("Customer
already has subscription") when one is active; both are passed through. Output: the new
subscription, as `get_subscription`.
