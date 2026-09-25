#!/usr/bin/env node
import 'reflect-metadata';
import { startHttp, startStdio } from './bootstrap';
import { ConfigError, configWarnings, loadConfig } from './config/config';
import { createLogger } from './logging/logger';

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // One line per problem, on stderr; stdout stays clean in stdio mode.
    for (const problem of error.problems) process.stderr.write(`smart-glitchtip-mcp: ${problem}\n`);
    process.exit(1);
  }
  const logger = createLogger({ level: config.logLevel });
  for (const warning of configWarnings(config)) logger.warn(warning);
  if (config.transport === 'stdio') await startStdio(config, logger);
  else await startHttp(config, logger);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `smart-glitchtip-mcp failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
