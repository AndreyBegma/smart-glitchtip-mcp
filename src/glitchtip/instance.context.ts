import { createHash } from 'node:crypto';
import { Redactor } from './redactor';

/**
 * The GlitchTip instance one request acts on: where, as whom, and in which
 * organization by default.
 *
 * The token is held in a private field so it cannot leak through
 * JSON.stringify, a structured log line or an error's inspected properties
 * (AGENTS.md rule 1). Code that needs it asks for the header or a redaction.
 */
export class ResolvedInstance {
  readonly #token: string | undefined;

  constructor(
    /** Normalised base URL (origin + optional path prefix). */
    readonly url: string,
    token: string | undefined,
    /** Explicit default organization (header or env), if any. */
    readonly defaultOrg?: string,
  ) {
    this.#token = token || undefined;
  }

  get origin(): string {
    return new URL(this.url).origin;
  }

  get hasToken(): boolean {
    return this.#token !== undefined;
  }

  authorizationHeader(): string | undefined {
    return this.#token === undefined ? undefined : `Bearer ${this.#token}`;
  }

  /** A stable, non-reversible key for caches scoped to this token. */
  tokenFingerprint(): string {
    return createHash('sha256')
      .update(this.#token ?? '')
      .digest('hex');
  }

  /**
   * What removes the token — and any secrets a caller holds besides it — from
   * text that may have come back from GlitchTip.
   */
  redactor(extraSecrets: readonly string[] = []): Redactor {
    return new Redactor(this.#token, extraSecrets);
  }

  toJSON(): object {
    return { url: this.url, defaultOrg: this.defaultOrg, token: this.#token ? '[redacted]' : null };
  }
}
