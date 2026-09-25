import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type UploadTree, uploadTree } from '../fixtures/uploads/upload-tree';
import {
  CHUNK_UPLOAD,
  chunkInfo,
  DIF_ASSEMBLE,
  TOKEN,
  UploadsServer,
} from '../protocol/uploads.support';
import { jsonResponse, MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 12 (gate token-safety): the upload paths that fail — a chunk
// 400 that echoes the token, a 403, a network error — never carry the token
// or the Authorization value into the result or the log.

let tree: UploadTree;
const server = new UploadsServer(() => tree.root);
beforeAll(() => {
  tree = uploadTree();
});
afterAll(() => tree.remove());
afterEach(() => server.close());

const AUTHORIZATION = `Bearer ${TOKEN}`;

function assemblingMock() {
  return new MockGlitchTip()
    .json('GET', CHUNK_UPLOAD, chunkInfo())
    .on('POST', DIF_ASSEMBLE, (request) => {
      const [checksum, spec] = Object.entries(JSON.parse(request.body))[0] as [
        string,
        { chunks: string[] },
      ];
      return jsonResponse({ [checksum]: { state: 'not_found', missingChunks: spec.chunks } });
    });
}

describe('no token in results or logs', () => {
  it.each([
    [
      'a chunk 400 echoing the token',
      () =>
        assemblingMock().on(
          'POST',
          CHUNK_UPLOAD,
          jsonResponse({ detail: `bad chunk for ${AUTHORIZATION}` }, 400),
        ),
      'GlitchTip rejected chunk 1 of 1',
    ],
    [
      'a 403 echoing the token',
      () =>
        new MockGlitchTip()
          .json('GET', CHUNK_UPLOAD, chunkInfo())
          .json('POST', DIF_ASSEMBLE, { detail: `denied ${TOKEN}` }, { status: 403 }),
      'lacks permission',
    ],
    // No route for the chunk POST: the mock fails it like a network error.
    ['a network error on a chunk', () => assemblingMock(), 'Could not reach'],
  ])('%s', async (_, mock, expected) => {
    const { text, isError, result } = await server.call(mock(), 'upload_debug_file', {
      project: 'app',
      path: 'app.sym',
    });
    expect(isError).toBe(true);
    expect(text).toContain(expected);
    const everything = `${JSON.stringify(result)}\n${server.logs()}`;
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(AUTHORIZATION);
  });
});
