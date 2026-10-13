import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { untrusted } from '../../format/untrusted';
import type { GlitchTipClient } from '../../glitchtip/glitchtip.client';
import { GlitchTipError, type Operation } from '../../glitchtip/glitchtip.errors';
import { UploadError } from './upload.error';
import type { UploadFile } from './upload-path';
import {
  type AssembleState,
  atStep,
  type ChunkUploadInfo,
  chunkUploadInfoSchema,
  expectShape,
  unexpectedResponse,
} from './uploads.schemas';

// The chunk-upload engine shared by upload_debug_file and
// upload_artifact_bundle, as GlitchTip 6.2.6 implements Sentry's protocol:
// info → hash locally → assemble → send what is missing → assemble again.
// Every request goes to the resolved instance through GlitchTipClient; the
// `url` the info advertises is never used (AGENTS.md rules 9 and 13).

export type UploadKind = 'debug_files' | 'artifact_bundles';

/** Scopes GlitchTip accepts for the chunk POST and both assemble routes. */
export const UPLOAD_SCOPES = ['project:write', 'project:admin', 'project:releases'] as const;

/** 32 MiB does not reliably cross a network in the default 15 s (spec: Timeouts). */
export const CHUNK_TIMEOUT_MS = 120_000;
const MIN_CHUNK_SIZE = 64 * 1024;
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;

/** One assemble call: the whole file's SHA-1 and its chunks' SHA-1s, in file order. */
export type Assemble = (checksum: string, chunks: readonly string[]) => Promise<AssembleState>;

export interface ChunkUploadOutcome {
  readonly state: 'ok' | 'created';
  readonly checksum: string;
  readonly size: number;
  readonly chunks: number;
  /** Chunks this call sent; the rest were already on the server. */
  readonly sent: number;
}

/** GET chunk-upload/, validated. Used by get_chunk_upload_info and step 1 of every upload. */
export async function fetchChunkUploadInfo(
  client: GlitchTipClient,
  org: string,
): Promise<ChunkUploadInfo> {
  const step = 'chunk-upload info';
  const body = await atStep(
    step,
    client.call<unknown>(
      { name: 'get chunk-upload info', scopes: [], resource: 'Organization', id: org },
      (api) =>
        api.GET('/api/0/organizations/{organization_slug}/chunk-upload/', {
          params: { path: { organization_slug: org } },
        }),
    ),
  );
  return expectShape(chunkUploadInfoSchema, body, step);
}

/** Uploads `file` in chunks and assembles it; see the module comment for the steps. */
export async function uploadInChunks(
  client: GlitchTipClient,
  org: string,
  file: UploadFile,
  kind: UploadKind,
  assemble: Assemble,
): Promise<ChunkUploadOutcome> {
  const info = await fetchChunkUploadInfo(client, org);
  checkSupported(info, kind, file.size);
  const { checksum, chunks } = await hashFile(file, info.chunkSize);
  const outcome = (state: 'ok' | 'created', sent: number): ChunkUploadOutcome => ({
    state,
    checksum,
    size: file.size,
    chunks: chunks.length,
    sent,
  });
  const first = await assemble(checksum, chunks);
  if (isDone(first)) return outcome(first.state, 0);
  if (first.state !== 'not_found') throw assemblyFailed(first);
  const sent = await sendMissing(client, org, file, info.chunkSize, chunks, first.missingChunks);
  const second = await assemble(checksum, chunks);
  if (isDone(second)) return outcome(second.state, sent);
  if (second.state !== 'not_found') throw assemblyFailed(second);
  throw new UploadError(
    `GlitchTip still reports ${second.missingChunks.length} missing chunks after upload.`,
  );
}

function checkSupported(info: ChunkUploadInfo, kind: UploadKind, size: number): void {
  const unsupported = (field: string) =>
    new UploadError(
      `This GlitchTip instance advertises chunk-upload settings this server does not support: ${field}.`,
    );
  if (info.chunkSize < MIN_CHUNK_SIZE || info.chunkSize > MAX_CHUNK_SIZE) {
    throw unsupported('chunkSize');
  }
  if (!info.compression.includes('gzip')) throw unsupported('compression');
  if (info.hashAlgorithm !== 'sha1') throw unsupported('hashAlgorithm');
  if (!info.accept.includes(kind)) throw unsupported('accept');
  if (size > info.maxFileSize) {
    throw new UploadError(
      `The file is ${size} bytes; this instance accepts at most ${info.maxFileSize} (maxFileSize).`,
    );
  }
}

