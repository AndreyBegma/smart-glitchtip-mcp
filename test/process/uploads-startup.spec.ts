import { spawn } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { type UploadTree, uploadTree } from '../fixtures/uploads/upload-tree';
import { type BootedHttp, bootHttp } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 3 (D-22): the startup rules of the uploads toolset, on the
// compiled server as a real process, and `all` over real HTTP.

const main = inject('compiledMain');
const STDIO = { GLITCHTIP_URL: 'https://glitchtip.test', GLITCHTIP_TOKEN: 'tok_SECRET_123' };

let tree: UploadTree;
beforeAll(() => {
  tree = uploadTree();
});
afterAll(() => tree.remove());

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the server. It is stopped once `stopWhen` accepts stderr (a server
 * that started), or when it exits by itself (a refused configuration).
 */
function run(vars: Record<string, string>, stopWhen?: (stderr: string) => boolean): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [main], {
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production', ...vars },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stopWhen?.(stderr)) child.kill('SIGTERM');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('startup refusals', () => {
  it('uploads named explicitly with MCP_TRANSPORT=http exits 1 with the stdio-only message', async () => {
    const { code, stdout, stderr } = await run({
      MCP_TRANSPORT: 'http',
      GLITCHTIP_TOOLSETS: 'uploads',
      GLITCHTIP_UPLOAD_ROOT: tree.root,
    });
    expect(code).toBe(1);
    expect(stderr).toContain(
      'The uploads toolset reads local files and is available in stdio mode only (D-06). Remove it from GLITCHTIP_TOOLSETS.',
    );
    expect(stdout).toBe('');
  });

  it('uploads named explicitly in stdio without GLITCHTIP_UPLOAD_ROOT exits 1 naming the key', async () => {
    const { code, stderr } = await run({ ...STDIO, GLITCHTIP_TOOLSETS: 'uploads' });
    expect(code).toBe(1);
    expect(stderr).toContain(
      'GLITCHTIP_UPLOAD_ROOT: required when GLITCHTIP_TOOLSETS names uploads',
    );
  });

  it.each([
    ['does not exist', () => `${tree.root}/missing`],
    ['is not a directory', () => `${tree.root}/app.sym`],
    ['is /', () => '/'],
  ])('a root that %s exits 1', async (_, root) => {
    const { code, stderr } = await run({
      ...STDIO,
      GLITCHTIP_TOOLSETS: 'uploads',
      GLITCHTIP_UPLOAD_ROOT: root(),
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/GLITCHTIP_UPLOAD_ROOT: must/);
    expect(stderr).not.toContain(tree.root);
  });
});

describe('GLITCHTIP_TOOLSETS=all leaves uploads out, with a warning', () => {
  it('in stdio without a root', async () => {
    const { stderr } = await run({ ...STDIO, GLITCHTIP_TOOLSETS: 'all' }, (text) =>
      text.includes('MCP server on stdio'),
    );
    expect(stderr).toContain(
      'GLITCHTIP_TOOLSETS=all leaves out the uploads toolset: GLITCHTIP_UPLOAD_ROOT is not set.',
    );
    const started = stderr.split('\n').find((line) => line.includes('MCP server on stdio'));
    expect(started).toBeDefined();
    expect(started).not.toContain('"uploads"');
  });

  it('in http mode', async () => {
    const { stderr } = await run(
      {
        MCP_TRANSPORT: 'http',
        MCP_HTTP_PORT: '0',
        GLITCHTIP_TOOLSETS: 'all',
        GLITCHTIP_UPLOAD_ROOT: tree.root,
      },
      (text) => text.includes('MCP server on http'),
    );
    expect(stderr).toContain(
      'GLITCHTIP_TOOLSETS=all leaves out the uploads toolset: it reads local files and is available in stdio mode only (D-06).',
    );
  });
});

describe('tools/list over http with GLITCHTIP_TOOLSETS=all', () => {
  let server: BootedHttp | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('lists no uploads tool', async () => {
    server = await bootHttp(
      {
        GLITCHTIP_URL: 'https://glitchtip.test',
        GLITCHTIP_TOOLSETS: 'all',
        GLITCHTIP_UPLOAD_ROOT: tree.root,
        GLITCHTIP_READ_ONLY: 'false',
      },
      new MockGlitchTip(),
    );
    const client = await server.connect({ authorization: 'Bearer tok_CLIENT' });
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_projects');
    for (const name of [
      'get_chunk_upload_info',
      'list_debug_files',
      'upload_debug_file',
      'upload_proguard_mapping',
      'upload_artifact_bundle',
    ]) {
      expect(names).not.toContain(name);
    }
  });
});
