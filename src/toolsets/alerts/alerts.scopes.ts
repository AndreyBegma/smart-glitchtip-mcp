// Scopes GlitchTip accepts per route (`@has_permission`, v6.2.6, confirmed in
// apps/alerts/api.py; FEAT-20260925-009 spec, "GlitchTip endpoints").

/** list_project_alerts, and the read every other tool but create/delete does first. */
export const ALERT_READ_SCOPES = ['project:read', 'project:write', 'project:admin'] as const;

/** create, update (PUT), test. */
export const ALERT_WRITE_SCOPES = ['project:write', 'project:admin'] as const;

/** delete_project_alert. */
export const ALERT_ADMIN_SCOPES = ['project:admin'] as const;
