import { renameSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UploadError } from '../../../src/toolsets/uploads/upload.error';
import { confirmOpened, resolveUploadPath } from '../../../src/toolsets/uploads/upload-path';
import { type UploadTree, uploadTree } from '../../fixtures/uploads/upload-tree';

// Spec "Local file rules" and acceptance 4, at the function every path input
// goes through. The protocol suite repeats the refusals through a tool and
// asserts that no HTTP request was made.

let tree: UploadTree;
beforeAll(() => {
  tree = uploadTree();
});
afterAll(() => tree.remove());

const limits = () => ({ root: tree.root, maxBytes: 1024, capName: 'GLITCHTIP_UPLOAD_MAX_BYTES' });

async function refusal(given: string, maxBytes = 1024): Promise<string> {
  try {
    const file = await resolveUploadPath(given, { ...limits(), maxBytes });
    await file.close();
  } catch (error) {
    expect(error).toBeInstanceOf(UploadError);
    return (error as Error).message;
  }
  throw new Error(`expected ${given} to be refused`);
}

async function contents(given: string): Promise<string> {
  const file = await resolveUploadPath(given, limits());
  try {
    const buffer = Buffer.alloc(file.size);
    await file.read(buffer, 0);
    return buffer.toString();
  } finally {
    await file.close();
  }
}

describe('refused', () => {
  it.each([
    ['../outside/secret.txt', 'resolves outside the upload root'],
    ['out-link', 'resolves outside the upload root'],
    ['.git/config', 'hidden (dot) file or directory'],
    ['build/cfg', 'into a hidden (dot) path'],
    ['sub', 'is a directory; pass a file'],
    ['App.dSYM', '.dSYM directory; pass the DWARF file inside it'],
    ['fifo', 'is not a regular file'],
    ['empty.sym', 'is empty'],
    ['hard.sym', 'has more than one hard link'],
    ['app.sym/', 'must name a file, not end with /'],
    ['missing.sym', '"missing.sym" was not found'],
    ['a\0b', 'must not contain a NUL byte'],
    ['', 'must not be empty'],
    ['x'.repeat(4097), 'at most 4096 characters'],
  ])('%s', async (given, reason) => {
    expect(await refusal(given)).toContain(reason);
  });

  it('an absolute path outside the root', async () => {
    expect(await refusal(join(tree.outside, 'secret.txt'))).toContain(
      'resolves outside the upload root',
    );
  });

  it('answers the same for existing and missing paths outside the root or behind a dot', async () => {
    // Each pair differs only in whether the thing exists; the answers must
    // differ only in the path they repeat back.
    const pairs = [
      [join(tree.outside, 'secret.txt'), join(tree.outside, 'nothing.txt')],
      ['/etc/passwd', '/etc/no-such-file'],
      ['../outside/secret.txt', '../outside/nothing.txt'],
      ['out-link', 'dangling'],
      ['.git/config', '.git/nothing'],
    ];
    for (const [existing, missing] of pairs) {
      const a = (await refusal(existing)).replace(JSON.stringify(existing), '<path>');
      const b = (await refusal(missing)).replace(JSON.stringify(missing), '<path>');
      expect(a, `${existing} vs ${missing}`).toBe(b);
    }
  });

  it('a file over the cap, naming the cap', async () => {
    expect(await refusal('app.sym', 4)).toMatch(
      /over the 4-byte limit \(GLITCHTIP_UPLOAD_MAX_BYTES\)/,
    );
  });

  it('never names the resolved target of an outside symlink, nor the absolute root', async () => {
    for (const given of ['out-link', '../outside/secret.txt', 'build/cfg']) {
      const message = await refusal(given);
      expect(message).not.toContain(tree.outside);
      expect(message).not.toContain(tree.root);
      expect(message).not.toContain(tree.base);
      expect(message).toContain(JSON.stringify(given));
    }
    for (const given of ['out-link', 'build/cfg']) {
      const message = await refusal(given);
      expect(message).not.toContain('secret.txt');
      expect(message).not.toContain('.git');
    }
  });
});

describe('confirmOpened', () => {
  async function openedAt(relativePath: string) {
    const target = join(tree.root, relativePath);
    const handle = await open(target, 'r');
    const stats = await handle.stat();
    return { handle, target, real: target, root: tree.root, stats, shown: '"f"' };
  }

  it.each(['proc', 'realpath'] as const)(
    '%s: accepts a descriptor still at the checked path, refuses one that is not',
    async (check) => {
      tree.write('swap-a.sym', 'a');
      tree.write('swap-b.sym', 'b');
      const opened = await openedAt('swap-a.sym');
      try {
        await expect(confirmOpened(check, opened)).resolves.toBeUndefined();
        // Another file now sits at the checked path; the descriptor still
        // refers to the first one.
        renameSync(join(tree.root, 'swap-b.sym'), opened.target);
        await expect(confirmOpened(check, opened)).rejects.toThrow(
          '"f" changed while it was being opened; try again.',
        );
      } finally {
        await opened.handle.close();
      }
    },
  );
});

describe('accepted', () => {
  it('a plain file, by relative and by absolute path', async () => {
    expect(await contents('app.sym')).toContain('MODULE');
    expect(await contents(join(tree.root, 'app.sym'))).toContain('MODULE');
  });

  it('a symlink inside the root pointing inside it', async () => {
    const file = await resolveUploadPath('in-link', limits());
    expect(file.name).toBe('app.sym');
    await file.close();
  });

  it('sub/../app.sym, judged by its realpath', async () => {
    expect(await contents('sub/../app.sym')).toContain('MODULE');
  });

  it('a symlink chain that leaves the root and re-enters it, judged by where it lands', async () => {
    // Rule 2: symlinks are followed and judged by the final target. This chain
    // ends on root/app.sym, so nothing outside the root is read.
    expect(await contents('chain')).toContain('MODULE');
  });
});
