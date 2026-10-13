import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, inject, it } from 'vitest';

// Tests that run the compiled server as a real process (built once by the
// vitest globalSetup, never from dist/).

const main = inject('compiledMain');

/** Env with nothing inherited that could change the server's behaviour. */
function env(extra: Record<string, string>): Record<string, string> {
  return { PATH: process.env.PATH ?? '', NODE_ENV: 'production', ...extra };
}

/**
 * Runs the server with `stdin` written up front. stdin is closed (which stops
 * a stdio server) once `doneWhen` accepts stdout, or at once without it.
 */
function run(
  vars: Record<string, string>,
  stdin = '',
  doneWhen?: (stdout: string) => boolean,
  timeoutMs = 10_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [main], { env: env(vars) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (doneWhen?.(stdout)) child.stdin.end();
    });
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (doneWhen) child.stdin.write(stdin);
    else child.stdin.end(stdin);
  });
}

describe('startup (acceptance 7)', () => {
  it('exits 1 in http mode with an env token and no MCP_AUTH_TOKEN, naming the variable', async () => {
    const { code, stdout, stderr } = await run({
      MCP_TRANSPORT: 'http',
      GLITCHTIP_URL: 'https://glitchtip.test',
      GLITCHTIP_TOKEN: 'tok_SECRET_123',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('MCP_AUTH_TOKEN');
    expect(stderr).not.toContain('tok_SECRET_123');
    expect(stdout).toBe('');
  });

  it('prints one line per problem', async () => {
    const { code, stderr } = await run({ GLITCHTIP_TOOLSETS: 'bogus', MCP_HTTP_PORT: 'x' });
    expect(code).toBe(1);
    const lines = stderr.trim().split('\n');
    expect(lines.map((l) => l.split(':')[1]?.trim()).sort()).toEqual([
      'GLITCHTIP_TOOLSETS',
      'MCP_HTTP_PORT',
    ]);
  });
});

describe('stdio (acceptance 10)', () => {
  it('serves tools/list through StdioClientTransport', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [main],
      env: env({
        GLITCHTIP_URL: 'http://127.0.0.1:9',
        GLITCHTIP_TOKEN: 'tok_SECRET_123',
        GLITCHTIP_TOOLSETS: 'organizations',
      }),
      stderr: 'pipe',
    });
    const errors: Error[] = [];
    transport.onerror = (error) => void errors.push(error);
    const client = new Client({ name: 'stdio-test', version: '1' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('whoami');
      expect(errors).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('writes nothing but JSON-RPC frames to stdout, even while logging and failing', async () => {
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
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      // Port 9 (discard) is closed: an unreachable instance, with retries and warnings.
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_organizations', arguments: {} },
      },
    ];
    const { stdout, stderr } = await run(
      {
        GLITCHTIP_URL: 'http://127.0.0.1:9',
        GLITCHTIP_TOOLSETS: 'organizations',
        GLITCHTIP_TIMEOUT_MS: '500',
        LOG_LEVEL: 'trace',
      },
      `${frames.map((f) => JSON.stringify(f)).join('\n')}\n`,
      (out) => out.includes('"id":3'),
      15_000,
    );
    const lines = stdout.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const messages = lines.map((line) => JSON.parse(line) as { jsonrpc: string; id?: number });
    for (const message of messages) expect(message.jsonrpc).toBe('2.0');
    expect(messages.map((m) => m.id)).toEqual(expect.arrayContaining([1, 2, 3]));
    // The logs exist, and they went to stderr. (The "not yet available"
    // warning is covered in process: a spawned server cannot be handed a
    // registry with a pending toolset.)
    expect(stderr).toContain('GLITCHTIP_TOKEN is not set');
  });
});
