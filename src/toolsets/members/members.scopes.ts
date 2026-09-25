// Scopes GlitchTip accepts per route (`@has_permission`, v6.2.6, confirmed in
// apps/organizations_ext/api.py). They differ per route, so each group is
// named for the routes that use it (FEAT-20260925-007 spec, "GlitchTip
// endpoints").

/** list_members, get_member. */
export const MEMBER_READ_SCOPES = ['member:read', 'member:write', 'member:admin'] as const;

/** invite_member, update_member_role. */
export const MEMBER_WRITE_SCOPES = ['member:write', 'member:admin'] as const;

/** remove_member, transfer_organization_ownership. */
export const MEMBER_ADMIN_SCOPES = ['member:admin'] as const;
