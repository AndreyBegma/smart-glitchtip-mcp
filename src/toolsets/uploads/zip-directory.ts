import { inflateRawSync } from 'node:zlib';
import { UploadError } from './upload.error';
import type { UploadFile } from './upload-path';

// A minimal reader of a zip's central directory, for the local preflight of
// ProGuard zips and artifact bundles. It reads through the upload's open
// descriptor, never writes anything, and extracts one small entry at most.
// ZIP64, multi-disk archives, encryption and methods other than stored (0)
// and deflate (8) are refused rather than half-supported.

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
/** The EOCD record plus the longest comment a zip can carry. */
const EOCD_SEARCH = EOCD_SIZE + 0xffff;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_ENTRIES = 0xffff;
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
const STORED = 0;
const DEFLATE = 8;

export const MAX_EXTRACT_COMPRESSED = 1024 * 1024;
export const MAX_EXTRACT_UNCOMPRESSED = 4 * 1024 * 1024;

/** Every entry of the zip's central directory, in directory order. */
export async function readZipEntries(file: UploadFile): Promise<ZipEntry[]> {
  const eocd = await findEndOfCentralDirectory(file);
  const directory = await readExactly(file, eocd.offset, eocd.size);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < eocd.count; i++) {
    if (at + CENTRAL_HEADER_SIZE > directory.length) {
      refuse(file, 'the central directory is cut short');
    }
    if (directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      refuse(file, 'the central directory is corrupt');
    }
    const flags = directory.readUInt16LE(at + 8);
    const method = directory.readUInt16LE(at + 10);
    const compressedSize = directory.readUInt32LE(at + 20);
    const uncompressedSize = directory.readUInt32LE(at + 24);
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    const localHeaderOffset = directory.readUInt32LE(at + 42);
    const nameEnd = at + CENTRAL_HEADER_SIZE + nameLength;
    if (nameEnd > directory.length) refuse(file, 'the central directory is cut short');
    if (flags & FLAG_ENCRYPTED) refuse(file, 'it contains an encrypted entry');
    if (method !== STORED && method !== DEFLATE) {
      refuse(file, `it uses compression method ${method}; only stored and deflate are read`);
    }
    if ([compressedSize, uncompressedSize, localHeaderOffset].includes(0xffffffff)) {
      refuse(file, 'it is a ZIP64 archive');
    }
    const name = directory
      .subarray(at + CENTRAL_HEADER_SIZE, nameEnd)
      .toString(flags & FLAG_UTF8 ? 'utf8' : 'latin1');
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    at = nameEnd + extraLength + commentLength;
  }
  return entries;
}

/**
 * The bytes of one entry, which must be small: at most 1 MiB compressed and
 * 4 MiB uncompressed (inflation is capped at that, so a zip bomb stops there).
 */
export async function extractSmallEntry(file: UploadFile, entry: ZipEntry): Promise<Buffer> {
  if (
    entry.compressedSize > MAX_EXTRACT_COMPRESSED ||
    entry.uncompressedSize > MAX_EXTRACT_UNCOMPRESSED
  ) {
    refuse(file, `${entry.name} is larger than this server reads`);
  }
  const header = await readExactly(file, entry.localHeaderOffset, LOCAL_HEADER_SIZE);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) refuse(file, `${entry.name} is corrupt`);
  const dataOffset =
    entry.localHeaderOffset + LOCAL_HEADER_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);
  const data = await readExactly(file, dataOffset, entry.compressedSize);
  if (entry.method === STORED) return data;
  try {
    return inflateRawSync(data, { maxOutputLength: MAX_EXTRACT_UNCOMPRESSED });
  } catch {
    return refuse(file, `${entry.name} could not be inflated`);
  }
}

interface EndOfCentralDirectory {
  readonly count: number;
  readonly offset: number;
  readonly size: number;
}

async function findEndOfCentralDirectory(file: UploadFile): Promise<EndOfCentralDirectory> {
  const tailLength = Math.min(file.size, EOCD_SEARCH);
  const tailStart = file.size - tailLength;
  const tail = await readExactly(file, tailStart, tailLength);
  for (let at = tail.length - EOCD_SIZE; at >= 0; at--) {
    if (tail.readUInt32LE(at) !== EOCD_SIGNATURE) continue;
    if (at + EOCD_SIZE + tail.readUInt16LE(at + 20) > tail.length) continue;
    return parseEndOfCentralDirectory(file, tail, at, tailStart);
  }
  return refuse(file, 'no end-of-central-directory record was found');
}

function parseEndOfCentralDirectory(
  file: UploadFile,
  tail: Buffer,
  at: number,
  tailStart: number,
): EndOfCentralDirectory {
  const disk = tail.readUInt16LE(at + 4);
  const directoryDisk = tail.readUInt16LE(at + 6);
  const onDisk = tail.readUInt16LE(at + 8);
  const count = tail.readUInt16LE(at + 10);
  const size = tail.readUInt32LE(at + 12);
  const offset = tail.readUInt32LE(at + 16);
  const locator = at - ZIP64_LOCATOR_SIZE;
  if (
    count === MAX_ENTRIES ||
    size === 0xffffffff ||
    offset === 0xffffffff ||
    (locator >= 0 && tail.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE)
  ) {
    refuse(file, 'it is a ZIP64 archive');
  }
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== count) {
    refuse(file, 'it spans several disks');
  }
  if (size > MAX_CENTRAL_DIRECTORY_BYTES) refuse(file, 'its central directory is too large');
  if (offset + size > tailStart + at) refuse(file, 'the central directory lies outside the file');
  return { count, offset, size };
}

async function readExactly(file: UploadFile, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  if ((await file.read(buffer, position)) !== length) refuse(file, 'it ends too early');
  return buffer;
}

function refuse(file: UploadFile, reason: string): never {
  throw new UploadError(
    `${JSON.stringify(file.given)} is not a zip this server can read: ${reason}.`,
  );
}
