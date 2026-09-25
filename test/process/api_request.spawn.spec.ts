import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

// Acceptance 2 (fourth case) and 5 on real process streams: the compiled server
// logs the GLITCHTIP_API_REQUEST_ALLOW_WRITE warning to stderr, and with the
// token echoed back by every error kind, neither stdout nor stderr carries it.

const main = inject('compiledMain');
const TOKEN = 'tok_SECRET_123';

/** Path below /api/0/ → the status the stand-in GlitchTip answers with. */
const STATUSES: Record<string, number> = {
  ok: 200,
  bad: 400,
  unauth: 401,
  forbidden: 403,
  missing: 404,
  limited: 429,
  broken: 500,
  moved: 302,
};

let glitchtip: Server;
let glitchtipUrl: string;
let child: ChildProcessWithoutNullStreams | undefined;

beforeEach(async () => {
  glitchtip = createServer((req, res) => {
    const name = /^\/api\/0\/([a-z]+)\//.exec(req.url ?? '')?.[1] ?? '';
    const status = STATUSES[name] ?? 404;
    res.writeHead(status, {
      'content-type': 'application/json',
      location: `https://x.test/?t=${TOKEN}`,
      'retry-after': '0',
    });
    res.end(JSON.stringify({ detail: `echo ${TOKEN}`, auth: { token: TOKEN }, secret: TOKEN }));
  });
  await new Promise<void>((resolve) => glitchtip.listen(0, '127.0.0.1', resolve));
  glitchtipUrl = `http://127.0.0.1:${(glitchtip.address() as AddressInfo).port}`;
});

afterEach(async () => {
  child?.kill('SIGTERM');
  child = undefined;
  await new Promise((resolve) => glitchtip.close(resolve));
});

interface Streams {
  stdout: string;
  stderr: string;
}

function start(vars: Record<string, string>): Streams {
  const streams: Streams = { stdout: '', stderr: '' };
  child = spawn(process.execPath, [main], {
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production', LOG_LEVEL: 'trace', ...vars },
  });
  child.stdout.on('data', (chunk) => (streams.stdout += chunk));
  child.stderr.on('data', (chunk) => (streams.stderr += chunk));
  return streams;
}

async function until(check: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const INITIALIZE = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
];

describe('api_request on real process streams', () => {
  it('logs the no-effect warning to stderr when read-only with the flag set', async () => {
    const streams = start({
      GLITCHTIP_URL: glitchtipUrl,
      GLITCHTIP_TOKEN: TOKEN,
      GLITCHTIP_TOOLSETS: 'api_request',
      GLITCHTIP_API_REQUEST_ALLOW_WRITE: 'true',
    });
    await until(() => streams.stderr.includes('MCP server on stdio'), 'startup');
    expect(streams.stderr).toContain(
      'GLITCHTIP_API_REQUEST_ALLOW_WRITE has no effect while read-only',
    );
    expect(streams.stdout).toBe('');
  });

  it('keeps the token off stdout and stderr for every error kind', async () => {
    const streams = start({
      GLITCHTIP_URL: glitchtipUrl,
      GLITCHTIP_TOKEN: TOKEN,
      GLITCHTIP_TOOLSETS: 'api_request',
      GLITCHTIP_READ_ONLY: 'false',
      GLITCHTIP_API_REQUEST_ALLOW_WRITE: 'true',
    });
    const names = Object.keys(STATUSES);
    const calls = names.map((name, i) => ({
      jsonrpc: '2.0',
      id: 10 + i,
      method: 'tools/call',
      params:
        i % 2 === 0
          ? { name: 'api_get', arguments: { path: name } }
          : {
              name: 'api_request',
              arguments: { method: 'POST', path: name, confirm: `POST /api/0/${name}/` },
            },
    }));
    child?.stdin.write(`${[...INITIALIZE, ...calls].map((f) => JSON.stringify(f)).join('\n')}\n`);
    const lastId = 10 + names.length - 1;
    await until(
      () => calls.every((c) => streams.stdout.includes(`"id":${c.id}`)),
      `answers up to id ${lastId}`,
      30_000,
    );
    expect(streams.stdout).toContain('[redacted]');
    expect(streams.stdout).toContain('The GlitchTip token was rejected (401)');
    for (const [name, text] of Object.entries(streams)) {
      expect(text, name).not.toContain(TOKEN);
    }
  });
});
