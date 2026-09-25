import { randomUUID } from 'node:crypto';
import { type ArgumentsHost, Catch, Logger, type RpcExceptionFilter } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { type Observable, throwError } from 'rxjs';
import { AgentFacingError } from '../agent-facing.error';

/**
 * Per-controller filter for tools (never global: a global catch-all hangs the
 * HTTP 401, notes §6). Same shape as mcp-nest's McpExceptionFilter, so
 * mcp-nest turns the thrown `{ status, message }` into `isError: true`.
 *
 * Agent-facing errors keep their message. Anything else is a defect of this
 * server: the agent gets an error id, the stack goes to the log (stderr).
 */
@Catch()
export class ToolErrorFilter implements RpcExceptionFilter {
  private readonly logger = new Logger('ToolErrorFilter');

  catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    if (exception instanceof AgentFacingError) return reject(exception.message);
    if (exception instanceof RpcException) return throwError(() => exception.getError());
    const id = randomUUID();
    this.logger.error({ errorId: id }, redactBearer(describe(exception)));
    return reject(`Internal error in smart-glitchtip-mcp (${id}).`);
  }
}

function describe(exception: unknown): string {
  if (!(exception instanceof Error)) return String(exception);
  return exception.stack ?? `${exception.name}: ${exception.message}`;
}

// An unexpected error can quote a header it choked on; strip bearer values
// before the text reaches the log (AGENTS.md rule 1).
function redactBearer(text: string): string {
  return text.replace(/(bearer\s+)\S+/gi, '$1[redacted]');
}

function reject(message: string): Observable<never> {
  return throwError(() => ({ status: 'error', message }));
}
