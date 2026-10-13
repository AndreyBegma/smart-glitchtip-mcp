import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, resultText } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';
import {
  bootResources,
  EVENT,
  eventUrl,
  HEX_EVENT_ID,
  ISSUE,
  issueUrl,
  latestEventUrl,
  mockIssueAndEvents,
  readResource,
  readResourceText,
  UUID_EVENT_ID,
} from './resources.support';

// FEAT-20260925-019, acceptance 4: resources/read against the mocked
// GlitchTip. A resource body is exactly the matching tool's text (D-26), plus
// one `Latest event:` line on the issue when the events toolset is on.

const BOTH = { GLITCHTIP_TOOLSETS: 'issues,events' };

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

describe('glitchtip://issues/{issue_id}', () => {
  it("returns get_issue's text plus the Latest event line, echoing the URI", async () => {
    const mock = mockIssueAndEvents();
    booted = await bootResources(BOTH, mock);
    const result = await readResource(booted.client, 'glitchtip://issues/42');
    expect(result.contents).toHaveLength(1);
    const [item] = result.contents;
    expect(item).toMatchObject({ uri: 'glitchtip://issues/42', mimeType: 'text/plain' });
    expect(mock.requests.map((r) => `${r.method} ${r.url.href}`)).toEqual([`GET ${issueUrl()}`]);

    const tool = resultText(
      await booted.client.callTool({ name: 'get_issue', arguments: { issue_id: 42 } }),
    );
    expect('text' in item && item.text).toBe(
      `${tool}\nLatest event: glitchtip://issues/42/events/latest`,
    );
  });

  it('has no Latest event line when the events toolset is off', async () => {
    const mock = mockIssueAndEvents();
    booted = await bootResources({ GLITCHTIP_TOOLSETS: 'issues' }, mock);
    const text = await readResourceText(booted.client, 'glitchtip://issues/42');
    const tool = resultText(
      await booted.client.callTool({ name: 'get_issue', arguments: { issue_id: 42 } }),
    );
    expect(text).toBe(tool);
    expect(text).not.toContain('Latest event:');
  });

  it('reads from ?organization and carries it into the Latest event line', async () => {
    const mock = new MockGlitchTip().json('GET', issueUrl('other'), ISSUE);
    booted = await bootResources(BOTH, mock);
    const text = await readResourceText(booted.client, 'glitchtip://issues/42?organization=other');
    expect(mock.requests.map((r) => r.url.href)).toEqual([issueUrl('other')]);
    expect(text.split('\n').at(-1)).toBe(
      'Latest event: glitchtip://issues/42/events/latest?organization=other',
    );
  });

  it('leaves the query off the Latest event line when the organization is the default', async () => {
    booted = await bootResources(BOTH, mockIssueAndEvents());
    const text = await readResourceText(booted.client, 'glitchtip://issues/42');
    expect(text.split('\n').at(-1)).toBe('Latest event: glitchtip://issues/42/events/latest');
  });

  it('accepts a percent-encoded id, judged on its decoded value', async () => {
    const mock = mockIssueAndEvents();
    booted = await bootResources(BOTH, mock);
    await readResourceText(booted.client, 'glitchtip://issues/%342');
    expect(mock.requests.map((r) => r.url.href)).toEqual([issueUrl()]);
  });
});

describe('glitchtip://issues/{issue_id}/events/{event_id}', () => {
  it("latest reads the latest route and returns get_latest_event's text", async () => {
    const mock = mockIssueAndEvents();
    booted = await bootResources(BOTH, mock);
    const result = await readResource(booted.client, 'glitchtip://issues/42/events/latest');
    const [item] = result.contents;
    expect(item).toMatchObject({
      uri: 'glitchtip://issues/42/events/latest',
      mimeType: 'text/plain',
    });
    expect(mock.requests.map((r) => r.url.href)).toEqual([latestEventUrl()]);

    const tool = resultText(
      await booted.client.callTool({ name: 'get_latest_event', arguments: { issue_id: 42 } }),
    );
    expect('text' in item && item.text).toBe(tool);
    expect(tool).toContain(EVENT.title);
  });

  it.each([
    ['32 hex digits', HEX_EVENT_ID],
    ['a UUID', UUID_EVENT_ID],
  ])("an event id of %s reads the by-id route with get_event's text", async (_label, id) => {
    const mock = mockIssueAndEvents();
    booted = await bootResources(BOTH, mock);
    const text = await readResourceText(booted.client, `glitchtip://issues/42/events/${id}`);
    expect(mock.requests.map((r) => r.url.href)).toEqual([eventUrl(id)]);
    const tool = resultText(
      await booted.client.callTool({
        name: 'get_event',
        arguments: { issue_id: 42, event_id: id },
      }),
    );
    expect(text).toBe(tool);
  });

  it('reads the event from ?organization', async () => {
    const mock = mockIssueAndEvents('other');
    booted = await bootResources(BOTH, mock);
    await readResourceText(booted.client, 'glitchtip://issues/42/events/latest?organization=other');
    expect(mock.requests.map((r) => r.url.href)).toEqual([latestEventUrl('other')]);
  });
});
