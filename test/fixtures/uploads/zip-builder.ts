import { deflateRawSync } from 'node:zlib';

// Builds small zip archives in memory for the uploads tests. Only what the
// tests need: stored or deflated entries, and knobs to produce the archives
// the reader must refuse (encrypted, ZIP64, unknown method).

export interface ZipEntrySpec {
  readonly name: string;
  readonly data: string | Buffer;
  readonly method?: 0 | 8 | number;
  readonly flags?: number;
}

export interface ZipOptions {
  /** Writes a ZIP64 end-of-central-directory locator before the EOCD. */
  readonly zip64Locator?: boolean;
  readonly comment?: string;
}

export function buildZip(entries: readonly ZipEntrySpec[], options: ZipOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const method = entry.method ?? 8;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(entry.name, 'utf8');
    const flags = (entry.flags ?? 0) | 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const tail: Buffer[] = [];
  if (options.zip64Locator) {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    tail.push(locator);
  }
  const comment = Buffer.from(options.comment ?? '');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, directory, ...tail, eocd, comment]);
}

/** A manifest.json as Sentry tooling writes it. */
export function manifest(fields: {
  org?: string;
  release?: string;
  files?: Record<string, { url: string; type: string; headers?: Record<string, string> }>;
}): string {
  return JSON.stringify({
    org: fields.org,
    release: fields.release,
    files: fields.files ?? {
      'files/_/_/app.min.js': { url: '~/app.min.js', type: 'minified_source', headers: {} },
    },
  });
}
