import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GlitchTipClient } from '../../src/glitchtip/glitchtip.client';
import { type UploadTree, uploadTree } from '../fixtures/uploads/upload-tree';
import { GLITCHTIP } from '../support/boot';
import { jsonResponse, MockGlitchTip } from '../support/mock-glitchtip';
import {
  CHUNK_UPLOAD,
  chunkInfo,
  DIF_ASSEMBLE,
  MIB,
  multipartFile,
  UploadsServer,
} from './uploads.support';

// The chunk-upload engine through upload_debug_file (acceptance 5, 6, 7 and
// the engine's error paths of 10): assemble first, send exactly the missing
// chunks in file order, assemble again — all on the resolved instance.

let tree: UploadTree;
const server = new UploadsServer(() => tree.root);
beforeAll(() => {
  tree = uploadTree();
});
afterAll(() => tree.remove());
afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');

/** A file of `sizes` chunks, chunk i filled with byte i+1, so every chunk hashes differently. */
function chunkedFile(name: string, sizes: readonly number[]) {
  const chunks = sizes.map((size, i) => Buffer.alloc(size, i + 1));
  const bytes = Buffer.concat(chunks);
  const path = tree.write(name, bytes);
  return { path, chunks, checksums: chunks.map(sha1), checksum: sha1(bytes) };
}

const assembleState = (checksum: string, state: string, missingChunks: string[] = []) =>
  jsonResponse({ [checksum]: { state, missingChunks } });

describe('a 70 MiB file in three 32 MiB chunks (acceptance 5 and 6)', () => {
  it('assembles first, POSTs exactly the two missing chunks in file order, then assembles again', async () => {
    const file = chunkedFile('big.debug', [32 * MIB, 32 * MIB, 6 * MIB]);
    const [c1, c2, c3] = file.checksums;
    const mock = new MockGlitchTip()
      // The advertised url names another host; it must never be contacted.
      .json('GET', CHUNK_UPLOAD, chunkInfo({ url: 'https://elsewhere.test/api/0/chunk-upload/' }))
      .on(
        'POST',
        DIF_ASSEMBLE,
        assembleState(file.checksum, 'not_found', [c3, c1]),
        assembleState(file.checksum, 'created'),
      )
      .on('POST', CHUNK_UPLOAD, new Response('', { status: 200 }));
    const call = vi.spyOn(GlitchTipClient.prototype, 'call');

    const { text, isError } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'big.debug',
    });

    expect(isError, text).toBe(false);
    expect(mock.requests.map((r) => `${r.method} ${r.url.href}`)).toEqual([
      `GET ${CHUNK_UPLOAD}`,
      `POST ${DIF_ASSEMBLE}`,
      `POST ${CHUNK_UPLOAD}`,
      `POST ${CHUNK_UPLOAD}`,
      `POST ${DIF_ASSEMBLE}`,
    ]);
    expect(mock.requests.every((r) => r.url.origin === GLITCHTIP)).toBe(true);
    expect(mock.unrouted).toEqual([]);

    const [, firstAssemble, , , secondAssemble] = mock.requests;
    for (const assemble of [firstAssemble, secondAssemble]) {
      expect(JSON.parse(assemble.body)).toEqual({
        [file.checksum]: { name: 'big.debug', chunks: [c1, c2, c3] },
      });
    }
    const posts = mock.requests.filter((r) => r.method === 'POST' && r.url.href === CHUNK_UPLOAD);
    const sent = [file.chunks[0], file.chunks[2]];
    for (const [i, post] of posts.entries()) {
      expect(post.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
      const part = await multipartFile(post, 'file_gzip');
      expect(part.name).toBe(sha1(sent[i]));
      const gunzipped = gunzipSync(new Uint8Array(await part.arrayBuffer()));
      expect(gunzipped.equals(sent[i])).toBe(true);
    }

    const chunkCalls = call.mock.calls.filter(([operation]) => operation.name === 'upload chunk');
    expect(chunkCalls).toHaveLength(2);
    for (const [, , options] of chunkCalls) expect(options).toEqual({ timeoutMs: 120_000 });
    const otherCalls = call.mock.calls.filter(([operation]) => operation.name !== 'upload chunk');
    for (const [, , options] of otherCalls) expect(options).toBeUndefined();

    expect(text).toContain('`created`: assembly queued');
    expect(text).toContain(`sha1: ${file.checksum}`);
    expect(text).toContain('chunks: 3 (2 sent, 1 already on the server)');
    expect(text).toContain('Check with `list_debug_files(project)`');
  }, 60_000);
});

