import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PACKAGE_NAME = 'smart-glitchtip-mcp';

/**
 * The package version, read from the nearest package.json above this file,
 * so the same code reports it from dist/, from an npm install and from the
 * test build. Falls back to 0.0.0 rather than failing startup.
 */
export const VERSION: string = findVersion(__dirname);

function findVersion(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const version = versionOf(candidate);
      if (version) return version;
    }
    if (dirname(dir) === dir) return '0.0.0';
  }
}

function versionOf(file: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
    return pkg.name === PACKAGE_NAME ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}
