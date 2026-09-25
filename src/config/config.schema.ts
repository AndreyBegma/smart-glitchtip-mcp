import { z } from 'zod';
import { DEFAULT_TOOLSETS, TOOLSET_NAMES, type ToolsetName } from '../toolsets/toolset';
import { normalizeInstanceUrl } from './instance-url';

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

const toolsets = z.string().transform((raw, ctx): ToolsetName[] => {
  const names = commaList(raw);
  if (names.includes('all')) return [...TOOLSET_NAMES];
  const unknown = names.filter((name) => !(TOOLSET_NAMES as readonly string[]).includes(name));
  if (unknown.length > 0) {
    ctx.addIssue({
      code: 'custom',
      message: `unknown toolset ${unknown.join(', ')}; valid toolsets: ${TOOLSET_NAMES.join(', ')}, all`,
    });
    return z.NEVER;
  }
  return [...new Set(names)] as ToolsetName[];
});

/** The environment variables the server reads, keyed by their exact names. */
export const envSchema = z.object({
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HTTP_PORT: integer(0, 65535).default(8080),
  MCP_HTTP_PATH: z
    .string()
    .regex(/^\/[A-Za-z0-9/_-]*$/, 'must be a path starting with /')
    .default('/mcp'),
  MCP_AUTH_TOKEN: optionalString,
  GLITCHTIP_URL: instanceUrl.optional(),
  GLITCHTIP_TOKEN: optionalString,
  GLITCHTIP_DEFAULT_ORG: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'must be an organization slug')
    .optional(),
  GLITCHTIP_ALLOWED_URLS: allowedUrls.default([]),
  GLITCHTIP_TOOLSETS: toolsets.default([...DEFAULT_TOOLSETS]),
  GLITCHTIP_READ_ONLY: boolean.default(true),
  GLITCHTIP_TIMEOUT_MS: integer(100, 600_000).default(15_000),
  MCP_RESPONSE_BUDGET: integer(1_000, 10_000_000).default(20_000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type Env = z.infer<typeof envSchema>;
export type LogLevel = (typeof LOG_LEVELS)[number];
