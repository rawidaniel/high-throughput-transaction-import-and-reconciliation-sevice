import {
  computeFingerprint,
  FINGERPRINT_VERSION,
} from '../../../../src/domain/transaction/compute-fingerprint';
import { ValidatedTransaction } from '../../../../src/domain/transaction/transaction.entity';

function txn(
  overrides: Partial<ValidatedTransaction> = {},
): ValidatedTransaction {
  return {
    provider: 'acme-bank',
    transactionId: 'txn-1',
    accountId: 'acc-1',
    merchantId: 'merch-1',
    amount: 100.5,
    currency: 'USD',
    timestamp: new Date('2026-01-15T10:30:00Z'),
    description: 'Coffee',
    ...overrides,
  };
}

describe('computeFingerprint', () => {
  it('is deterministic — identical input always yields identical output', () => {
    expect(computeFingerprint(txn())).toBe(computeFingerprint(txn()));
  });

  it('is prefixed with the algorithm version', () => {
    expect(
      computeFingerprint(txn()).startsWith(`${FINGERPRINT_VERSION}:`),
    ).toBe(true);
  });

  it('produces a stable, explicitly-pinned digest for a known input', () => {
    expect(computeFingerprint(txn())).toBe(
      'v1:14158c9d1e908b78e14d7f080b6743d58df40f0a8dbf760664bfdbc70dd1e469',
    );
  });

  it.each([
    ['provider', { provider: 'other-bank' }],
    ['transactionId', { transactionId: 'txn-2' }],
    ['accountId', { accountId: 'acc-2' }],
    ['merchantId', { merchantId: 'merch-2' }],
    ['amount', { amount: 100.51 }],
    ['currency', { currency: 'EUR' }],
    ['timestamp', { timestamp: new Date('2026-01-15T10:30:01Z') }],
  ])('changes when %s changes', (_field, override) => {
    expect(computeFingerprint(txn(override))).not.toBe(
      computeFingerprint(txn()),
    );
  });

  it('does NOT change when only the description changes', () => {
    expect(
      computeFingerprint(txn({ description: 'Completely different text' })),
    ).toBe(computeFingerprint(txn()));
  });

  it('treats equal amounts written differently as identical', () => {
    expect(computeFingerprint(txn({ amount: 100.5 }))).toBe(
      computeFingerprint(txn({ amount: 100.5 })),
    );
  });

  it('treats the same instant in different timezones as identical', () => {
    const utc = txn({ timestamp: new Date('2026-01-15T10:30:00Z') });
    const offset = txn({ timestamp: new Date('2026-01-15T12:30:00+02:00') });
    expect(computeFingerprint(offset)).toBe(computeFingerprint(utc));
  });
});
