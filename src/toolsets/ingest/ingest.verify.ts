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
 * runs out — each attempt's own timeout is the time left in that budget
 * (floored at the client's 100 ms minimum), so a slow poll cannot itself run
 * past `wait_seconds`. `noRetry` is set too (BUG-20260925-018 item 7):
 * `timeoutMs` alone bounds one fetch attempt, not a hidden 429/5xx retry and
 * its `Retry-After` sleep between attempts, which could otherwise carry one
 * poll well past `wait_seconds` on its own (PR #43 review: up to ~20 s).
 * Every branch here appends to an already-successful
 * send — none of them turns it into `isError` (a 401 or 403 here means the
 * server's own token was rejected or lacks permission to read events, not
 * that the DSN key failed).
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
    const timeoutMs = Math.max(100, deadline - Date.now());
    let response: Awaited<ReturnType<typeof client.raw>>;
    try {
      response = await client.raw(
        VERIFY_OPERATION,
        'GET',
        `/api/0/projects/${org}/${project}/events/${eventId}/`,
        { timeoutMs, noRetry: true },
      );
    } catch {
      // A per-attempt timeout or transport failure on the poll is not a
      // reason to fail an already-successful send; stop polling and report
      // it the same way as running out of wait_seconds.
      break;
    }
    if (response.status === 200) {
      const groupId = groupIdOf(response.text);
      return groupId
        ? `Processed: the event is visible (issue ${groupId}).`
        : 'Processed: the event is visible.';
    }
    if (response.status === 403) {
      return 'The token cannot read events to verify this (403 on the poll); the send itself succeeded.';
    }
    if (response.status === 401) {
      return "The server's own token was rejected while verifying (401); the send itself succeeded.";
    }
    if (Date.now() + POLL_INTERVAL_MS > deadline) break;
    await sleep(POLL_INTERVAL_MS);
  }
  return (
    `Accepted but not visible after ${waitSeconds} s. The worker may be behind; this is not a ` +
    'DSN failure.'
  );
}