/** Pass 1: every chunk's SHA-1 and the whole file's, holding one chunk in memory. */
async function hashFile(
  file: UploadFile,
  chunkSize: number,
): Promise<{ checksum: string; chunks: string[] }> {
  const whole = createHash('sha1');
  const chunks: string[] = [];
  const buffer = Buffer.alloc(Math.min(chunkSize, file.size));
  for (let position = 0; position < file.size; position += chunkSize) {
    const length = Math.min(chunkSize, file.size - position);
    const piece = buffer.subarray(0, length);
    if ((await file.read(piece, position)) !== length) throw fileChanged();
    whole.update(piece);
    chunks.push(sha1(piece));
  }
  return { checksum: whole.digest('hex'), chunks };
}

/**
 * Pass 2: each missing chunk, in file order and one request at a time, after
 * re-reading it and checking it still hashes the same. Returns how many
 * chunks were sent. Chunk POSTs are mutations: the client never retries them.
 */
async function sendMissing(
  client: GlitchTipClient,
  org: string,
  file: UploadFile,
  chunkSize: number,
  chunks: readonly string[],
  missing: readonly string[],
): Promise<number> {
  const firstIndex = new Map<string, number>();
  chunks.forEach((checksum, index) => {
    if (!firstIndex.has(checksum)) firstIndex.set(checksum, index);
  });
  const order: number[] = [];
  for (const checksum of new Set(missing)) {
    const index = firstIndex.get(checksum);
    if (index === undefined) throw unexpectedResponse('assemble');
    order.push(index);
  }
  order.sort((a, b) => a - b);
  let sent = 0;
  for (const index of order) {
    const position = index * chunkSize;
    const piece = Buffer.alloc(Math.min(chunkSize, file.size - position));
    if ((await file.read(piece, position)) !== piece.length || sha1(piece) !== chunks[index]) {
      throw fileChanged();
    }
    try {
      await postChunk(client, org, chunks[index], piece);
    } catch (error) {
      throw chunkFailed(error, index + 1, chunks.length, sent, order.length, piece.length);
    }
    sent++;
  }
  return sent;
}

function postChunk(
  client: GlitchTipClient,
  org: string,
  checksum: string,
  piece: Buffer,
): Promise<unknown> {
  const form = new FormData();
  form.append('file_gzip', new Blob([new Uint8Array(gzipSync(piece))]), checksum);
  const operation: Operation = {
    name: 'upload chunk',
    scopes: UPLOAD_SCOPES,
    resource: 'Organization',
    id: org,
  };
  return client.call(
    operation,
    (api) =>
      api.POST('/api/0/organizations/{organization_slug}/chunk-upload/', {
        params: { path: { organization_slug: org } },
        body: form as never,
        parseAs: 'text',
      }),
    { timeoutMs: CHUNK_TIMEOUT_MS },
  );
}

function chunkFailed(
  error: unknown,
  number: number,
  total: number,
  sent: number,
  missing: number,
  bytes: number,
): unknown {
  if (!(error instanceof GlitchTipError)) return error;
  const progress = `${sent} of ${missing} missing chunks were sent before it; run the tool again to resume.`;
  if (error.status === 400) {
    const detail = error.detail ?? 'status 400';
    return new UploadError(
      `GlitchTip rejected chunk ${number} of ${total}: ${detail}. ${progress}`,
    );
  }
  if (error.status === 413) {
    return new UploadError(
      `The instance refused a ${bytes}-byte request (413); its proxy limit is below the advertised chunk size. ${progress}`,
    );
  }
  return new UploadError(`Chunk ${number} of ${total} failed: ${error.message} ${progress}`);
}

function assemblyFailed(state: AssembleState): UploadError {
  const detail = state.detail ? `: ${untrusted('detail', state.detail, 'glitchtip-config')}` : '';
  return new UploadError(
    `GlitchTip answered the assemble step with state ${JSON.stringify(state.state)}${detail}.`,
  );
}

function isDone(state: AssembleState): state is AssembleState & { state: 'ok' | 'created' } {
  return state.state === 'ok' || state.state === 'created';
}

function fileChanged(): UploadError {
  return new UploadError('The file changed during upload; run the tool again once it is stable.');
}

function sha1(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}
