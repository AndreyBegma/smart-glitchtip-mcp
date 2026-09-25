import { afterEach, describe, expect, it } from 'vitest';
import malformedNPlusOne from '../../fixtures/performance/malformed-n-plus-one.json';
import malformedSpanGroup from '../../fixtures/performance/malformed-span-group.json';
import malformedTransactionGroup from '../../fixtures/performance/malformed-transaction-group.json';
import malformedTrend from '../../fixtures/performance/malformed-trend.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 11: a partial/degraded GlitchTip response renders a text result with the gap
// marked, never "Internal error"; a structural break (wrong field type) is the `malformed`
// tool error naming the tool.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';
const MALFORMED = /^GlitchTip returned a response this server did not expect for/;

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'performance', GLITCHTIP_READ_ONLY: 'false' },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('list_transaction_groups — degraded', () => {
  it('renders a group with null method/throughput without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/transaction-groups/`, [
      malformedTransactionGroup,
    ]);
    const { text, isError } = await call(mock, 'list_transaction_groups', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('GET /api/x');
  });
});

describe('get_transaction_group — degraded', () => {
  it('renders a group with null method/throughput without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/transaction-groups/42/`,
      malformedTransactionGroup,
    );
    const { text, isError } = await call(mock, 'get_transaction_group', {
      organization: 'acme',
      transaction_group_id: 42,
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('GET /api/x');
  });
});

describe('get_transaction_group — structural break', () => {
  it('is a malformed tool error when the body is not an object', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/transaction-groups/42/`,
      null,
    );
    const { text, isError } = await call(mock, 'get_transaction_group', {
      organization: 'acme',
      transaction_group_id: 42,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('get_transaction_group');
  });
});

describe('list_span_groups — degraded', () => {
  it('renders a span group with a null description without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/span-groups/`, [
      malformedSpanGroup,
    ]);
    const { text, isError } = await call(mock, 'list_span_groups', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
  });
});

describe('list_span_groups — structural break', () => {
  it('is a malformed tool error when the body is not a list', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/span-groups/`, {
      oops: true,
    });
    const { text, isError } = await call(mock, 'list_span_groups', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('list_span_groups');
  });
});

describe('list_transaction_spans — degraded', () => {
  it('renders a span group with a null description without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/transaction-groups/42/spans/`,
      [malformedSpanGroup],
    );
    const { text, isError } = await call(mock, 'list_transaction_spans', {
      organization: 'acme',
      transaction_group_id: 42,
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
  });
});

describe('list_transaction_spans — structural break', () => {
  it('is a malformed tool error when the body is not a list', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/transaction-groups/42/spans/`,
      { oops: true },
    );
    const { text, isError } = await call(mock, 'list_transaction_spans', {
      organization: 'acme',
      transaction_group_id: 42,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('list_transaction_spans');
  });
});

describe('list_n_plus_one_patterns — degraded', () => {
  it('renders a pattern with a null transaction name without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/n-plus-one/`, [
      malformedNPlusOne,
    ]);
    const { text, isError } = await call(mock, 'list_n_plus_one_patterns', {
      organization: 'acme',
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
  });
});

describe('list_n_plus_one_patterns — structural break', () => {
  it('is a malformed tool error when the body is not a list', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/n-plus-one/`, {
      oops: true,
    });
    const { text, isError } = await call(mock, 'list_n_plus_one_patterns', {
      organization: 'acme',
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('list_n_plus_one_patterns');
  });
});

describe('get_transaction_trend — degraded', () => {
  it('renders a day with a null transactionCount as "-" without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/transaction-groups/42/trend/`,
      [malformedTrend],
    );
    const { text, isError } = await call(mock, 'get_transaction_trend', {
      organization: 'acme',
      transaction_group_id: 42,
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('-');
  });
});

describe('get_transaction_trend — structural break', () => {
  it('is a malformed tool error when the body is not a list', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/transaction-groups/42/trend/`,
      { oops: true },
    );
    const { text, isError } = await call(mock, 'get_transaction_trend', {
      organization: 'acme',
      transaction_group_id: 42,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('get_transaction_trend');
  });
});
