import type { components } from '../../glitchtip/generated/schema';

// add_release_commits' merge. GlitchTip's POST replaces the release's whole commit
// list, so every stored commit is re-sent: one left out is deleted, and one re-sent
// with a default overwrites what GlitchTip holds (AGENTS.md rule 15).

type CommitIn = components['schemas']['CommitIn'];

/** A commit as the caller gives it. */
export interface CommitInput {
  readonly id: string;
  readonly message?: string;
  readonly author_name?: string;
  readonly author_email?: string;
}

export type CommitMerge =
  | { readonly commits: CommitIn[]; readonly added: number; readonly updated: number }
  | { readonly refusal: string };

/** The stored fields a re-sent commit carries, and the parameter that supplies each. */
const STORED_FIELDS = [
  { field: 'message', param: 'message' },
  { field: 'authorName', param: 'author_name' },
  { field: 'authorEmail', param: 'author_email' },
] as const;

/**
 * The list to POST: the stored commits (deduplicated by id, last wins, in
 * place), each input commit replacing the stored one of its id or appended.
 * A stored `null` is re-sent as `''`. Refuses — never drops, never defaults —
 * when a stored commit's id is not a string, or when one the caller does not
 * send again lacks a field it must re-send. Commits are named by position:
 * their contents are GlitchTip data (AGENTS.md rule 14).
 */
export function mergeCommits(
  stored: readonly unknown[],
  inputs: readonly CommitInput[],
): CommitMerge {
  const resent = new Set(inputs.map((c) => c.id));
  const byId = new Map<string, CommitIn>();
  for (const [index, raw] of stored.entries()) {
    const commit = (raw ?? {}) as Record<string, unknown>;
    const position = index + 1;
    if (typeof commit.id !== 'string') {
      return {
        refusal:
          `Not attached: stored commit ${position} has an id that is not a string, so the ` +
          'list cannot be re-sent without deleting it. Nothing was changed.',
      };
    }
    const unusable = resent.has(commit.id) ? undefined : unusableField(commit);
    if (unusable) {
      const what =
        commit[unusable.field] === undefined
          ? `did not include ${unusable.param}`
          : `returned a ${unusable.param} that is not text`;
      return {
        refusal:
          `Not attached: GlitchTip's response ${what} for stored commit ${position}, so it ` +
          'cannot be preserved; send that commit again with its values, or retry. Nothing was ' +
          'changed.',
      };
    }
    // Map order is first insertion: a duplicate id keeps its first position, last values.
    byId.set(commit.id, storedCommit(commit.id, commit));
  }
  return mergeInputs([...byId.values()], inputs);
}

function mergeInputs(stored: CommitIn[], inputs: readonly CommitInput[]): CommitMerge {
  const commits = [...stored];
  const indexById = new Map(commits.map((c, i) => [c.id, i]));
  let added = 0;
  let updated = 0;
  for (const input of inputs) {
    const entry: CommitIn = {
      id: input.id,
      message: input.message ?? '',
      authorName: input.author_name ?? '',
      authorEmail: input.author_email ?? '',
    };
    const index = indexById.get(input.id);
    if (index === undefined) {
      indexById.set(input.id, commits.length);
      commits.push(entry);
      added++;
    } else {
      commits[index] = entry;
      updated++;
    }
  }
  return { commits, added, updated };
}

/** The first field that is neither text nor `null`: absent, or malformed. */
function unusableField(commit: Record<string, unknown>) {
  return STORED_FIELDS.find(({ field }) => {
    const value = commit[field];
    return value !== null && typeof value !== 'string';
  });
}

/** Called once every field is text or `null`; `null` goes back as `''` ("none"). */
function storedCommit(id: string, commit: Record<string, unknown>): CommitIn {
  return {
    id,
    message: (commit.message as string | null) ?? '',
    authorName: (commit.authorName as string | null) ?? '',
    authorEmail: (commit.authorEmail as string | null) ?? '',
  };
}
