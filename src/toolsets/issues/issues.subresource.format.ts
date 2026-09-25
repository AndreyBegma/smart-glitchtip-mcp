import { withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';
import { flatten } from './issues.format';

type Comment = components['schemas']['CommentSchema'];
type UserReport = components['schemas']['UserReportSchema'];
type IssueHash = components['schemas']['IssueHashSchema'];

export function issueCommentsView(issueId: number, page: Page<Comment>): View {
  return {
    text: () => {
      if (page.items.length === 0) return `No comments on issue ${issueId}.`;
      const blocks = page.items.map((c) => {
        const email = c.user?.email ?? 'unknown';
        const text = untrusted('comment.text', commentText(c));
        return `[${c.id ?? '-'}] ${email} — ${c.dateCreated}\n${text}`;
      });
      return withCursor(blocks.join('\n\n'), page.nextCursor);
    },
    json: () => ({
      issueId,
      comments: page.items.map((c) => ({
        id: c.id ?? null,
        email: c.user?.email ?? null,
        dateCreated: c.dateCreated,
        text: commentText(c),
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

/** Confirmation of adding or editing a comment: text() summary, json() the id and date. */
export function commentView(summary: string, comment: Comment): View {
  return {
    text: () => summary,
    json: () => ({ result: summary, id: comment.id ?? null, dateCreated: comment.dateCreated }),
  };
}

export function userReportsView(issueId: number, page: Page<UserReport>): View {
  return {
    text: () => {
      if (page.items.length === 0) return `No user reports on issue ${issueId}.`;
      const blocks = page.items.map((r) => {
        const comments = untrusted('user-report.comments', flatten(r.comments));
        return `${r.dateCreated} — ${r.name} <${r.email}> (event ${r.eventID})\n${comments}`;
      });
      return withCursor(blocks.join('\n\n'), page.nextCursor);
    },
    json: () => ({
      issueId,
      userReports: page.items.map((r) => ({
        id: r.id ?? null,
        dateCreated: r.dateCreated,
        name: r.name,
        email: r.email,
        eventID: r.eventID,
        comments: r.comments,
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function issueHashesView(issueId: number, page: Page<IssueHash>): View {
  return {
    text: () => {
      if (page.items.length === 0) return `No hashes on issue ${issueId}.`;
      const blocks = page.items.map((h) => {
        if (!h.latestEvent) return `${h.id}: no events`;
        const title = untrusted('event.title', flatten(h.latestEvent.title));
        return `${h.id}  event ${h.latestEvent.eventID}  ${h.latestEvent.dateCreated}\n${title}`;
      });
      return withCursor(blocks.join('\n\n'), page.nextCursor);
    },
    json: () => ({
      issueId,
      hashes: page.items.map((h) => ({
        id: h.id,
        latestEvent: h.latestEvent
          ? {
              eventID: h.latestEvent.eventID,
              title: h.latestEvent.title,
              dateCreated: h.latestEvent.dateCreated,
            }
          : null,
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

function commentText(comment: Comment): string {
  return comment.data.text ?? '';
}
