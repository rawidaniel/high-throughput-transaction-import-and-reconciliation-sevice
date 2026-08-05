import {
  validateTransaction,
  MAX_DESCRIPTION_LENGTH,
  ValidationErrorCode,
} from '../../../src/domain/transaction/validate-transaction';

const FALLBACK_PROVIDER = 'acme-bank';

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: 'txn-1',
    accountId: 'acc-1',
    merchantId: 'merch-1',
    amount: 100.5,
    currency: 'usd',
    timestamp: '2026-01-15T10:30:00Z',
    ...overrides,
  };
}

describe('validateTransaction — rejection table', () => {
  const cases: Array<{
    name: string;
    input: unknown;
    expected: ValidationErrorCode;
  }> = [
    { name: 'not an object', input: 'a string', expected: 'INVALID_TYPE' },
    { name: 'null', input: null, expected: 'INVALID_TYPE' },
    { name: 'an array', input: [], expected: 'INVALID_TYPE' },
    {
      name: 'missing transactionId',
      input: validRecord({ transactionId: undefined }),
      expected: 'MISSING_FIELD',
    },
    {
      name: 'blank transactionId',
      input: validRecord({ transactionId: '   ' }),
      expected: 'MISSING_FIELD',
    },
    {
      name: 'missing accountId',
      input: validRecord({ accountId: undefined }),
      expected: 'MISSING_FIELD',
    },
    {
      name: 'missing merchantId',
      input: validRecord({ merchantId: undefined }),
      expected: 'MISSING_FIELD',
    },
    {
      name: 'missing amount',
      input: validRecord({ amount: undefined }),
      expected: 'MISSING_FIELD',
    },
    {
      name: 'zero amount',
      input: validRecord({ amount: 0 }),
      expected: 'INVALID_AMOUNT',
    },
    {
      name: 'negative amount',
      input: validRecord({ amount: -5 }),
      expected: 'INVALID_AMOUNT',
    },
    {
      name: 'NaN amount',
      input: validRecord({ amount: NaN }),
      expected: 'INVALID_AMOUNT',
    },
    {
      name: 'Infinity amount',
      input: validRecord({ amount: Infinity }),
      expected: 'INVALID_AMOUNT',
    },
    {
      name: 'non-numeric string amount',
      input: validRecord({ amount: 'abc' }),
      expected: 'INVALID_AMOUNT',
    },
    {
      name: 'boolean amount',
      input: validRecord({ amount: true }),
      expected: 'INVALID_AMOUNT',
    },
    {
      name: 'missing currency',
      input: validRecord({ currency: undefined }),
      expected: 'MISSING_FIELD',
    },
    {
      name: 'two-letter currency',
      input: validRecord({ currency: 'US' }),
      expected: 'INVALID_CURRENCY',
    },
    {
      name: 'four-letter currency',
      input: validRecord({ currency: 'USDX' }),
      expected: 'INVALID_CURRENCY',
    },
    {
      name: 'numeric currency',
      input: validRecord({ currency: '840' }),
      expected: 'INVALID_CURRENCY',
    },
    {
      name: 'missing timestamp',
      input: validRecord({ timestamp: undefined }),
      expected: 'MISSING_FIELD',
    },
    {
      name: 'unparseable timestamp',
      input: validRecord({ timestamp: 'not-a-date' }),
      expected: 'INVALID_TIMESTAMP',
    },
    {
      name: 'out-of-range timestamp',
      input: validRecord({ timestamp: '1200-01-01T00:00:00Z' }),
      expected: 'INVALID_TIMESTAMP',
    },
    {
      name: 'description too long',
      input: validRecord({
        description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1),
      }),
      expected: 'DESCRIPTION_TOO_LONG',
    },
    {
      name: 'non-string description',
      input: validRecord({ description: 123 }),
      expected: 'INVALID_TYPE',
    },
  ];

  it.each(cases)('rejects $name with $expected', ({ input, expected }) => {
    const result = validateTransaction(input, FALLBACK_PROVIDER);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errorCode).toBe(expected);
  });
});

describe('validateTransaction — normalization', () => {
  it('trims whitespace from string identifiers', () => {
    const result = validateTransaction(
      validRecord({ transactionId: '  txn-1  ', accountId: ' acc-1 ' }),
      FALLBACK_PROVIDER,
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.transaction.transactionId).toBe('txn-1');
    expect(result.transaction.accountId).toBe('acc-1');
  });

  it('uppercases currency', () => {
    const result = validateTransaction(
      validRecord({ currency: 'usd' }),
      FALLBACK_PROVIDER,
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.transaction.currency).toBe('USD');
  });

  it('accepts a numeric string amount and rounds to 2dp', () => {
    const result = validateTransaction(
      validRecord({ amount: '10.999' }),
      FALLBACK_PROVIDER,
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.transaction.amount).toBe(11);
  });

  it('normalizes an offset timestamp to the same UTC instant', () => {
    const result = validateTransaction(
      validRecord({ timestamp: '2026-01-15T12:30:00+02:00' }),
      FALLBACK_PROVIDER,
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.transaction.timestamp.toISOString()).toBe(
      '2026-01-15T10:30:00.000Z',
    );
  });

  it('treats an empty description as null', () => {
    const result = validateTransaction(
      validRecord({ description: '   ' }),
      FALLBACK_PROVIDER,
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.transaction.description).toBeNull();
  });

  it('falls back to the import-level provider when the record has none', () => {
    const result = validateTransaction(validRecord(), FALLBACK_PROVIDER);
    if (!result.ok) throw new Error('expected success');
    expect(result.transaction.provider).toBe(FALLBACK_PROVIDER);
  });

  it('prefers a record-level provider over the fallback', () => {
    const result = validateTransaction(
      validRecord({ provider: 'other-bank' }),
      FALLBACK_PROVIDER,
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.transaction.provider).toBe('other-bank');
  });
});
