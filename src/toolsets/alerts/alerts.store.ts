import type { GlitchTipClient } from '../../glitchtip/glitchtip.client';
import { GlitchTipError } from '../../glitchtip/glitchtip.errors';
import { alertCall, alertNotFoundMessage } from './alert-errors';
import type { Alert } from './alerts.format';
import type { AlertScalars, RecipientIn } from './alerts.payload';
import { ALERT_READ_SCOPES, ALERT_WRITE_SCOPES } from './alerts.scopes';
import { type Secrets, secretsFrom } from './alerts.secrets';

// Reading one alert and writing it back whole — the two halves of every
// read-merge-write in this toolset. The pair is not atomic; a concurrent
// edit between them is lost (spec "Risks": accepted, the API offers nothing
// better).

/** Where an alert lives. */
export interface AlertTarget {
  readonly org: string;
  readonly project: string;
  readonly alertId: number;
}

/** An alert as read, with the scrub list of every secret its recipients hold. */
export interface AlertSnapshot {
  readonly alert: Alert;
  readonly secrets: Secrets;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/**
 * Reads one alert. GlitchTip has no single-alert GET [Decided by spec
 * author], so this pages the project's list — 100 per page, at most 10
 * pages — and filters by id. Not found is a `not_found` tool error; so is
 * running out of pages, and the message says where it stopped.
 */
export async function readAlert(
  client: GlitchTipClient,
  target: AlertTarget,
): Promise<AlertSnapshot> {
  const { org, project, alertId } = target;
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    const page = await client.page(
      {
        name: 'list project alerts',
        scopes: ALERT_READ_SCOPES,
        resource: 'Project',
        id: project,
        org,
      },
      (api) =>
        api.GET('/api/0/projects/{organization_slug}/{project_slug}/alerts/', {
          params: {
            path: { organization_slug: org, project_slug: project },
            query: { limit: PAGE_SIZE, cursor },
          },
        }),
    );
    const alert = page.items.find((item) => item?.id === alertId);
    if (alert) return { alert, secrets: storedSecrets(alert) };
    if (!page.nextCursor) {
      throw new GlitchTipError('not_found', alertNotFoundMessage(alertId, project));
    }
    cursor = page.nextCursor;
  }
  throw new GlitchTipError(
    'not_found',
    `Alert ${alertId} was not found in the first ${PAGE_SIZE * MAX_PAGES} alerts of ${project}; the search stopped there.`,
  );
}

/**
 * PUTs the complete alert: `scalars` and every recipient in `recipients` —
 * GlitchTip deletes any recipient the body leaves out. Errors are scrubbed
 * of `secrets`.
 */
export function writeAlert(
  client: GlitchTipClient,
  target: AlertTarget,
  scalars: AlertScalars,
  recipients: RecipientIn[],
  secrets: Secrets,
): Promise<Alert | undefined> {
  const { org, project, alertId } = target;
  return alertCall(
    client.call<Alert | undefined>(
      { name: 'update project alert', scopes: ALERT_WRITE_SCOPES, org },
      (api) =>
        api.PUT('/api/0/projects/{organization_slug}/{project_slug}/alerts/{alert_id}/', {
          params: {
            path: { organization_slug: org, project_slug: project, alert_id: alertId },
          },
          body: { ...scalars, alertRecipients: recipients },
        }),
    ),
    { secrets, notFound: alertNotFoundMessage(alertId, project) },
  );
}

/** Every recipient URL and Zulip key an alert holds; tolerant of a malformed payload. */
function storedSecrets(alert: Alert): Secrets {
  const recipients: unknown[] = Array.isArray(alert.alertRecipients) ? alert.alertRecipients : [];
  const urls: unknown[] = [];
  const keys: unknown[] = [];
  for (const recipient of recipients) {
    if (typeof recipient !== 'object' || recipient === null) continue;
    const { url, config } = recipient as { url?: unknown; config?: unknown };
    urls.push(url);
    if (typeof config === 'object' && config !== null) {
      keys.push((config as { api_key?: unknown }).api_key);
    }
  }
  return secretsFrom(urls, keys);
}
