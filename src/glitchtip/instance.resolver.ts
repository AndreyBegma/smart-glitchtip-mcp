import { Inject, Injectable, Optional } from '@nestjs/common';
import { AgentFacingError } from '../agent-facing.error';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { normalizeInstanceUrl } from '../config/instance-url';
import { authGrantOf } from './auth-grant';
import { type FetchLike, GlitchTipClient } from './glitchtip.client';
import { ResolvedInstance } from './instance.context';

/** DI token for the fetch the GlitchTip client uses; tests provide a mock. */
export const GLITCHTIP_FETCH = Symbol('GLITCHTIP_FETCH');

/** A request's instance could not be determined; the message tells the agent why. */
export class InstanceError extends AgentFacingError {}

/** No organization was given and the token does not see exactly one. */
export class NoDefaultOrganizationError extends InstanceError {
  constructor(
    /** Slugs visible on the first page of the lookup. */
    readonly visible: readonly string[],
    /** More organizations exist beyond `visible`. */
    readonly more: boolean,
  ) {
    super(
      visible.length === 0
        ? 'No organizations are visible to this token, so none can be chosen by default.'
        : `Several organizations are visible to this token (${visible.join(', ')}${more ? ', …' : ''}); pass \`organization\`.`,
    );
  }
}

/** Everything a tool needs to talk to the right GlitchTip for this request. */
export interface GlitchTipConnection {
  readonly instance: ResolvedInstance;
  readonly client: GlitchTipClient;
  /**
   * The organization to act on (D-11): the one requested, else the header or
   * env default, else the only organization the token can see.
   */
  organization(requested?: string): Promise<string>;
}

const ORG_CACHE_TTL_MS = 5 * 60_000;
const ORG_CACHE_MAX_ENTRIES = 1_000;
const ORG_LOOKUP_LIMIT = 100;
const SLUG = /^[A-Za-z0-9_-]+$/;

interface HeaderSource {
  readonly headers?: Record<string, string | string[] | undefined>;
}

/**
 * Decides, per request, which GlitchTip instance, token and default
 * organization a tool acts with (D-03, D-05, D-11). It is also the SSRF
 * boundary: a URL supplied by a client is used only if it is the env URL or
 * on GLITCHTIP_ALLOWED_URLS (AGENTS.md rule 9).
 */
@Injectable()
export class InstanceResolver {
  // In-memory, bounded and short-lived (AGENTS.md rule 2). Keyed by instance
  // URL and a hash of the token, never the token itself.
  private readonly autoOrgs = new Map<string, { slug: string; expires: number }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(GLITCHTIP_FETCH) private readonly fetchImpl?: FetchLike,
  ) {}

  connect(rawRequest: unknown): GlitchTipConnection {
    const instance = this.resolve(rawRequest);
    const client = new GlitchTipClient(instance, {
      timeoutMs: this.config.glitchtip.timeoutMs,
      fetch: this.fetchImpl,
    });
    return {
      instance,
      client,
      organization: (requested) => this.organization(instance, client, requested),
    };
  }

  /** `rawRequest` is the HTTP request, or undefined on stdio. */
  resolve(rawRequest: unknown): ResolvedInstance {
    const env = this.config.glitchtip;
    if (rawRequest === undefined || rawRequest === null) {
      return new ResolvedInstance(this.requireUrl(env.url), env.token, env.defaultOrg);
    }
    const request = rawRequest as HeaderSource;
    const grant = authGrantOf(request);
    if (!grant) throw new InstanceError('The request was not authenticated.');
    const headerUrl = header(request, 'x-glitchtip-url');
    const org = this.orgHeader(request) ?? env.defaultOrg;
    if (grant.mode === 'server') {
      if (headerUrl !== undefined) {
        throw new InstanceError(
          'X-GlitchTip-Url is not accepted with the server token: this server acts only on its configured instance. Send your own GlitchTip token to choose an instance.',
        );
      }
      if (!env.token) {
        throw new InstanceError(
          'No GlitchTip token is configured on the server; send your own GlitchTip token as Bearer.',
        );
      }
      return new ResolvedInstance(this.requireUrl(env.url), env.token, org);
    }
    const url = headerUrl === undefined ? this.requireUrl(env.url) : this.allowedUrl(headerUrl);
    return new ResolvedInstance(url, grant.token, org);
  }

  private async organization(
    instance: ResolvedInstance,
    client: GlitchTipClient,
    requested?: string,
  ): Promise<string> {
    const explicit = requested ?? instance.defaultOrg;
    if (explicit !== undefined) return explicit;
    const key = `${instance.url}|${instance.tokenFingerprint()}`;
    const cached = this.autoOrgs.get(key);
    if (cached && cached.expires > Date.now()) return cached.slug;
    const slug = await this.onlyVisibleOrganization(client);
    this.remember(key, slug);
    return slug;
  }

  private async onlyVisibleOrganization(client: GlitchTipClient): Promise<string> {
    const page = await client.page(
      { name: 'list organizations', scopes: ['org:read', 'org:write', 'org:admin'] },
      (api) => api.GET('/api/0/organizations/', { params: { query: { limit: ORG_LOOKUP_LIMIT } } }),
    );
    if (page.items.length === 1 && !page.nextCursor) return page.items[0].slug;
    throw new NoDefaultOrganizationError(
      page.items.map((org) => org.slug),
      page.nextCursor !== undefined,
    );
  }

  private remember(key: string, slug: string): void {
    if (this.autoOrgs.size >= ORG_CACHE_MAX_ENTRIES) {
      const oldest = this.autoOrgs.keys().next().value;
      if (oldest !== undefined) this.autoOrgs.delete(oldest);
    }
    this.autoOrgs.set(key, { slug, expires: Date.now() + ORG_CACHE_TTL_MS });
  }

  private allowedUrl(raw: string): string {
    const url = normalizeInstanceUrl(raw);
    const env = this.config.glitchtip;
    if (url !== undefined && (url === env.url || env.allowedUrls.includes(url))) return url;
    throw new InstanceError(
      `instance URL not allowed: ${displayUrl(raw)}. This server accepts only its configured instance and the URLs in GLITCHTIP_ALLOWED_URLS.`,
    );
  }

  private requireUrl(url: string | undefined): string {
    if (url) return url;
    throw new InstanceError('No GlitchTip instance: send X-GlitchTip-Url or set GLITCHTIP_URL.');
  }

  private orgHeader(request: HeaderSource): string | undefined {
    const org = header(request, 'x-glitchtip-org');
    if (org === undefined) return undefined;
    if (!SLUG.test(org)) throw new InstanceError('X-GlitchTip-Org must be an organization slug.');
    return org;
  }
}

function header(request: HeaderSource, name: string): string | undefined {
  const value = request.headers?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

// A refused URL is named so the agent can see what it sent, but without any
// credentials, query or fragment it may carry.
function displayUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '(unparseable URL)';
  }
}