describe('the file changes between pass 1 and pass 2 (acceptance 7)', () => {
  it('stops with "The file changed during upload" and never assembles again', async () => {
    const file = chunkedFile('moving.debug', [64 * 1024, 64 * 1024]);
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo({ chunkSize: 64 * 1024 }))
      .on('POST', DIF_ASSEMBLE, () => {
        // Rewritten in place (same inode): the open descriptor sees the change.
        writeFileSync(file.path, Buffer.alloc(128 * 1024, 9));
        return assembleState(file.checksum, 'not_found', file.checksums);
      })
      .on('POST', CHUNK_UPLOAD, new Response('', { status: 200 }));
    const { text, isError } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'moving.debug',
    });
    expect(isError).toBe(true);
    expect(text).toContain('The file changed during upload');
    expect(mock.requests.filter((r) => r.url.href === DIF_ASSEMBLE)).toHaveLength(1);
    expect(mock.requests.filter((r) => r.method === 'POST' && r.url.href === CHUNK_UPLOAD)).toEqual(
      [],
    );
  });
});

describe('engine outcomes and failures', () => {
  const small = () => chunkedFile('small.debug', [1000]);

  it('`ok` on the first assemble sends no chunk', async () => {
    const file = small();
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo())
      .on('POST', DIF_ASSEMBLE, assembleState(file.checksum, 'ok'));
    const { text, isError } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'small.debug',
      name: 'libapp.so',
      debug_id: '0123456789abcdef0123456789abcdef',
    });
    expect(isError, text).toBe(false);
    expect(text).toContain('`ok`: already present');
    expect(text).toContain('chunks: 1 (0 sent, 1 already on the server)');
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      [file.checksum]: {
        name: 'libapp.so',
        debug_id: '0123456789abcdef0123456789abcdef',
        chunks: file.checksums,
      },
    });
  });

  it('a 400 on a chunk names the chunk and GlitchTip’s detail', async () => {
    const file = small();
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo())
      .on('POST', DIF_ASSEMBLE, assembleState(file.checksum, 'not_found', file.checksums))
      .on('POST', CHUNK_UPLOAD, jsonResponse({ detail: 'Invalid gzip chunk' }, 400));
    const { text, isError } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'small.debug',
    });
    expect(isError).toBe(true);
    expect(text).toContain('GlitchTip rejected chunk 1 of 1: Invalid gzip chunk.');
    expect(text).toContain(
      '0 of 1 missing chunks were sent before it; run the tool again to resume.',
    );
    expect(mock.requests.filter((r) => r.url.href === DIF_ASSEMBLE)).toHaveLength(1);
  });

  it('a 413 on a chunk names the proxy limit', async () => {
    const file = small();
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo())
      .on('POST', DIF_ASSEMBLE, assembleState(file.checksum, 'not_found', file.checksums))
      .on('POST', CHUNK_UPLOAD, new Response('too big', { status: 413 }));
    const { text } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'small.debug',
    });
    expect(text).toContain(
      'The instance refused a 1000-byte request (413); its proxy limit is below the advertised chunk size.',
    );
  });

  it('a 403 on assemble names the scopes', async () => {
    small();
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo())
      .json('POST', DIF_ASSEMBLE, { detail: 'nope' }, { status: 403 });
    const { text, isError } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'small.debug',
    });
    expect(isError).toBe(true);
    expect(text).toBe(
      'The token lacks permission for assemble debug file. It needs one of: project:write, project:admin, project:releases.',
    );
  });

  it('a 404 on assemble names the project', async () => {
    small();
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo())
      .json('POST', DIF_ASSEMBLE, { detail: 'Not Found' }, { status: 404 });
    const { text } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'small.debug',
    });
    expect(text).toBe('Project app was not found in acme.');
  });

  it.each([
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
    ['an unexpected shape', () => jsonResponse({ other: { state: 'ok' } })],
    [
      'a missing chunk that is not one of the file’s',
      (checksum: string) => assembleState(checksum, 'not_found', ['f'.repeat(40)]),
    ],
  ])('an assemble reply with %s is a degraded error, not "Internal error"', async (_, reply) => {
    const file = small();
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo())
      .on('POST', DIF_ASSEMBLE, () => reply(file.checksum));
    const { text, isError } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'small.debug',
    });
    expect(isError).toBe(true);
    expect(text).toBe('GlitchTip returned an unexpected response for assemble.');
    expect(mock.requests.filter((r) => r.method === 'POST' && r.url.href === CHUNK_UPLOAD)).toEqual(
      [],
    );
  });

  it('still-missing chunks after upload are an error', async () => {
    const file = small();
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo())
      .on(
        'POST',
        DIF_ASSEMBLE,
        assembleState(file.checksum, 'not_found', file.checksums),
        assembleState(file.checksum, 'not_found', file.checksums),
      )
      .on('POST', CHUNK_UPLOAD, new Response('', { status: 200 }));
    const { text } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'small.debug',
    });
    expect(text).toBe('GlitchTip still reports 1 missing chunks after upload.');
  });

  it('an `error` state on the second assemble is reported as such, not as missing chunks', async () => {
    const file = small();
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo())
      .on(
        'POST',
        DIF_ASSEMBLE,
        assembleState(file.checksum, 'not_found', file.checksums),
        jsonResponse({ [file.checksum]: { state: 'error', missingChunks: [], detail: 'bad' } }),
      )
      .on('POST', CHUNK_UPLOAD, new Response('', { status: 200 }));
    const { text } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'small.debug',
    });
    expect(text).toBe(
      'GlitchTip answered the assemble step with state "error": <untrusted source="glitchtip-config" field="detail">bad</untrusted>.',
    );
  });

  it('sends each distinct missing chunk once, in file order, for many chunks', async () => {
    // 64 KiB chunks, chunks 0 and 2 identical: one POST covers both.
    const size = 64 * 1024;
    const bytes = Buffer.concat([
      Buffer.alloc(size, 1),
      Buffer.alloc(size, 2),
      Buffer.alloc(size, 1),
      Buffer.alloc(size, 3),
    ]);
    tree.write('repeat.debug', bytes);
    const piece = (i: number) => bytes.subarray(i * size, (i + 1) * size);
    const [c0, c1, , c3] = [0, 1, 2, 3].map((i) => sha1(piece(i)));
    const checksum = sha1(bytes);
    const mock = new MockGlitchTip()
      .json('GET', CHUNK_UPLOAD, chunkInfo({ chunkSize: size }))
      .on(
        'POST',
        DIF_ASSEMBLE,
        assembleState(checksum, 'not_found', [c3, c0, c0]),
        assembleState(checksum, 'created'),
      )
      .on('POST', CHUNK_UPLOAD, new Response('', { status: 200 }));
    const { isError, text } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'repeat.debug',
    });
    expect(isError, text).toBe(false);
    const posts = mock.requests.filter((r) => r.method === 'POST' && r.url.href === CHUNK_UPLOAD);
    const names = await Promise.all(
      posts.map(async (p) => (await multipartFile(p, 'file_gzip')).name),
    );
    expect(names).toEqual([c0, c3]);
    expect(names).not.toContain(c1);
  });

  it.each([
    ['chunkSize', { chunkSize: 1024 }],
    ['compression', { compression: [] }],
    ['hashAlgorithm', { hashAlgorithm: 'sha256' }],
    ['accept', { accept: ['artifact_bundles'] }],
  ])(
    'refuses an instance advertising an unsupported %s, before any assemble',
    async (field, info) => {
      small();
      const mock = new MockGlitchTip().json('GET', CHUNK_UPLOAD, chunkInfo(info));
      const { text, isError } = await server.call(mock, 'upload_debug_file', {
        project: 'app',
        path: 'small.debug',
      });
      expect(isError).toBe(true);
      expect(text).toBe(
        `This GlitchTip instance advertises chunk-upload settings this server does not support: ${field}.`,
      );
      expect(mock.requests).toHaveLength(1);
    },
  );

  it('refuses a file over the instance’s maxFileSize after the info GET', async () => {
    small();
    const mock = new MockGlitchTip().json('GET', CHUNK_UPLOAD, chunkInfo({ maxFileSize: 999 }));
    const { text } = await server.call(mock, 'upload_debug_file', {
      project: 'app',
      path: 'small.debug',
    });
    expect(text).toBe('The file is 1000 bytes; this instance accepts at most 999 (maxFileSize).');
    expect(mock.requests).toHaveLength(1);
  });
});
