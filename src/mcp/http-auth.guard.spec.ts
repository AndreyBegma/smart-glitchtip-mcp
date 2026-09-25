import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config';
import { authGrantOf } from '../glitchtip/auth-grant';
import { HttpAuthGuard } from './http-auth.guard';

function context(authorization?: string) {
  const request = { headers: authorization === undefined ? {} : { authorization } };
  const responseHeaders: Record<string, string> = {};
  const response = { setHeader: (name: string, value: string) => (responseHeaders[name] = value) };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { ctx, request, responseHeaders };
}

const guard = (authToken?: string) =>
  new HttpAuthGuard(
    loadConfig({ MCP_TRANSPORT: 'http', ...(authToken ? { MCP_AUTH_TOKEN: authToken } : {}) }),
  );

describe('HttpAuthGuard', () => {
  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer  '])(
    'answers 401 with WWW-Authenticate for %j',
    (authorization) => {
      const { ctx, responseHeaders } = context(authorization);
      expect(() => guard('shared').canActivate(ctx)).toThrow(UnauthorizedException);
      expect(responseHeaders['WWW-Authenticate']).toBe('Bearer');
    },
  );

  it('grants server mode for MCP_AUTH_TOKEN', () => {
    const { ctx, request } = context('Bearer shared');
    expect(guard('shared').canActivate(ctx)).toBe(true);
    expect(authGrantOf(request)).toEqual({ mode: 'server' });
  });

  it('treats any other bearer as a GlitchTip token to pass through', () => {
    const { ctx, request } = context('Bearer glitchtip-token');
    guard('shared').canActivate(ctx);
    expect(authGrantOf(request)).toEqual({ mode: 'passthrough', token: 'glitchtip-token' });
  });

  it('never grants server mode when MCP_AUTH_TOKEN is unset', () => {
    const { ctx, request } = context('Bearer anything');
    guard().canActivate(ctx);
    expect(authGrantOf(request)).toMatchObject({ mode: 'passthrough' });
  });

  it('keeps the grant off the request object', () => {
    const { ctx, request } = context('Bearer glitchtip-token');
    guard('shared').canActivate(ctx);
    expect(JSON.stringify(request)).not.toContain('passthrough');
  });
});
