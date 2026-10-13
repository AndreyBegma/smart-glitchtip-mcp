import { type DynamicModule, Module, type Provider, type Type } from '@nestjs/common';
import type { StreamableHttpTransport } from '@rekog/mcp-nest';
import { LoggerModule } from 'nestjs-pino';
import type { Logger } from 'pino';
import { APP_CONFIG, type AppConfig } from './config/config';
import { ToolOutput } from './format/tool-output';
import type { FetchLike } from './glitchtip/glitchtip.client';
import { GLITCHTIP_FETCH, InstanceResolver } from './glitchtip/instance.resolver';
import { pinoParams } from './logging/logger';
import { CoreTools } from './mcp/core.tools';
import { HttpAuthGuard } from './mcp/http-auth.guard';
import { HealthController, mcpHttpController } from './mcp/mcp-http.controller';
import { selectToolsets } from './mcp/toolset.registry';
import { selectPrompts } from './prompts/prompts.registry';
import type { ToolsetDefinition } from './toolsets/toolset';

export interface AppModuleOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  /** http mode only: mounts the MCP route behind HttpAuthGuard, and /healthz. */
  readonly httpTransport?: StreamableHttpTransport;
  /** Tests only: the fetch the GlitchTip client uses. */
  readonly fetch?: FetchLike;
  /** Tests only: the toolset registry to select from instead of TOOLSETS. */
  readonly toolsets?: readonly ToolsetDefinition[];
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: a Nest dynamic module is a class by contract.
export class AppModule {
  /**
   * Wires only the tool controllers of enabled toolsets, and their mutating
   * controllers only when not read-only (D-06, D-07). A tool left out here
   * does not exist for the client.
   */
  static forRoot(options: AppModuleOptions): DynamicModule {
    const { config, logger, httpTransport, fetch } = options;
    const selection = selectToolsets(config, options.toolsets);
    for (const name of selection.unavailable) {
      logger.warn({ toolset: name }, `Toolset "${name}" is enabled but not yet available.`);
    }
    const controllers: Type[] = [
      CoreTools,
      ...selection.controllers,
      ...selectPrompts(config, options.toolsets),
    ];
    const providers: Provider[] = [
      { provide: APP_CONFIG, useValue: config },
      InstanceResolver,
      ToolOutput,
      HttpAuthGuard,
    ];
    if (fetch) providers.push({ provide: GLITCHTIP_FETCH, useValue: fetch });
    const imports: DynamicModule[] = [];
    if (httpTransport) {
      controllers.push(mcpHttpController(config.http.path, httpTransport), HealthController);
      imports.push(LoggerModule.forRoot(pinoParams(logger)));
    }
    return { module: AppModule, imports, controllers, providers };
  }
}
