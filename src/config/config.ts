import type { ToolsetName } from '../toolsets/toolset';
import { envSchema, type LogLevel, type ToolsetsMode } from './config.schema';

/** DI token under which AppModule provides the AppConfig. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  readonly transport: 'stdio' | 'http';
  readonly http: {
    readonly port: number;
    readonly path: string;
    /** D-05 shared secret; when set, a client presenting it is served with the env token. */
    readonly authToken?: string;
  };
  readonly glitchtip: {
    /** Normalised (see normalizeInstanceUrl). */
    readonly url?: string;
    readonly token?: string;
    readonly defaultOrg?: string;
    /** Normalised; the env URL is always allowed in addition to these. */
    readonly allowedUrls: readonly string[];
    readonly timeoutMs: number;
  };
  readonly toolsets: readonly ToolsetName[];
  /** How GLITCHTIP_TOOLSETS chose `toolsets`: by name, by `all`, or unset. */
  readonly toolsetsMode: ToolsetsMode;
  /** True when GLITCHTIP_TOOLSETS listed names (`toolsetsMode === 'explicit'`). */
  readonly toolsetsExplicit: boolean;
  readonly uploads: {
    /** Realpath of GLITCHTIP_UPLOAD_ROOT (D-22); the upload tools read nothing outside it. */
    readonly root?: string;
    /** GLITCHTIP_UPLOAD_MAX_BYTES: the largest file the upload tools read. */
    readonly maxBytes: number;
  };
  readonly readOnly: boolean;
  readonly responseBudget: number;
  readonly logLevel: LogLevel;
}

/** Startup refused: one line per problem, each naming the variable, never its value. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parses the environment into an AppConfig, or throws ConfigError.
 * Empty variables count as unset.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(withoutEmpty(env));
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`),
    );
  }
  const e = parsed.data;
  const config: AppConfig = {
    transport: e.MCP_TRANSPORT,
    http: { port: e.MCP_HTTP_PORT, path: e.MCP_HTTP_PATH, authToken: e.MCP_AUTH_TOKEN },
    glitchtip: {
      url: e.GLITCHTIP_URL,
      token: e.GLITCHTIP_TOKEN,
      defaultOrg: e.GLITCHTIP_DEFAULT_ORG,
      allowedUrls: e.GLITCHTIP_ALLOWED_URLS,
      timeoutMs: e.GLITCHTIP_TIMEOUT_MS,
    },
    toolsets: e.GLITCHTIP_TOOLSETS.names,
    toolsetsMode: e.GLITCHTIP_TOOLSETS.mode,
    toolsetsExplicit: e.GLITCHTIP_TOOLSETS.mode === 'explicit',
    uploads: { root: e.GLITCHTIP_UPLOAD_ROOT, maxBytes: e.GLITCHTIP_UPLOAD_MAX_BYTES },
    readOnly: e.GLITCHTIP_READ_ONLY,
    responseBudget: e.MCP_RESPONSE_BUDGET,
    logLevel: e.LOG_LEVEL,
  };
  const problems = crossFieldProblems(config);
  if (problems.length > 0) throw new ConfigError(problems);
  return uploadsUsable(config) ? config : { ...config, toolsets: withoutUploads(config) };
}

/** Legal but probably unintended combinations, logged once at startup. */
export function configWarnings(config: AppConfig): string[] {
  const warnings: string[] = [];
  const { transport, http, glitchtip } = config;
  if (transport === 'stdio' && !glitchtip.token) {
    warnings.push(
      'GLITCHTIP_TOKEN is not set: requests to GlitchTip are sent without a token and most will be refused (401).',
    );
  }
  if (transport === 'http' && http.authToken && !glitchtip.token) {
    warnings.push(
      'MCP_AUTH_TOKEN is set but GLITCHTIP_TOKEN is not: clients using MCP_AUTH_TOKEN get a tool error; clients must send their own GlitchTip token.',
    );
  }
  if (!config.toolsets.includes('uploads')) {
    if (config.toolsetsMode === 'all') {
      warnings.push(
        transport === 'http'
          ? 'GLITCHTIP_TOOLSETS=all leaves out the uploads toolset: it reads local files and is available in stdio mode only (D-06).'
          : 'GLITCHTIP_TOOLSETS=all leaves out the uploads toolset: GLITCHTIP_UPLOAD_ROOT is not set.',
      );
    } else if (config.uploads.root !== undefined) {
      warnings.push(
        'GLITCHTIP_UPLOAD_ROOT is set but the uploads toolset is not enabled, so it has no effect; add uploads to GLITCHTIP_TOOLSETS.',
      );
    }
  }
  return warnings;
}

/**
 * D-22: the uploads toolset reads local files, so it exists only in stdio
 * mode with an upload root. Asked for by name, anything else is a startup
 * failure; under `all` it is quietly left out (see configWarnings).
 */
function uploadsUsable(config: AppConfig): boolean {
  return config.transport === 'stdio' && config.uploads.root !== undefined;
}

function withoutUploads(config: AppConfig): ToolsetName[] {
  return config.toolsets.filter((name) => name !== 'uploads');
}

function uploadsProblems(config: AppConfig): string[] {
  if (!config.toolsetsExplicit || !config.toolsets.includes('uploads')) return [];
  if (config.transport === 'http') {
    return [
      'GLITCHTIP_TOOLSETS: The uploads toolset reads local files and is available in stdio mode only (D-06). Remove it from GLITCHTIP_TOOLSETS.',
    ];
  }
  if (config.uploads.root === undefined) {
    return ['GLITCHTIP_UPLOAD_ROOT: required when GLITCHTIP_TOOLSETS names uploads'];
  }
  return [];
}

function crossFieldProblems(config: AppConfig): string[] {
  const problems: string[] = uploadsProblems(config);
  if (config.transport === 'stdio' && !config.glitchtip.url) {
    problems.push('GLITCHTIP_URL: required when MCP_TRANSPORT is stdio');
  }
  if (config.transport === 'http' && config.glitchtip.token && !config.http.authToken) {
    problems.push(
      'MCP_AUTH_TOKEN: required in http mode when GLITCHTIP_TOKEN is set, otherwise anyone reaching the server would act with that token',
    );
  }
  return problems;
}

function withoutEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') result[key] = value;
  }
  return result;
}
