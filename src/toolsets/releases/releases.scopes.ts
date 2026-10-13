// Scopes GlitchTip accepts per route (`@has_permission`, v6.2.6, confirmed in
// apps/releases/api.py and apps/sourcecode/api.py).

/**
 * The release, file and repository-linkage routes: list/get/create/update/
 * delete release, list/get/delete release file. These accept only
 * project:releases — not project:write/admin — so a token with project write
 * rights can still be refused (spec §Errors).
 */
export const RELEASE_SCOPES = ['project:releases'] as const;

/** Deploy and commit routes, which accept a wider set than the release routes. */
export const DEPLOY_COMMIT_SCOPES = ['project:releases', 'project:write', 'project:admin'] as const;

/** Repository reads. */
export const REPO_READ_SCOPES = ['org:read', 'org:write', 'org:admin'] as const;

/** Repository creation. */
export const REPO_WRITE_SCOPES = ['org:write', 'org:admin'] as const;
