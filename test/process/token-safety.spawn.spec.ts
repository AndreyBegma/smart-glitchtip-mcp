import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

// Acceptance 9 on real stderr and stdout: the compiled server as a process,
// a local stand-in GlitchTip that rejects the token and echoes it back, and
// the token must appear in neither stream.

const main = inject('compiledMain');
const TOKEN = 'tok_SECRET_123';

let glitchtip: Server;
let glitchtipUrl: string;
let child: ChildProcessWithoutNullStreams | undefined;

beforeEach(async () => {
  glitchtip = createServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: `Invalid token ${TOKEN} (Bearer ${TOKEN})` }));
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

async function until(check: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function assertClean(streams: Streams): void {
  for (const [name, text] of Object.entries(streams)) {
    expect(text, name).not.toContain(TOKEN);
  }
}

describe('token safety on real process streams', () => {
  it('stdio: an upstream 401 echoing the env token reaches neither stdout nor stderr', async () => {
    const streams = start({ GLITCHTIP_URL: glitchtipUrl, GLITCHTIP_TOKEN: TOKEN });
    const frames = [
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
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_organization', arguments: { organization: 'acme' } },
      },
    ];
    child?.stdin.write(`${frames.map((f) => JSON.stringify(f)).join('\n')}\n`);
    await until(() => streams.stdout.includes('"id":2'), 'the tools/call answer');
    expect(streams.stdout).toContain('The GlitchTip token was rejected (401)');
    expect(streams.stderr).toContain('MCP server on stdio');
    assertClean(streams);
  });

  it('http: pass-through token, credentials in X-GlitchTip-Url, upstream echo — all absent', async () => {
    const streams = start({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: '0',
      GLITCHTIP_URL: glitchtipUrl,
    });
    await until(() => /"url":"http:\/\/[^"]*:\d+"/.test(streams.stderr), 'the listening line');
    const port = /"url":"http:\/\/[^"]*:(\d+)"/.exec(streams.stderr)?.[1];
    const mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);

    const connect = async (headers: Record<string, string>) => {
      const client = new Client({ name: 't', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers } }));
      return client;
    };
    const passThrough = await connect({ authorization: `Bearer ${TOKEN}` });
    const rejected = await passThrough.callTool({
      name: 'get_organization',
      arguments: { organization: 'acme' },
    });
    const withUrl = await connect({
      authorization: `Bearer ${TOKEN}`,
      'x-glitchtip-url': `https://u:${TOKEN}@evil.test/?t=${TOKEN}`,
    });
    const refused = await withUrl.callTool({ name: 'list_organizations', arguments: {} });
    await Promise.all([passThrough.close(), withUrl.close()]);
    await until(() => streams.stderr.includes('request completed'), 'request log lines');

    expect(JSON.stringify(rejected)).toContain('The GlitchTip token was rejected (401)');
    expect(JSON.stringify(refused)).toContain('instance URL not allowed');
    expect(JSON.stringify([rejected, refused])).not.toContain(TOKEN);
    expect(streams.stderr).toContain('"x-glitchtip-url":"https://evil.test"');
    assertClean(streams);
  });
});
