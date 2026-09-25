import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * nestjs-pino keeps one pino-http instance per process: the first caller of
 * `ensureLoggerMiddleware` wins, and every later boot in the same test file
 * would log into the first boot's sink. A process running the real server
 * boots once, so production is unaffected; tests boot many times and must
 * start each boot from a clean root.
 *
 * The reset hooks are not exported from the package entry, so they are loaded
 * by file. Both builds are reset: the ESM one is what vitest loads for our
 * source, the CJS one is what a `require` from a CommonJS dependency gets.
 */
export async function resetNestjsPino(): Promise<void> {
  const cjsDir = dirname(createRequire(__filename).resolve('nestjs-pino'));
  for (const dir of [cjsDir, join(cjsDir, '..', 'esm')]) {
    const pinoLogger = (await import(pathToFileURL(join(dir, 'PinoLogger.js')).href)) as {
      __resetOutOfContextForTests?: () => void;
    };
    if (typeof pinoLogger.__resetOutOfContextForTests !== 'function') {
      throw new Error(`nestjs-pino changed: no __resetOutOfContextForTests in ${dir}`);
    }
    pinoLogger.__resetOutOfContextForTests();
  }
}
