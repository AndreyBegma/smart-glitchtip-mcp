import {
  type McpServerOptions,
  McpStrategy,
  type McpTransport,
  StdioTransport,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import type { AppConfig } from '../config/config';
import { VERSION } from '../version';

export interface McpServer {
  readonly strategy: McpStrategy;
  /** Present in http mode; its handlers are mounted by mcpHttpController. */
  readonly httpTransport?: StreamableHttpTransport;
}

/** The MCP strategy and transport for the configured mode (D-04). */
export function buildMcpServer(config: AppConfig): McpServer {
  if (config.transport === 'stdio') {
    return { strategy: new McpStrategy(serverOptions(config, [new StdioTransport()])) };
  }
  // Stateless: every request carries its own credentials, no Mcp-Session-Id.
  const httpTransport = new StreamableHttpTransport({ statefulMode: false });
  return { strategy: new McpStrategy(serverOptions(config, [httpTransport])), httpTransport };
}

export function serverOptions(config: AppConfig, transports: McpTransport[]): McpServerOptions {
  return {
    name: 'smart-glitchtip-mcp',
    version: VERSION,
    instructions: instructions(config),
    transports,
    // The strategy's own Nest logger writes to stdout; our logs go through pino (D-09).
    logging: false,
  };
}

function instructions(config: AppConfig): string {
  const mode = config.readOnly
    ? 'It is read-only: tools that change GlitchTip are not offered.'
    : 'Tools that change or delete GlitchTip data are enabled; their annotations say which.';
  return (
    'smart-glitchtip-mcp gives access to a GlitchTip error-tracking instance (issues, events, ' +
    `projects, organizations and more). ${mode} When a tool fails with a permission or ` +
    'authentication error, call whoami to see the instance, user and token scopes in use.'
  );
}
