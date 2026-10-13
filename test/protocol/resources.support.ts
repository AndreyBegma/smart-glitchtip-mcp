import type { Client } from '@modelcontextprotocol/client';
import { type Booted, bootInMemory, GLITCHTIP } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Shared by the resources protocol specs (FEAT-20260925-019).

export const API = `${GLITCHTIP}/api/0`;
export const TOKEN = 'tok_TEST';
export const ORG = 'acme';

export const HEX_EVENT_ID = 'ab'.repeat(16);
export const UUID_EVENT_ID = '0123abcd-4567-89ef-0123-456789abcdef';

export const ISSUE = {
  id: '42',
  shortId: 'PROJ-42',
  title: 'TypeError: x is not a function',
  culprit: 'app.views.handler',
  count: '7',
  userCount: 3,
  numComments: 0,
  type: 'error',
  level: 'error',
  status: 'unresolved',
  metadata: {},
  project: { id: '1', slug: 'web', name: 'Web' },
  firstSeen: '2026-01-01T00:00:00Z',
  lastSeen: '2026-01-02T00:00:00Z',
  assignedTo: null,
  stats: { '24h': [] },
  permalink: 'Not implemented',
};

export const EVENT = {
  id: 'evt-1',
  eventID: HEX_EVENT_ID,
  projectID: 1,
  groupID: '42',
  dateCreated: '2026-01-02T03:04:05Z',
  dateReceived: '2026-01-02T03:04:06Z',
  type: 'error',
  message: '',
  tags: [{ key: 'level', value: 'error' }],
  title: 'ValueError: boom',
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'ValueError',
            value: 'boom',
            stacktrace: {
              frames: [{ filename: 'app.py', function: 'run', lineno: 1, in_app: true }],
            },
          },
        ],
      },
    },
  ],
  userReport: null,
};

export function issueUrl(org = ORG, id = 42): string {
  return `${API}/organizations/${org}/issues/${id}/`;
}

export function latestEventUrl(org = ORG, id = 42): string {
  return `${API}/organizations/${org}/issues/${id}/events/latest/`;
}

export function eventUrl(eventId: string, org = ORG, id = 42): string {
  return `${API}/organizations/${org}/issues/${id}/events/${eventId}/`;
}

/** A mock that answers the issue, its latest event and both by-id events for `org`. */
export function mockIssueAndEvents(org = ORG): MockGlitchTip {
  return new MockGlitchTip()
    .json('GET', issueUrl(org), ISSUE)
    .json('GET', latestEventUrl(org), EVENT)
    .json('GET', eventUrl(HEX_EVENT_ID, org), EVENT)
    .json('GET', eventUrl(UUID_EVENT_ID, org), EVENT);
}

/** Boots with a token and a default organization; toolsets are pinned by the caller. */
export function bootResources(env: NodeJS.ProcessEnv, mock: MockGlitchTip): Promise<Booted> {
  return bootInMemory({ GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_DEFAULT_ORG: ORG, ...env }, mock);
}

export function readResource(client: Client, uri: string) {
  return client.readResource({ uri });
}

/** The text of the one content item a read returns. */
export async function readResourceText(client: Client, uri: string): Promise<string> {
  const { contents } = await readResource(client, uri);
  const [item] = contents;
  return 'text' in item ? item.text : '';
}
