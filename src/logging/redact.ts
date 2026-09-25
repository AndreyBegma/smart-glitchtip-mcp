/**
 * Removes secrets from free text before it is logged: every exact occurrence
 * of a known secret, and any `Bearer <value>` whatever the value. Structured
 * fields are covered by pino's redact paths; this is for messages and stacks,
 * which pino cannot see into.
 */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('[redacted]');
  }
  return result.replace(/(bearer\s+)(?!\[redacted\])\S+/gi, '$1[redacted]');
}
