import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The slice of vitest's TestProject this setup uses. */
interface Provider {
  provide(key: 'compiledMain', value: string): void;
}

declare module 'vitest' {
  export interface ProvidedContext {
    compiledMain: string;
  }
}

/**
 * Compiles the app once per run so tests that spawn the server never depend on
 * `dist/` or on CI step order. The output sits under node_modules so the
 * compiled code resolves its dependencies and finds package.json above it.
 */
export default function setup(project: Provider): () => void {
  const root = resolve(__dirname, '..', '..');
  const cacheDir = join(root, 'node_modules', '.cache');
  mkdirSync(cacheDir, { recursive: true });
  const outDir = mkdtempSync(join(cacheDir, 'sgm-test-build-'));
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      'tsconfig.build.json',
      '--outDir',
      outDir,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  project.provide('compiledMain', join(outDir, 'main.js'));
  return () => rmSync(outDir, { recursive: true, force: true });
}
