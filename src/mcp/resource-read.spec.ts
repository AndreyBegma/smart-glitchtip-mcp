import { RpcException } from '@nestjs/microservices';
import { describe, expect, it } from 'vitest';
import { MalformedViewError } from '../format/tool-output';
import { GlitchTipError } from '../glitchtip/glitchtip.errors';
import {
  type GlitchTipConnection,
  NoDefaultOrganizationError,
} from '../glitchtip/instance.resolver';
import { Redactor } from '../glitchtip/redactor';
import {
  canonicalUri,
  echoUri,
  notFoundAsInvalidParams,
  readText,
  resolveResourceOrganization,
  resourceIssueId,
  resourceOrganization,
  scrubResponse,
} from './resource-read';

const TOKEN = 'tok_UNIT_secret';

function connection(organization: GlitchTipConnection['organization'] = async () => 'acme') {
  return {
    instance: { redactor: () => new Redactor(TOKEN) },
    organization,
  } as unknown as GlitchTipConnection;
}

function rpcError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RpcException);
    return (error as RpcException).getError();
  }
  throw new Error('expected a throw');
}

describe('canonicalUri', () => {
  it('accepts a lowercase glitchtip:// URI, with or without a query', () => {
    expect(canonicalUri({ uri: 'glitchtip://issues/42' })).toBe('glitchtip://issues/42');
    expect(canonicalUri({ uri: 'glitchtip://issues/42?organization=a' })).toBe(
      'glitchtip://issues/42?organization=a',
    );
  });

  it.each(['https://issues/42', 'GLITCHTIP://issues/42', 'glitchtip://issues/42/'])(
    'refuses %s as an unknown resource',
    (uri) => {
      expect(rpcError(() => canonicalUri({ uri }))).toEqual({
        code: -32602,
        message: `Unknown resource: ${uri}`,
      });
    },
  );
});

describe('echoUri', () => {
  it('flattens line breaks and control characters to single spaces', () => {
    expect(echoUri('a\r\nb\tc\u0000d')).toBe('a b c d');
  });

  it('caps at 200 characters, ending with an ellipsis', () => {
    const echoed = echoUri('x'.repeat(500));
    expect(echoed).toHaveLength(200);
    expect(echoed.endsWith('…')).toBe(true);
  });
});

describe('parameters', () => {
  it.each(['1', '42', '9007199254740991'])('issue_id %s is accepted', (value) => {
    expect(resourceIssueId(value)).toBe(Number(value));
  });

  it.each(['0', '-1', '01', '1.5', 'abc', '9007199254740993', '99999999999999999999', undefined])(
    'issue_id %s is -32602',
    (value) => {
      expect(rpcError(() => resourceIssueId(value))).toMatchObject({ code: -32602 });
    },
  );

  it('organization is optional, and must be a slug when present', () => {
    expect(resourceOrganization(undefined)).toBeUndefined();
    expect(resourceOrganization('acme_1-x')).toBe('acme_1-x');
    expect(rpcError(() => resourceOrganization('a/b'))).toMatchObject({ code: -32602 });
    expect(rpcError(() => resourceOrganization(''))).toMatchObject({ code: -32602 });
  });
});

describe('resolveResourceOrganization', () => {
  it('says how to name an organization in the URI when there is no default', async () => {
    const glitchtip = connection(async () => {
      throw new NoDefaultOrganizationError(['one', 'two'], false);
    });
    await expect(resolveResourceOrganization(glitchtip, undefined)).rejects.toSatisfy(
      (error: RpcException) =>
        (error.getError() as { code: number; message: string }).code === -32602 &&
        (error.getError() as { message: string }).message.endsWith(
          'For a resource, add ?organization=<slug> to the URI.',
        ),
    );
  });
});

describe('notFoundAsInvalidParams', () => {
  it('turns a 404 into -32602 with the URI as data', async () => {
    const call = Promise.reject(new GlitchTipError('not_found', 'Issue 1 was not found', 404));
    await expect(notFoundAsInvalidParams(call, 'glitchtip://issues/1', 'gone')).rejects.toSatisfy(
      (error: RpcException) =>
        JSON.stringify(error.getError()) ===
        JSON.stringify({ code: -32602, message: 'gone', data: { uri: 'glitchtip://issues/1' } }),
    );
  });

  it('lets every other failure through unchanged', async () => {
    const forbidden = new GlitchTipError('forbidden', 'no', 403);
    await expect(notFoundAsInvalidParams(Promise.reject(forbidden), 'u')).rejects.toBe(forbidden);
  });
});

describe('scrubResponse', () => {
  it('removes the token from every string, keeping the shape', () => {
    const response = {
      title: `a ${TOKEN} b`,
      nested: [{ value: TOKEN }, 7, null],
      [`key ${TOKEN}`]: true,
    };
    const scrubbed = scrubResponse(response, connection());
    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed.title).toBe('a [redacted] b');
    expect(scrubbed.nested).toEqual([{ value: '[redacted]' }, 7, null]);
  });

  it('removes a token whose JSON form is escaped, and stays valid JSON', () => {
    const token = 'tok_"quoted"\\secret';
    const glitchtip = {
      instance: { redactor: () => new Redactor(token) },
    } as unknown as GlitchTipConnection;
    const scrubbed = scrubResponse({ title: `x ${token} y` }, glitchtip);
    expect(scrubbed.title).toBe('x [redacted] y');
  });

  it('passes a response with no JSON form through', () => {
    expect(scrubResponse(undefined, connection())).toBeUndefined();
  });
});

describe('readText', () => {
  const options = { budget: 1_000, operation: 'get_issue (resource x)', glitchtip: connection() };

  it('returns one text/plain item echoing the URI', () => {
    expect(readText('glitchtip://issues/1', () => 'body', options)).toEqual({
      contents: [{ uri: 'glitchtip://issues/1', mimeType: 'text/plain', text: 'body' }],
    });
  });

  it('scrubs the connection token from the text', () => {
    const { contents } = readText('u', () => `a ${TOKEN} b`, options);
    expect(JSON.stringify(contents)).not.toContain(TOKEN);
  });

  it('bounds the text by the budget', () => {
    const { contents } = readText('u', () => 'line\n'.repeat(1_000), options);
    const [item] = contents;
    expect('text' in item && item.text.length).toBeLessThanOrEqual(1_000);
  });

  it('wraps a shape error as MalformedViewError naming the operation', () => {
    const render = () => {
      throw new TypeError('x.replace is not a function');
    };
    expect(() => readText('u', render, options)).toThrow(MalformedViewError);
    try {
      readText('u', render, options);
    } catch (error) {
      expect((error as MalformedViewError).operation).toBe('get_issue (resource x)');
    }
  });

  it('lets any other error through', () => {
    const boom = new Error('boom');
    expect(() =>
      readText(
        'u',
        () => {
          throw boom;
        },
        options,
      ),
    ).toThrow(boom);
  });
});
