import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { resolveUploadPath } from '../../../src/toolsets/uploads/upload-path';

// The swap-after-check race (security review of #18): a directory on the
// resolved path is swapped for a symlink to outside the root between the
// realpath and the open. O_NOFOLLOW guards only the last component, and
// stat and fstat then agree on the outside file — so the check that holds is
// on the path the open descriptor actually refers to.

const INSIDE = 'INSIDE';
const OUTSIDE = 'OUTSIDE-SECRET';
const ATTEMPTS = 3000;
const DEADLINE_MS = 8000;

let base: string;
let root: string;
let swapper: ChildProcess | undefined;

// Runs in a separate process so the swaps interleave with the resolver's
// asynchronous filesystem calls: `root/a` flips between a directory holding
// x = INSIDE and a symlink to a directory holding x = OUTSIDE-SECRET.
const SWAPPER = `
const { renameSync } = require('node:fs');
const [a, spareDir, spareLink] = process.argv.slice(1);
for (;;) {
  try { renameSync(spareDir, a); renameSync(a, spareDir); } catch {}
  try { renameSync(spareLink, a); renameSync(a, spareLink); } catch {}
}`;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'sgm-race-')));
  root = join(base, 'root');
  const outside = join(base, 'outside');
  const spareDir = join(base, 'spare-dir');
  mkdirSync(root);
  mkdirSync(outside);
  mkdirSync(spareDir);
  writeFileSync(join(outside, 'x'), OUTSIDE);
  writeFileSync(join(spareDir, 'x'), INSIDE);
  symlinkSync(outside, join(base, 'spare-link'));
  const args = ['-e', SWAPPER, join(root, 'a'), spareDir, join(base, 'spare-link')];
  swapper = spawn(process.execPath, args, { stdio: 'ignore' });
});

afterAll(() => {
  swapper?.kill('SIGKILL');
  rmSync(base, { recursive: true, force: true });
});

it('never reads outside the root while a directory on the path is being swapped for a symlink', async () => {
  const limits = { root, maxBytes: 1024, capName: 'GLITCHTIP_UPLOAD_MAX_BYTES' };
  const seen = { inside: 0, refused: 0 };
  const deadline = Date.now() + DEADLINE_MS;
  for (let i = 0; i < ATTEMPTS && Date.now() < deadline; i++) {
    let text: string;
    try {
      const file = await resolveUploadPath('a/x', limits);
      try {
        const buffer = Buffer.alloc(file.size);
        await file.read(buffer, 0);
        text = buffer.toString();
      } finally {
        await file.close();
      }
    } catch {
      seen.refused++;
      continue;
    }
    expect(text, `attempt ${i}`).not.toBe(OUTSIDE);
    expect(text).toBe(INSIDE);
    seen.inside++;
  }
  // The race was exercised: some attempts got through, some were refused.
  expect(seen.inside).toBeGreaterThan(0);
  expect(seen.refused).toBeGreaterThan(0);
}, 20_000);
