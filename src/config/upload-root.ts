import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, parse } from 'node:path';

/**
 * The canonical form of GLITCHTIP_UPLOAD_ROOT (D-22): its realpath, so the
 * upload tools compare resolved paths against a resolved root. Returns the
 * reason it is refused instead, phrased for a `KEY: reason` line — never
 * the path itself.
 */
export function resolveUploadRoot(raw: string): { root: string } | { problem: string } {
  if (!isAbsolute(raw)) return { problem: 'must be an absolute path' };
  let root: string;
  let isDirectory: boolean;
  try {
    root = realpathSync(raw);
    isDirectory = statSync(root).isDirectory();
  } catch {
    return { problem: 'must be an existing directory' };
  }
  if (!isDirectory) return { problem: 'must be a directory, not a file' };
  if (parse(root).root === root) return { problem: 'must not be the filesystem root' };
  return { root };
}
