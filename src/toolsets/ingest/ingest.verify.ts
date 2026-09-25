import type { GlitchTipClient } from '../../glitchtip/glitchtip.client';

const POLL_INTERVAL_MS = 2000;
const VERIFY_OPERATION = { name: 'verify test event visible', scopes: [] };

function groupIdOf(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { groupID?: unknown };
    return typeof body.groupID === 'string' ? body.groupID : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ingest is asynchronous (spec "Verification"): the store route queues a
 * task, so a freshly-accepted event is not immediately readable. Polls
 * `GET .../events/{eventId}/` every 2s until it is visible or `waitSeconds`
 * runs out. Every branch here appends to an already-successful send — none
 * of them turns it into `isError` (a 403 here means the token cannot read
 * events, not that the DSN key failed).
 */
export async function verifyEventVisible(
  client: GlitchTipClient,
  org: string,
  project: string,
  eventId: string,
  waitSeconds: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<string> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const response = await client.raw(
      VERIFY_OPERATION,
      'GET',
      `/api/0/projects/${org}/${project}/events/${eventId}/`,
    );
    if (response.status === 200) {
      const groupId = groupIdOf(response.text);
      return groupId
        ? `Processed: the event is visible (issue ${groupId}).`
        : 'Processed: the event is visible.';
    }
    if (response.status === 403) {
      return 'The token cannot read events to verify this (403 on the poll); the send itself succeeded.';
    }
    if (Date.now() + POLL_INTERVAL_MS > deadline) break;
    await sleep(POLL_INTERVAL_MS);
  }
  return (
    `Accepted but not visible after ${waitSeconds} s. The worker may be behind; this is not a ` +
    'DSN failure.'
  );
}
