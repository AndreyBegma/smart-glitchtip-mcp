import { constants, type Stats } from 'node:fs';
import { type FileHandle, open, realpath, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { UploadError } from './upload.error';

// D-22: the upload tools read only regular files below GLITCHTIP_UPLOAD_ROOT.
// Every rule judges the resolved path, never the string the caller gave, and
// every error names the path as the caller gave it — never where it resolved.

export const MAX_PATH_LENGTH = 4096;

/**
 * O_NOFOLLOW refuses a final symlink swapped in after the realpath. O_NONBLOCK
 * keeps a FIFO swapped in at the last moment from blocking the open (the
 * fstat below then refuses it), and O_NOCTTY keeps a terminal from becoming
 * the process's controlling terminal. On a regular file neither changes a read.
 */
const OPEN_FLAGS =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY;

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
 * a path that resolves outside the root (symlinks are followed and judged by
 * where they land), one whose resolved form passes through a dot-segment
 * below the root, a directory, anything that is not a regular file, an empty
 * file, and one larger than the cap.
 */
export async function resolveUploadPath(
  given: string,
  limits: UploadPathLimits,
): Promise<UploadFile> {
  checkShape(given);
  const shown = JSON.stringify(given);
  const real = await fsStep(shown, () => realpath(resolve(limits.root, given)));
  if (!isInside(limits.root, real)) {
    throw new UploadError(`${shown} resolves outside the upload root.`);
  }
  if (hasDotSegment(relative(limits.root, real))) {
    throw new UploadError(
      `${shown} passes through a hidden (dot) file or directory below the upload root; those are never read.`,
    );
  }
  const before = await fsStep(shown, () => stat(real));
  checkFile(shown, real, before, limits);
  const handle = await fsStep(shown, () => open(real, OPEN_FLAGS));
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) {
      throw new UploadError(`${shown} changed while it was being opened; try again.`);
    }
    checkFile(shown, real, after, limits);
    return openFile(given, basename(real), after.size, handle);
  } catch (error) {
    await handle.close();
    throw error;
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
}

function isInside(root: string, real: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return real === root || real.startsWith(prefix);
}

function hasDotSegment(below: string): boolean {
  return below.split(sep).some((segment) => segment.startsWith('.'));
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
  if (stats.size === 0) {
    throw new UploadError(`${shown} is empty.`);
  }
  if (stats.size > limits.maxBytes) {
    throw new UploadError(
      `${shown} is ${stats.size} bytes, over the ${limits.maxBytes}-byte limit (${limits.capName}).`,
    );
  }
}

/** Runs one filesystem call; its failure becomes "Cannot read <path>: <code>". */
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
