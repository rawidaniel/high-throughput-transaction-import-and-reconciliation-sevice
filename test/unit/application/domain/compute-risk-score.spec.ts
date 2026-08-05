import { computeRiskScore } from '../../../../src/domain/risk/compute-risk-score';
import { ValidatedTransaction } from '../../../../src/domain/transaction/transaction.entity';

function txn(
  overrides: Partial<ValidatedTransaction> = {},
): ValidatedTransaction {
  return {
    provider: 'acme-bank',
    transactionId: 'txn-1',
    accountId: 'acc-1',
    merchantId: 'merch-1',
    amount: 100,
    currency: 'USD',
    timestamp: new Date('2026-01-15T14:00:00Z'),
    description: 'Regular coffee shop purchase downtown',
    ...overrides,
  };
}

const FP = 'v1:abc123';

describe('computeRiskScore', () => {
  it('is deterministic — identical input always yields identical output', () => {
    const a = computeRiskScore(txn(), FP);
    const b = computeRiskScore(txn(), FP);
    expect(a).toEqual(b);
  });

  it('always produces a score within 0–100', () => {
    const cases = [
      txn({ amount: 0.01 }),
      txn({ amount: 1_000_000 }),
      txn({ description: null }),
      txn({ description: '' }),
      txn({ timestamp: new Date('2026-01-15T02:00:00Z') }),
      txn({ timestamp: new Date('2026-01-15T23:59:59Z') }),
    ];
    for (const t of cases) {
      const { score } = computeRiskScore(t, FP);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('assigns a level consistent with the score bands', () => {
    const { score, level } = computeRiskScore(txn(), FP);
    const expected = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    expect(level).toBe(expected);
  });

  it('scores a larger amount higher, all else equal', () => {
    const small = computeRiskScore(txn({ amount: 10 }), FP).score;
    const large = computeRiskScore(txn({ amount: 9_000 }), FP).score;
    expect(large).toBeGreaterThan(small);
  });

  it('saturates the amount signal — beyond the cap, more money adds nothing', () => {
    const atCap = computeRiskScore(txn({ amount: 10_000 }), FP).score;
    const wayOver = computeRiskScore(txn({ amount: 5_000_000 }), FP).score;
    expect(wayOver).toBe(atCap);
  });

  it('scores a night-time transaction higher than a mid-afternoon one', () => {
    const night = computeRiskScore(
      txn({ timestamp: new Date('2026-01-15T02:00:00Z') }),
      FP,
    ).score;
    const afternoon = computeRiskScore(
      txn({ timestamp: new Date('2026-01-15T14:00:00Z') }),
      FP,
    ).score;
    expect(night).toBeGreaterThan(afternoon);
  });

  it('scores a missing description higher than a detailed one', () => {
    const missing = computeRiskScore(txn({ description: null }), FP).score;
    const detailed = computeRiskScore(
      txn({ description: 'A'.repeat(60) }),
      FP,
    ).score;
    expect(missing).toBeGreaterThan(detailed);
  });

  it('places the same merchant in the same bucket every time', () => {
    const a = computeRiskScore(
      txn({ merchantId: 'stable-merchant' }),
      FP,
    ).score;
    const b = computeRiskScore(
      txn({ merchantId: 'stable-merchant' }),
      FP,
    ).score;
    expect(a).toBe(b);
  });

  it('produces different scores for different fingerprints (entropy signal is live)', () => {
    const a = computeRiskScore(txn(), 'v1:aaaa').score;
    const b = computeRiskScore(txn(), 'v1:bbbb').score;
    expect(a).not.toBe(b);
  });
});
