// Scopes GlitchTip accepts per route (`@has_permission`, v6.2.6, confirmed in
// apps/teams/api.py). They differ per route, so each group is named for the
// routes that use it (FEAT-20260925-007 spec, "GlitchTip endpoints").

/** list_teams also accepts the org:* scopes; every other team route does not. */
export const TEAM_LIST_SCOPES = [
  'team:read',
  'team:write',
  'team:admin',
  'org:read',
  'org:write',
  'org:admin',
] as const;

/** get_team. */
export const TEAM_READ_SCOPES = ['team:read', 'team:write', 'team:admin'] as const;

/** create_team also accepts the org:write/admin scopes; every other write route does not. */
export const TEAM_CREATE_SCOPES = ['team:write', 'team:admin', 'org:write', 'org:admin'] as const;

/** rename_team, add_member_to_team, remove_member_from_team. */
export const TEAM_WRITE_SCOPES = ['team:write', 'team:admin'] as const;

/** delete_team. */
export const TEAM_ADMIN_SCOPES = ['team:admin'] as const;
