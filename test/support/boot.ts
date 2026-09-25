import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { INestApplication, INestMicroservice } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { McpStrategy } from '@rekog/mcp-nest';
import { AppModule } from '../../src/app.module';
import { startHttp } from '../../src/bootstrap';
import { loadConfig } from '../../src/config/config';
import { createLogger, nestLogger } from '../../src/logging/logger';
import { serverOptions } from '../../src/mcp/transports';
import { captureStream } from './capture-stream';
import { InMemoryMcpTransport } from './in-memory-transport';
import type { MockGlitchTip } from './mock-glitchtip';

export const GLITCHTIP = 'https://glitchtip.test';

export interface Booted {
  readonly client: Client;
  /** Everything the server logged (what would have gone to stderr). */
  logs(): string;
  close(): Promise<void>;
}

/**
 * Boots the app with an in-memory MCP transport, as stdio would run it.
 * `env` is the environment; GLITCHTIP_URL defaults to the mock's instance.
 */
export async function bootInMemory(
  env: NodeJS.ProcessEnv,
  /** Omitted only by the e2e suite, which talks to a real instance. */
  mock?: MockGlitchTip,
): Promise<Booted> {
  const config = loadConfig({ GLITCHTIP_URL: GLITCHTIP, LOG_LEVEL: 'debug', ...env });
  const sink = captureStream();
  const logger = createLogger({ level: config.logLevel, destination: sink.stream });
  const transport = new InMemoryMcpTransport();
  const strategy = new McpStrategy(serverOptions(config, [transport]));
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ config, logger, fetch: mock?.fetch })],
  }).compile();
  const app: INestMicroservice = moduleRef.createNestMicroservice({
    strategy,
    logger: nestLogger(logger),
  });
  await app.listen();
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(transport.clientSide);
  return {
    client,
    logs: sink.text,
    close: async () => {
      await client.close();
      await app.close();
    },
  };
}

export interface BootedHttp {
  /** Base URL of the MCP route, e.g. http://127.0.0.1:1234/mcp */
  readonly mcpUrl: URL;
  readonly baseUrl: URL;
  logs(): string;
  /** A connected client sending these extra headers on every request. */
  connect(headers: Record<string, string>): Promise<Client>;
  close(): Promise<void>;
}

/** Boots the real HTTP server on an ephemeral port. */
export async function bootHttp(env: NodeJS.ProcessEnv, mock: MockGlitchTip): Promise<BootedHttp> {
  const config = loadConfig({
    MCP_TRANSPORT: 'http',
    MCP_HTTP_PORT: '0',
    LOG_LEVEL: 'debug',
    ...env,
  });
  const sink = captureStream();
  const logger = createLogger({ level: config.logLevel, destination: sink.stream });
  const app: INestApplication = await startHttp(config, logger, { fetch: mock.fetch });
  const { port } = app.getHttpServer().address() as AddressInfo;
  const baseUrl = new URL(`http://127.0.0.1:${port}`);
  const mcpUrl = new URL(config.http.path, baseUrl);
  const clients: Client[] = [];
  return {
    mcpUrl,
    baseUrl,
    logs: sink.text,
    connect: async (headers) => {
      const client = new Client({ name: 'test', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers } }));
      clients.push(client);
      return client;
    },
    close: async () => {
      await Promise.all(clients.map((c) => c.close()));
      await app.close();
    },
  };
}

/** The concatenated text of a tool result. */
export function resultText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
}
