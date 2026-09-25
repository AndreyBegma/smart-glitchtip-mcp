import { keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';
import type { BundleManifest } from './bundle-preflight';
import type { ChunkUploadOutcome } from './chunk-upload';
import type { ChunkUploadInfo, ProguardReply } from './uploads.schemas';

type DebugFile = components['schemas']['DebugFileSchema'];

// Views project GlitchTip's answers down to the fields an agent uses (D-12).
// Debug-file object names, ProGuard result names and manifest values come
// from whoever produced the uploaded files: text output fences each one, and
// json output is fenced as a whole through View.untrusted (D-18).

/** Caps one fenced value so a response-budget cut cannot land inside its fence. */
const NAME_CAP = 300;

export function chunkUploadInfoView(
  info: ChunkUploadInfo,
  local: { readonly root: string; readonly maxBytes: number },
): View {
  // `url` is left out: it is never used, and it may name an internal host.
  const projection = {
    chunkSize: info.chunkSize,
    chunksPerRequest: info.chunksPerRequest,
    maxFileSize: info.maxFileSize,
    maxRequestSize: info.maxRequestSize ?? null,
    concurrency: info.concurrency,
    hashAlgorithm: info.hashAlgorithm,
    compression: info.compression,
    accept: info.accept,
    uploadRoot: local.root,
    localSizeCap: local.maxBytes,
  };
  return {
    text: () =>
      keyValues([
        ['chunk size', projection.chunkSize],
        ['chunks per request', projection.chunksPerRequest],
        ['max file size', projection.maxFileSize],
        ['max request size', projection.maxRequestSize],
        ['concurrency', projection.concurrency],
        ['hash algorithm', projection.hashAlgorithm],
        ['compression', projection.compression.join(', ')],
        ['accept', projection.accept.join(', ')],
        ['upload root', projection.uploadRoot],
        ['local size cap', projection.localSizeCap],
      ]),
    json: () => projection,
  };
}

export function debugFileListView(org: string, project: string, page: Page<DebugFile>): View {
  const files = page.items.map((f) => ({
    id: f.id,
    debugId: f.debugId ?? null,
    cpuName: f.cpuName,
    symbolType: f.symbolType ?? null,
    size: f.size,
    sha1: f.sha1,
    dateCreated: f.dateCreated,
    objectName: f.objectName,
  }));
  return {
    untrusted: { field: 'debug_files', source: 'glitchtip-config' },
    text: () => {
      if (files.length === 0) return `No debug files uploaded to ${org}/${project}.`;
      const body = table(files, [
        { header: 'id', value: (f) => f.id },
        { header: 'debugId', value: (f) => f.debugId },
        { header: 'cpuName', value: (f) => f.cpuName },
        { header: 'symbolType', value: (f) => f.symbolType },
        { header: 'size', value: (f) => f.size },
        { header: 'sha1', value: (f) => f.sha1 },
        { header: 'dateCreated', value: (f) => f.dateCreated },
      ]);
      // Table cells are cut at 80 characters, which would split a fence.
      const [header, ...rows] = body.split('\n');
      const named = rows.map((line, i) => `${line}  ${fenced('objectName', files[i].objectName)}`);
      return withCursor([`${header}  objectName`, ...named].join('\n'), page.nextCursor);
    },
    json: () => ({ debug_files: files, nextCursor: page.nextCursor ?? null }),
  };
}

export function debugFileUploadView(outcome: ChunkUploadOutcome, name: string): View {
  const projection = { ...outcomeFields(outcome), name };
  return {
    text: () =>
      [
        outcome.state === 'ok' ? '`ok`: already present' : '`created`: assembly queued',
        keyValues([
          ['name', name],
          ['sha1', outcome.checksum],
          ['size', outcome.size],
          ['chunks', chunkLine(outcome)],
        ]),
        'Check with `list_debug_files(project)`; files that are not valid debug files are dropped by GlitchTip without an error.',
      ].join('\n'),
    json: () => projection,
  };
}

export function proguardUploadView(reply: ProguardReply): View {
  const mappings = reply.map((m) => ({
    id: m.id,
    debugId: m.debugId ?? m.uuid ?? null,
    size: m.size ?? null,
    sha1: m.sha1 ?? null,
    objectName: m.objectName ?? null,
  }));
  return {
    untrusted: { field: 'mappings', source: 'glitchtip-config' },
    text: () => {
      if (mappings.length === 0) return 'GlitchTip accepted the zip but reported no mappings.';
      const body = table(mappings, [
        { header: 'id', value: (m) => m.id },
        { header: 'debugId', value: (m) => m.debugId },
        { header: 'size', value: (m) => m.size },
        { header: 'sha1', value: (m) => m.sha1 },
      ]);
      const [header, ...rows] = body.split('\n');
      const named = rows.map((line, i) => {
        const name = mappings[i].objectName;
        return name === null ? line : `${line}  ${fenced('objectName', name)}`;
      });
      return [`${header}  objectName`, ...named].join('\n');
    },
    json: () => ({ mappings }),
  };
}

export function bundleUploadView(
  outcome: ChunkUploadOutcome,
  manifest: BundleManifest,
  release: string | undefined,
): View {
  const bundle = {
    ...outcomeFields(outcome),
    files: manifest.files,
    debugIds: manifest.debugIds,
    release: release ?? null,
  };
  return {
    untrusted: { field: 'bundle', source: 'external' },
    text: () =>
      [
        `state: ${outcome.state}`,
        keyValues([
          ['checksum', outcome.checksum],
          ['size', outcome.size],
          ['chunks', chunkLine(outcome)],
          ['files', manifest.files],
          ['files with a debug id', manifest.debugIds],
          ['release', release === undefined ? '(none)' : fenced('release', release, 'external')],
        ]),
        "Assembly runs in the background and its result is not readable through the API. With a release, check the release's files (releases toolset).",
      ].join('\n'),
    json: () => ({ bundle }),
  };
}

function outcomeFields(outcome: ChunkUploadOutcome) {
  return {
    state: outcome.state,
    sha1: outcome.checksum,
    size: outcome.size,
    chunks: outcome.chunks,
    chunksSent: outcome.sent,
    chunksAlreadyOnServer: outcome.chunks - outcome.sent,
  };
}

function chunkLine(outcome: ChunkUploadOutcome): string {
  return `${outcome.chunks} (${outcome.sent} sent, ${outcome.chunks - outcome.sent} already on the server)`;
}

function fenced(
  field: string,
  value: string,
  source: 'glitchtip-config' | 'external' = 'glitchtip-config',
): string {
  const flat = value.replace(/\s+/g, ' ');
  return untrusted(
    field,
    flat.length > NAME_CAP ? `${flat.slice(0, NAME_CAP - 1)}…` : flat,
    source,
  );
}
