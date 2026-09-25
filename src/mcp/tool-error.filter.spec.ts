import { type ArgumentsHost, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { GlitchTipError } from '../glitchtip/glitchtip.errors';
import { InstanceError } from '../glitchtip/instance.resolver';
import { ToolErrorFilter } from './tool-error.filter';

async function rejection(exception: unknown): Promise<unknown> {
  const filter = new ToolErrorFilter();
  try {
    await firstValueFrom(filter.catch(exception, {} as ArgumentsHost));
  } catch (error) {
    return error;
  }
  throw new Error('expected the filter to error');
}

describe('ToolErrorFilter', () => {
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
    const logged: string[] = [];
    const spy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args)));
    try {
      const result = (await rejection(
        new Error('invalid header value "Bearer tok_SECRET_123"'),
      )) as { message: string };
      expect(result.message).toMatch(/^Internal error in smart-glitchtip-mcp \([0-9a-f-]{36}\)\.$/);
      expect(result.message).not.toContain('tok_SECRET_123');
      expect(logged.join('\n')).toContain('invalid header value');
      expect(logged.join('\n')).not.toContain('tok_SECRET_123');
    } finally {
      spy.mockRestore();
    }
  });
});
