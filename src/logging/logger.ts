import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LoggerService } from '@nestjs/common';
import { Logger as NestPinoLogger, type Params, PinoLogger } from 'nestjs-pino';
import pino, { type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from '../config/config.schema';

/**
 * Paths pino replaces with "[redacted]" before a line is written (D-09).
 * Request lines never carry the header map (see serializeRequest), so this is
 * the second line of defence, not the first.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'token',
  '*.token',
  '*.GLITCHTIP_TOKEN',
  '*.MCP_AUTH_TOKEN',
  'headers.authorization',
  '*.headers.authorization',
];

/** The only request headers a log line may carry; everything else is dropped. */
const LOGGED_HEADERS = [
  'content-type',
  'content-length',
  'user-agent',
  'mcp-protocol-version',
] as const;

export interface LoggerOptions {
  readonly level: LogLevel;
  /** Defaults to fd 2. Tests pass a memory stream to capture output. */
  readonly destination?: DestinationStream;
}

/**
 * The one pino instance of the process. It writes to stderr only: in stdio
 * mode stdout belongs to the protocol (AGENTS.md rule 11).
 */
export function createLogger(options: LoggerOptions): Logger {
  const destination = options.destination ?? stderrDestination();
  return pino(
    {
      level: options.level,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      base: { name: 'smart-glitchtip-mcp' },
    },
    destination,
  );
}

/** Params for nestjs-pino's LoggerModule (HTTP request logging) and Nest's logger. */
export function pinoParams(logger: Logger): Params {
  return {
    pinoHttp: {
      logger,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
      quietReqLogger: true,
      // Allowlists, not the default serializers: the default logs every
      // request header, including Authorization and X-GlitchTip-Url, which
      // may carry credentials (AGENTS.md rule 1).
      serializers: { req: serializeRequest, res: serializeResponse },
    },
  };
}

/** Nest's application logger backed by our pino instance, usable before DI exists. */
export function nestLogger(logger: Logger): LoggerService {
  const params = pinoParams(logger);
  return new NestPinoLogger(new PinoLogger(params), params);
}

interface SerializedRequest {
  readonly id?: unknown;
  readonly method?: string;
  readonly url?: string;
  readonly headers?: Record<string, string | string[] | undefined>;
  readonly raw?: IncomingMessage;
}

/** Method, path (no query string) and allowlisted headers; never credentials. */
export function serializeRequest(req: SerializedRequest): object {
  const headers = req.headers ?? req.raw?.headers ?? {};
  const logged: Record<string, string> = {};
  for (const name of LOGGED_HEADERS) {
    const value = headers[name];
    if (typeof value === 'string') logged[name] = value;
  }
  const instance = instanceOrigin(headers['x-glitchtip-url']);
  if (instance) logged['x-glitchtip-url'] = instance;
  return {
    id: req.id,
    method: req.method,
    path: (req.url ?? '').split('?')[0],
    headers: logged,
  };
}

function serializeResponse(res: { statusCode?: number; raw?: ServerResponse }): object {
  return { statusCode: res.statusCode ?? res.raw?.statusCode };
}

// Only the origin of a client-chosen instance: no userinfo, path or query.
function instanceOrigin(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return '[unparseable]';
  }
}

function stderrDestination(): DestinationStream {
  if (process.env.NODE_ENV !== 'production') {
    const pretty = loadPrettyStream();
    if (pretty) return pretty;
  }
  return pino.destination({ fd: 2, sync: true });
}

// pino-pretty is a dev dependency: an installed package runs without it and
// falls back to JSON lines.
function loadPrettyStream(): DestinationStream | undefined {
  try {
    const pretty = require('pino-pretty') as (opts: object) => DestinationStream;
    return pretty({ destination: 2, sync: true, colorize: false });
  } catch {
    return undefined;
  }
}
