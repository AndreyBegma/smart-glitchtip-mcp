// Scopes GlitchTip accepts per route (`@has_permission`, v6.2.6, confirmed in
// apps/issue_events/api/{issues,comments,hashes,user_reports}.py). They differ
// per sub-resource, so each group is named for the routes that use it.

/** issue reads: list/get issue, stats, tags, commits, user reports. */
export const ISSUE_READ_SCOPES = ['event:read', 'event:write', 'event:admin'] as const;

/** comment reads only — GlitchTip does not accept event:write here. */
export const COMMENT_READ_SCOPES = ['event:read', 'event:admin'] as const;

/** hash reads only. */
export const HASH_READ_SCOPES = ['event:read'] as const;

/** issue and comment mutations that are not hash/comment deletion. */
export const ISSUE_WRITE_SCOPES = ['event:write', 'event:admin'] as const;

/** comment deletion and hash unmerge. */
export const ISSUE_ADMIN_SCOPES = ['event:admin'] as const;
