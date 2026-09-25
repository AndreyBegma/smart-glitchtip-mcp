import { type ArgumentsHost, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config';
import { recordAuthGrant } from '../glitchtip/auth-grant';
import { GlitchTipError } from '../glitchtip/glitchtip.errors';
import { InstanceError } from '../glitchtip/instance.resolver';
import { ToolErrorFilter } from './tool-error.filter';

const ENV_TOKEN = 'tok_ENV_SECRET_1';
const MCP_SECRET = 'mcp-shared-secret-0123';
const CLIENT_TOKEN = 'tok_CLIENT_SECRET_2';

const filter = new ToolErrorFilter(
  loadConfig({
    MCP_TRANSPORT: 'http',
    GLITCHTIP_URL: 'https://g.test',
    GLITCHTIP_TOKEN: ENV_TOKEN,
    MCP_AUTH_TOKEN: MCP_SECRET,
  }),
);

/** An RPC host whose McpContext exposes a request the guard granted pass-through. */
function hostWithPassThrough(): ArgumentsHost {
  const raw = { headers: {} };
  recordAuthGrant(raw, { mode: 'passthrough', token: CLIENT_TOKEN });
  const context = { getRawRequest: () => raw };
  return { switchToRpc: () => ({ getContext: () => context }) } as unknown as ArgumentsHost;
}

async function rejection(exception: unknown, host = {} as ArgumentsHost): Promise<unknown> {
  try {
    await firstValueFrom(filter.catch(exception, host));
  } catch (error) {
    return error;
  }
  throw new Error('expected the filter to error');
}

function captureErrors(): string[] {
  const logged: string[] = [];
  vi.spyOn(Logger.prototype, 'error').mockImplementation(
    (...args: unknown[]) => void logged.push(JSON.stringify(args)),
  );
  return logged;
}

describe('ToolErrorFilter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes agent-facing messages through', async () => {
    expect(await rejection(new GlitchTipError('timeout', 'GlitchTip did not answer.'))).toEqual({
      status: 'error',
      message: 'GlitchTip did not answer.',
    });
    expect(await rejection(new InstanceError('instance URL not allowed: x'))).toEqual({
      status: 'error',
      message: 'instance URL not allowed: x',
    });
  });

  it('keeps an RpcException as mcp-nest expects it', async () => {
    expect(await rejection(new RpcException('explicit'))).toBe('explicit');
  });

  it('hides any other error behind an id, and logs it without bearer values', async () => {
    const logged = captureErrors();
    const result = (await rejection(new Error('invalid header value "Bearer tok_ANY_999"'))) as {
      message: string;
    };
    expect(result.message).toMatch(/^Internal error in smart-glitchtip-mcp \([0-9a-f-]{36}\)\.$/);
    expect(logged.join('\n')).toContain('invalid header value');
    expect(logged.join('\n')).not.toContain('tok_ANY_999');
  });

  it('strips the env token, MCP_AUTH_TOKEN and the pass-through token from the log', async () => {
    const logged = captureErrors();
    const error = new Error(`raw ${ENV_TOKEN} and ${MCP_SECRET} and ${CLIENT_TOKEN}`);
    const result = (await rejection(error, hostWithPassThrough())) as { message: string };
    const text = `${logged.join('\n')}\n${result.message}`;
    expect(logged.join('\n')).toContain('raw [redacted] and [redacted] and [redacted]');
    for (const secret of [ENV_TOKEN, MCP_SECRET, CLIENT_TOKEN]) expect(text).not.toContain(secret);
  });
});
