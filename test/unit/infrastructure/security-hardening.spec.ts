import {
  sanitizeForLog,
  sanitizeLogContext,
} from '../../../src/infrastructure/system/log-sanitizer';
import { validateTransaction } from '../../../src/domain/transaction/validate-transaction';
import {
  parseNdjsonLine,
  MAX_LINE_BYTES,
} from '../../../src/domain/transaction/parse-ndjson-line';

describe('Log injection defence', () => {
  it('escapes newlines so a forged log entry cannot be injected', () => {
    const attack =
      'Coffee\n2026-01-01 INFO [auth] user admin logged in successfully';
    const safe = sanitizeForLog(attack);

    expect(safe).not.toContain('\n');
    expect(safe).toContain('\\n');
  });

  it('escapes carriage returns and tabs', () => {
    expect(sanitizeForLog('a\rb\tc')).toBe('a\\rb\\tc');
    expect(sanitizeForLog('a\r\nb')).toBe('a\\r\\nb');
  });

  it('strips ANSI escape sequences that would execute in a terminal', () => {
    const safe = sanitizeForLog('normal\x1b[2J\x1b[1;31mFAKE ERROR');
    expect(safe).not.toContain('\x1b');
  });

  it('strips null bytes and other control characters', () => {
    const safe = sanitizeForLog('before\x00\x07\x1fafter');
    expect(safe).toBe('beforeafter');
  });

  it('truncates absurdly long values so one field cannot flood the log pipeline', () => {
    const safe = sanitizeForLog('x'.repeat(10_000));
    expect(safe.length).toBeLessThan(300);
    expect(safe).toContain('truncated');
  });

  it('sanitizes every string in a context object', () => {
    const clean = sanitizeLogContext({
      importId: 'abc',
      message: 'evil\nINFO forged entry',
      count: 42,
    });

    expect(clean?.message).not.toContain('\n');
    expect(clean?.count).toBe(42);
  });

  it('never throws on unserializable input', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => sanitizeForLog(circular)).not.toThrow();
  });
});

describe('Untrusted client input — identifiers', () => {
  const base = {
    transactionId: 'txn-1',
    accountId: 'acc-1',
    merchantId: 'merch-1',
    amount: 100,
    currency: 'USD',
    timestamp: '2026-01-15T10:30:00Z',
  };

  it('rejects an absurdly long identifier', () => {
    const result = validateTransaction(
      { ...base, transactionId: 'x'.repeat(5000) },
      'p',
    );
    expect(result.ok).toBe(false);
  });

  it('strips control characters from identifiers rather than storing them', () => {
    const result = validateTransaction(
      { ...base, transactionId: 'txn\x00\x1b[31m-1' },
      'p',
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.transaction.transactionId).toBe('txn[31m-1');
    expect(result.transaction.transactionId).not.toContain('\x00');
  });

  it('drops unexpected fields entirely', () => {
    const result = validateTransaction(
      {
        ...base,
        isAdmin: true,
        injectedField: 'evil',
        __proto__: { polluted: true },
      },
      'p',
    );
    if (!result.ok) throw new Error('expected success');

    expect(result.transaction).not.toHaveProperty('isAdmin');
    expect(result.transaction).not.toHaveProperty('injectedField');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not trust client timestamps — rejects implausible values', () => {
    expect(
      validateTransaction({ ...base, timestamp: '1200-01-01T00:00:00Z' }, 'p')
        .ok,
    ).toBe(false);
    expect(
      validateTransaction({ ...base, timestamp: '9999-01-01T00:00:00Z' }, 'p')
        .ok,
    ).toBe(false);
    expect(
      validateTransaction({ ...base, timestamp: 'not-a-date' }, 'p').ok,
    ).toBe(false);
  });

  it('does not trust client amounts — rejects non-finite and negative values', () => {
    for (const amount of [NaN, Infinity, -Infinity, -1, 0, '1e999']) {
      expect(validateTransaction({ ...base, amount }, 'p').ok).toBe(false);
    }
  });
});

describe('Malformed input resilience', () => {
  it('never throws on malformed JSON — returns a rejection instead', () => {
    for (const line of [
      '{unclosed',
      '[[[',
      'null',
      'undefined',
      '{"a":}',
      '\x00\x01',
    ]) {
      expect(() => parseNdjsonLine(line, 1)).not.toThrow();
    }
  });

  it('rejects an extremely long line without reading it into a transaction', () => {
    const result = parseNdjsonLine('x'.repeat(MAX_LINE_BYTES + 1000), 1);
    expect(result).toMatchObject({
      kind: 'rejected',
      errorCode: 'LINE_TOO_LONG',
    });
  });

  it('caps the stored raw value on rejection so one line cannot bloat storage', () => {
    const result = parseNdjsonLine('y'.repeat(MAX_LINE_BYTES + 5000), 1);
    if (result.kind !== 'rejected') throw new Error('expected rejection');
    expect(result.rawValueTruncated.length).toBeLessThanOrEqual(200);
  });

  it('handles deeply nested JSON without stack overflow', () => {
    const deep = '['.repeat(2000) + ']'.repeat(2000);
    expect(() => parseNdjsonLine(deep, 1)).not.toThrow();
  });
});
