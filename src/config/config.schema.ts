import { z } from 'zod';
import { DEFAULT_TOOLSETS, TOOLSET_NAMES, type ToolsetName } from '../toolsets/toolset';
import { normalizeInstanceUrl } from './instance-url';
import { resolveUploadRoot } from './upload-root';

// Messages here never include the received value: a mistyped token must not
// be echoed to stderr by a validation error (AGENTS.md rule 1).

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const optionalString = z.string().optional();

const instanceUrl = z.string().transform((raw, ctx) => {
  const url = normalizeInstanceUrl(raw);
  if (!url) {
    ctx.addIssue({
      code: 'custom',
      message: 'must be an http(s) URL without credentials or query',
    });
    return z.NEVER;
  }
  return url;
});

const integer = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

const boolean = z
  .string()
  .transform((raw) => raw.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const commaList = (raw: string): string[] =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const allowedUrls = z.string().transform((raw, ctx) => {
  const urls: string[] = [];
  for (const entry of commaList(raw)) {
    const url = normalizeInstanceUrl(entry);
    if (url) urls.push(url);
    else ctx.addIssue({ code: 'custom', message: 'every entry must be an http(s) URL' });
  }
  return urls;
});

/**
 * How GLITCHTIP_TOOLSETS chose the toolsets: by name, by `all`, or by being
 * unset. Rules that apply to a toolset asked for by name (D-22) need it,
 * because `all` is expanded here and looks like a list afterwards. A list
 * that names `uploads` beside `all` counts as explicit.
 */
export type ToolsetsMode = 'explicit' | 'all' | 'default';

export interface ToolsetSelection {
  readonly names: ToolsetName[];
  readonly mode: ToolsetsMode;
}

const toolsets = z.string().transform((raw, ctx): ToolsetSelection => {
  const names = commaList(raw);
  // `all,uploads` still names uploads, and gets the explicit-name rules (D-22).
  if (names.includes('all')) {
    return { names: [...TOOLSET_NAMES], mode: names.includes('uploads') ? 'explicit' : 'all' };
  }
  const unknown = names.filter((name) => !(TOOLSET_NAMES as readonly string[]).includes(name));
  if (unknown.length > 0) {
    ctx.addIssue({
      code: 'custom',
      message: `unknown toolset ${unknown.join(', ')}; valid toolsets: ${TOOLSET_NAMES.join(', ')}, all`,
    });
    return z.NEVER;
  }
  return { names: [...new Set(names)] as ToolsetName[], mode: 'explicit' };
});

const uploadRoot = z.string().transform((raw, ctx) => {
  const resolved = resolveUploadRoot(raw);
  if ('problem' in resolved) {
    ctx.addIssue({ code: 'custom', message: resolved.problem });
    return z.NEVER;
  }
  return resolved.root;
});

/** GLITCHTIP_UPLOAD_MAX_BYTES: default 256 MiB, at most GlitchTip's 2 GiB file limit. */
export const DEFAULT_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;
const MAX_UPLOAD_MAX_BYTES = 2 ** 31;

/** The environment variables the server reads, keyed by their exact names. */
export const envSchema = z.object({
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HTTP_PORT: integer(0, 65535).default(8080),
  MCP_HTTP_PATH: z
    .string()
    .regex(/^\/[A-Za-z0-9/_-]*$/, 'must be a path starting with /')
    .default('/mcp'),
  MCP_AUTH_TOKEN: z
    .string()
    .min(16, 'must be at least 16 characters')
    .regex(/^\S+$/, 'must not contain whitespace')
    .optional(),
  GLITCHTIP_URL: instanceUrl.optional(),
  GLITCHTIP_TOKEN: optionalString,
  GLITCHTIP_DEFAULT_ORG: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'must be an organization slug')
    .optional(),
  GLITCHTIP_ALLOWED_URLS: allowedUrls.default([]),
  GLITCHTIP_TOOLSETS: toolsets.default({ names: [...DEFAULT_TOOLSETS], mode: 'default' }),
  GLITCHTIP_UPLOAD_ROOT: uploadRoot.optional(),
  GLITCHTIP_UPLOAD_MAX_BYTES: integer(1, MAX_UPLOAD_MAX_BYTES).default(DEFAULT_UPLOAD_MAX_BYTES),
  GLITCHTIP_READ_ONLY: boolean.default(true),
  GLITCHTIP_API_REQUEST_ALLOW_WRITE: boolean.default(false),
  GLITCHTIP_TIMEOUT_MS: integer(100, 600_000).default(15_000),
  MCP_RESPONSE_BUDGET: integer(1_000, 10_000_000).default(20_000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type Env = z.infer<typeof envSchema>;
export type LogLevel = (typeof LOG_LEVELS)[number];
