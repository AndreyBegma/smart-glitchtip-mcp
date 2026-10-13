import { constants, type Stats } from 'node:fs';
import { type FileHandle, open, readlink, realpath, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { UploadError } from './upload.error';

// D-22: the upload tools read only regular files below GLITCHTIP_UPLOAD_ROOT.
// Every rule judges the resolved path, never the string the caller gave, and
// every error names the path as the caller gave it — never where it resolved.
//
// Nothing here may answer differently for an existing and a missing path
// outside the root or behind a dot-segment: lexically outside and lexical
// dot paths are refused before any filesystem call, and every later failure
// to resolve, or resolution to such a place, gets one generic message.

export const MAX_PATH_LENGTH = 4096;

/**
 * O_NOFOLLOW refuses a final symlink swapped in after the realpath. O_NONBLOCK
 * keeps a FIFO swapped in at the last moment from blocking the open (the
 * fstat below then refuses it), and O_NOCTTY keeps a terminal from becoming
 * the process's controlling terminal. On a regular file neither changes a read.
 * O_NOFOLLOW guards the last component only; see `confirmOpened`.
 */
const OPEN_FLAGS =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY;

/**
 * How the path of an open descriptor is confirmed. `proc` reads it from
 * /proc/self/fd (Linux) and closes the swap-after-check race; `realpath`
 * resolves the path again and compares identities, which narrows the race
 * but cannot close it. Linux never falls back: without /proc it refuses.
 */
export type OpenedPathCheck = 'proc' | 'realpath';
const OPENED_PATH_CHECK: OpenedPathCheck = process.platform === 'linux' ? 'proc' : 'realpath';

/** A regular file below the upload root, open for reading. */
export interface UploadFile {
  /** The path as the caller gave it; the only form an error may show. */
  readonly given: string;
  /** The file's own name (the basename of where it resolved, inside the root). */
  readonly name: string;
  readonly size: number;
  /**
   * Fills `buffer` from `position` through the open descriptor, stopping
   * early only at the end of the file. Returns the bytes read.
   */
  read(buffer: Buffer, position: number): Promise<number>;
  close(): Promise<void>;
}

export interface UploadPathLimits {
  /** The realpath of GLITCHTIP_UPLOAD_ROOT, as configuration stored it. */
  readonly root: string;
  /** The largest file accepted, in bytes. */
  readonly maxBytes: number;
  /** Names the cap in the error, e.g. "GLITCHTIP_UPLOAD_MAX_BYTES". */
  readonly capName: string;
}

/**
 * Resolves `given` (relative to the root, or absolute) to a regular file
 * inside the root and opens it. Refuses, with an UploadError naming the rule:
 * a path outside the root (symlinks are followed and judged by where they
 * land), one passing through a dot-segment below the root, a directory,
 * anything that is not a regular file, a file with more than one hard link,
 * an empty file, one larger than the cap, and a file whose open descriptor
 * does not refer to the path that was checked.
 */
export async function resolveUploadPath(
  given: string,
  limits: UploadPathLimits,
): Promise<UploadFile> {
  checkShape(given);
  const { root } = limits;
  const shown = JSON.stringify(given);
  const target = resolve(root, given);
  if (!isInside(root, target)) throw unreachable(shown);
  if (hasDotSegment(relative(root, target))) {
    throw new UploadError(
      `${shown} passes through a hidden (dot) file or directory below the upload root; those are never read.`,
    );
  }
  const real = await realpath(target).catch(() => {
    throw unreachable(shown);
  });
  if (!isAllowed(root, real)) throw unreachable(shown);
  const before = await fsStep(shown, () => stat(real));
  checkFile(shown, real, before, limits);
  const handle = await fsStep(shown, () => open(real, OPEN_FLAGS));
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) {
      throw changedWhileOpening(shown);
    }
    checkFile(shown, real, after, limits);
    await confirmOpened(OPENED_PATH_CHECK, { handle, target, real, root, stats: after, shown });
    return openFile(given, basename(real), after.size, handle);
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export interface OpenedFile {
  readonly handle: FileHandle;
  /** The caller's path, resolved lexically against the root. */
  readonly target: string;
  /** Its realpath, as checked before the open. */
  readonly real: string;
  readonly root: string;
  /** fstat of the descriptor. */
  readonly stats: Stats;
  readonly shown: string;
}

/**
 * O_NOFOLLOW guards only the last component: a directory on the checked path
 * swapped for a symlink between the realpath and the open makes the open land
 * outside, and stat and fstat then agree on the outside file. So the path the
 * descriptor actually refers to is checked after the open.
 */
export async function confirmOpened(check: OpenedPathCheck, opened: OpenedFile): Promise<void> {
  const { handle, target, real, root, stats, shown } = opened;
  if (check === 'proc') {
    const path = await readlink(`/proc/self/fd/${handle.fd}`).catch(() => undefined);
    if (path !== real || !isAllowed(root, path)) throw changedWhileOpening(shown);
    return;
  }
  const again = await realpath(target).catch(() => undefined);
  const againStats = again === undefined ? undefined : await stat(again).catch(() => undefined);
  if (again !== real || againStats?.dev !== stats.dev || againStats?.ino !== stats.ino) {
    throw changedWhileOpening(shown);
  }
}

function checkShape(given: string): void {
  if (typeof given !== 'string' || given.length === 0) {
    throw new UploadError('path must not be empty.');
  }
  if (given.length > MAX_PATH_LENGTH) {
    throw new UploadError(`path must be at most ${MAX_PATH_LENGTH} characters.`);
  }
  if (given.includes('\0')) {
    throw new UploadError('path must not contain a NUL byte.');
  }
  if (given.endsWith('/')) {
    throw new UploadError('path must name a file, not end with /.');
  }
}

/** Inside the root and behind no dot-segment below it. */
function isAllowed(root: string, path: string): boolean {
  return isInside(root, path) && !hasDotSegment(relative(root, path));
}

function isInside(root: string, path: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return path === root || path.startsWith(prefix);
}

function hasDotSegment(below: string): boolean {
  return below.split(sep).some((segment) => segment.startsWith('.'));
}

/** One answer for missing, outside and hidden, so it reveals none of them. */
function unreachable(shown: string): UploadError {
  return new UploadError(
    `${shown} was not found, or resolves outside the upload root or into a hidden (dot) path.`,
  );
}

function changedWhileOpening(shown: string): UploadError {
  return new UploadError(`${shown} changed while it was being opened; try again.`);
}

function checkFile(shown: string, real: string, stats: Stats, limits: UploadPathLimits): void {
  if (stats.isDirectory()) {
    if (/\.dsym$/i.test(basename(real))) {
      throw new UploadError(
        `${shown} is a .dSYM directory; pass the DWARF file inside it (<name>.dSYM/Contents/Resources/DWARF/<name>). Only single files are uploaded.`,
      );
    }
    throw new UploadError(`${shown} is a directory; pass a file.`);
  }
  if (!stats.isFile()) {
    throw new UploadError(`${shown} is not a regular file.`);
  }
  if (stats.nlink > 1) {
    // A hard link inside the root can name a file that lives anywhere on the
    // same filesystem; the kernel's protected_hardlinks is not relied on.
    throw new UploadError(
      `${shown} has more than one hard link; copy the file into the upload root instead.`,
    );
  }
  if (stats.size === 0) {
    throw new UploadError(`${shown} is empty.`);
  }
  if (stats.size > limits.maxBytes) {
    throw new UploadError(
      `${shown} is ${stats.size} bytes, over the ${limits.maxBytes}-byte limit (${limits.capName}).`,
    );
  }
}

/** Runs one filesystem call on a path already inside the root. */
async function fsStep<T>(shown: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError(`Cannot read ${shown}: ${errorCode(error)}.`);
  }
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'unreadable';
}

function openFile(given: string, name: string, size: number, handle: FileHandle): UploadFile {
  const shown = JSON.stringify(given);
  return {
    given,
    name,
    size,
    read: (buffer, position) => fsStep(shown, () => readFully(handle, buffer, position)),
    close: () => handle.close(),
  };
}

async function readFully(handle: FileHandle, buffer: Buffer, position: number): Promise<number> {
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      filled,
      buffer.length - filled,
      position + filled,
    );
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled;
}
