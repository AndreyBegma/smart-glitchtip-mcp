import type { LoggerService } from '@nestjs/common';
import { Logger as NestPinoLogger, type Params, PinoLogger } from 'nestjs-pino';
import pino, { type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from '../config/config.schema';

/**
 * Paths pino replaces with "[redacted]" before a line is written (D-09).
 * The client never logs request headers, so this is the second line of
 * defence, not the first.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-glitchtip-token"]',
  'token',
  '*.token',
  '*.GLITCHTIP_TOKEN',
  '*.MCP_AUTH_TOKEN',
  'headers.authorization',
  '*.headers.authorization',
];

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
    },
  };
}

/** Nest's application logger backed by our pino instance, usable before DI exists. */
export function nestLogger(logger: Logger): LoggerService {
  const params = pinoParams(logger);
  return new NestPinoLogger(new PinoLogger(params), params);
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
