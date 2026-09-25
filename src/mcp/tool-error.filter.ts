import { randomUUID } from 'node:crypto';
import { type ArgumentsHost, Catch, Inject, Logger, type RpcExceptionFilter } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { type Observable, throwError } from 'rxjs';
import { AgentFacingError } from '../agent-facing.error';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { authGrantOf } from '../glitchtip/auth-grant';
import { redactSecrets } from '../logging/redact';

/**
 * Per-controller filter for tools (never global: a global catch-all hangs the
 * HTTP 401, notes §6). Same shape as mcp-nest's McpExceptionFilter, so
 * mcp-nest turns the thrown `{ status, message }` into `isError: true`.
 *
 * Agent-facing errors keep their message. Anything else is a defect of this
 * server: the agent gets an error id, and the stack goes to the log (stderr)
 * with every secret this request could know stripped from it.
 */
@Catch()
export class ToolErrorFilter implements RpcExceptionFilter {
  private readonly logger = new Logger('ToolErrorFilter');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  catch(exception: unknown, host: ArgumentsHost): Observable<never> {
    if (exception instanceof AgentFacingError) return reject(exception.message);
    if (exception instanceof RpcException) return throwError(() => exception.getError());
    const id = randomUUID();
    const secrets = [
      this.config.glitchtip.token,
      this.config.http.authToken,
      passThroughToken(host),
    ];
    this.logger.error({ errorId: id }, redactSecrets(describe(exception), secrets));
    return reject(`Internal error in smart-glitchtip-mcp (${id}).`);
  }
}

function reject(message: string): Observable<never> {
  return throwError(() => ({ status: 'error', message }));
}

function describe(exception: unknown): string {
  if (!(exception instanceof Error)) return String(exception);
  return exception.stack ?? `${exception.name}: ${exception.message}`;
}

/** The GlitchTip token an HTTP client passed through, if this call has one. */
function passThroughToken(host: ArgumentsHost): string | undefined {
  const context: unknown = host.switchToRpc?.().getContext();
  const getRawRequest = (context as { getRawRequest?: () => unknown } | undefined)?.getRawRequest;
  const raw = typeof getRawRequest === 'function' ? getRawRequest.call(context) : undefined;
  if (typeof raw !== 'object' || raw === null) return undefined;
  const grant = authGrantOf(raw);
  return grant?.mode === 'passthrough' ? grant.token : undefined;
}
