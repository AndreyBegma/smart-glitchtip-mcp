import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { type AuthGrant, recordAuthGrant } from '../glitchtip/auth-grant';

interface HttpRequestLike {
  readonly headers: Record<string, string | string[] | undefined>;
}
interface HttpResponseLike {
  setHeader(name: string, value: string): unknown;
}

/**
 * HTTP-layer guard on the MCP route (D-05). It runs before any JSON-RPC is
 * read, so an unauthenticated client gets 401 before `tools/list`
 * (mcp-nest notes §7). A bearer equal to MCP_AUTH_TOKEN is a server grant;
 * any other bearer is a GlitchTip token to pass through.
 */
@Injectable()
export class HttpAuthGuard implements CanActivate {
  private readonly serverTokenDigest?: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const secret = config.http.authToken;
    this.serverTokenDigest = secret === undefined ? undefined : digest(secret);
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const bearer = bearerOf(request.headers.authorization);
    if (bearer === undefined) {
      http.getResponse<HttpResponseLike>().setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException(
        'Send Authorization: Bearer <MCP_AUTH_TOKEN> or your own GlitchTip API token.',
      );
    }
    recordAuthGrant(request, this.grantFor(bearer));
    return true;
  }

  private grantFor(bearer: string): AuthGrant {
    if (this.serverTokenDigest && timingSafeEqual(digest(bearer), this.serverTokenDigest)) {
      return { mode: 'server' };
    }
    return { mode: 'passthrough', token: bearer };
  }
}

function bearerOf(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1];
}

// Comparing fixed-length digests keeps the comparison constant-time whatever
// the length of the presented token.
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
