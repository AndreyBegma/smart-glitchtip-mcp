import type { INestApplication, INestMicroservice } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Logger } from 'pino';
import { AppModule } from './app.module';
import type { AppConfig } from './config/config';
import type { FetchLike } from './glitchtip/glitchtip.client';
import { nestLogger } from './logging/logger';
import { buildMcpServer } from './mcp/transports';

export interface StartOptions {
  /** Tests only: the fetch the GlitchTip client uses. */
  readonly fetch?: FetchLike;
}

/** stdio: a Nest microservice with no HTTP server; nothing but frames on stdout. */
export async function startStdio(
  config: AppConfig,
  logger: Logger,
  options: StartOptions = {},
): Promise<INestMicroservice> {
  const { strategy } = buildMcpServer(config);
  const app = await NestFactory.createMicroservice(
    AppModule.forRoot({ config, logger, fetch: options.fetch }),
    { strategy, logger: nestLogger(logger) },
  );
  app.enableShutdownHooks();
  await app.listen();
  logger.info({ toolsets: config.toolsets, readOnly: config.readOnly }, 'MCP server on stdio');
  return app;
}

/**
 * http: stateless Streamable HTTP on MCP_HTTP_PATH behind HttpAuthGuard.
 * The order setHttpAdapter → connectMicroservice → startAllMicroservices →
 * listen is required by mcp-nest (notes §2).
 */
export async function startHttp(
  config: AppConfig,
  logger: Logger,
  options: StartOptions = {},
): Promise<INestApplication> {
  const { strategy, httpTransport } = buildMcpServer(config);
  const app = await NestFactory.create(
    AppModule.forRoot({ config, logger, httpTransport, fetch: options.fetch }),
    { logger: nestLogger(logger) },
  );
  app.enableShutdownHooks();
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(config.http.port);
  logger.info(
    {
      url: await app.getUrl(),
      path: config.http.path,
      toolsets: config.toolsets,
      readOnly: config.readOnly,
    },
    'MCP server on http',
  );
  return app;
}
