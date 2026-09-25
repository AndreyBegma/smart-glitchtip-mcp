import { randomUUID } from 'node:crypto';
import { type ArgumentsHost, Catch, Inject, Logger, type RpcExceptionFilter } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { type Observable, throwError } from 'rxjs';
import { AgentFacingError } from '../agent-facing.error';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { isShapeError, MalformedViewError } from '../format/tool-output';
import { authGrantOf } from '../glitchtip/auth-grant';
import { redactSecrets } from '../logging/redact';

const THIS_CALL = 'this call';

/**
 * Per-controller filter for tools (never global: a global catch-all hangs the
 * HTTP 401, notes §6). Same shape as mcp-nest's McpExceptionFilter, so
 * mcp-nest turns the thrown `{ status, message }` into `isError: true`.
 *
 * Agent-facing errors keep their message. A `TypeError`/`RangeError` — a
 * view or handler reading a GlitchTip response that did not have the shape
 * it expected — becomes the `malformed` message (AGENTS.md rule 7). Anything
 * else is a defect of this server: the agent gets an error id. Either way the
 * stack goes to the log (stderr) under that id, with every secret this
 * request could know stripped from it.
 */
@Catch()
export class ToolErrorFilter implements RpcExceptionFilter {
  private readonly logger = new Logger('ToolErrorFilter');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  catch(exception: unknown, host: ArgumentsHost): Observable<never> {
    if (exception instanceof AgentFacingError) return reject(exception.message);
    if (exception instanceof RpcException) return throwError(() => exception.getError());
    const id = this.log(exception, host);
    if (exception instanceof MalformedViewError || isShapeError(exception)) {
      return reject(malformedMessage(toolName(host) ?? viewOperation(exception), id));
    }
    return reject(`Internal error in smart-glitchtip-mcp (${id}).`);
  }

  private log(exception: unknown, host: ArgumentsHost): string {
    const id = randomUUID();
    const secrets = [
      this.config.glitchtip.token,
      this.config.http.authToken,
      passThroughToken(host),
    ];
    this.logger.error({ errorId: id }, redactSecrets(describe(exception), secrets));
    return id;
  }
}

function malformedMessage(tool: string, id: string): string {
  return `GlitchTip returned a response this server did not expect for ${tool} (${id}). The request itself succeeded; try format "json", or \`api_get\` (the \`api_request\` toolset, off by default) to see the raw payload.`;
}

function reject(message: string): Observable<never> {
  return throwError(() => ({ status: 'error', message }));
}

function describe(exception: unknown): string {
  if (!(exception instanceof Error)) return String(exception);
  const own = exception.stack ?? `${exception.name}: ${exception.message}`;
  return exception.cause === undefined ? own : `${own}\nCaused by: ${describe(exception.cause)}`;
}

function viewOperation(exception: unknown): string {
  return exception instanceof MalformedViewError ? exception.operation : THIS_CALL;
}

/**
 * The tool being called. mcp-nest's RPC data is the arguments only; the
 * `tools/call` request, with the name, is on the McpContext.
 */
function toolName(host: ArgumentsHost): string | undefined {
  const context = rpcContext(host) as { mcpRequest?: { params?: { name?: unknown } } } | undefined;
  const name = context?.mcpRequest?.params?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/** The GlitchTip token an HTTP client passed through, if this call has one. */
function passThroughToken(host: ArgumentsHost): string | undefined {
  const context = rpcContext(host);
  const getRawRequest = (context as { getRawRequest?: () => unknown } | undefined)?.getRawRequest;
  const raw = typeof getRawRequest === 'function' ? getRawRequest.call(context) : undefined;
  if (typeof raw !== 'object' || raw === null) return undefined;
  const grant = authGrantOf(raw);
  return grant?.mode === 'passthrough' ? grant.token : undefined;
}

function rpcContext(host: ArgumentsHost): unknown {
  return host.switchToRpc?.().getContext();
}
