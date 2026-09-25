import { execFileSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A temporary directory holding an upload root and a sibling outside it,
 * laid out for the path rules (D-22):
 *
 *   outside/secret.txt            a file the tools must never read
 *   outside/back -> root/app.sym  the second hop of a chain that re-enters
 *   root/app.sym                  a readable file
 *   root/empty.sym                an empty file
 *   root/sub/                     a directory
 *   root/App.dSYM/                a .dSYM bundle directory
 *   root/.git/config              a dot-directory below the root
 *   root/build/cfg -> ../.git/config
 *   root/out-link -> ../outside/secret.txt
 *   root/chain -> ../outside/back
 *   root/in-link -> app.sym
 *   root/dangling -> ../outside/missing.txt
 *   root/hard.sym                 a hard link to outside/secret.txt
 *   root/fifo                     a FIFO
 */
export interface UploadTree {
  readonly base: string;
  /** Realpath of the root, as configuration stores it. */
  readonly root: string;
  readonly outside: string;
  write(relative: string, content: string | Buffer): string;
  remove(): void;
}

export function uploadTree(): UploadTree {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sgm-uploads-')));
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  for (const dir of [root, outside, join(root, 'sub'), join(root, 'App.dSYM')]) mkdirSync(dir);
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'build'));
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  writeFileSync(join(root, 'app.sym'), 'MODULE Linux x86_64 0123 app\n');
  writeFileSync(join(root, 'empty.sym'), '');
  writeFileSync(join(root, '.git', 'config'), '[core]\n');
  symlinkSync('../.git/config', join(root, 'build', 'cfg'));
  symlinkSync('../outside/secret.txt', join(root, 'out-link'));
  symlinkSync(join(root, 'app.sym'), join(outside, 'back'));
  symlinkSync('../outside/back', join(root, 'chain'));
  symlinkSync('app.sym', join(root, 'in-link'));
  symlinkSync('../outside/missing.txt', join(root, 'dangling'));
  linkSync(join(outside, 'secret.txt'), join(root, 'hard.sym'));
  execFileSync('mkfifo', [join(root, 'fifo')]);
  return {
    base,
    root,
    outside,
    write: (relative, content) => {
      const path = join(root, relative);
      writeFileSync(path, content);
      return path;
    },
    remove: () => rmSync(base, { recursive: true, force: true }),
  };
}
