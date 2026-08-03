import { createHash } from 'node:crypto';
import { ValidatedTransaction } from './transaction.entity';

export const FINGERPRINT_VERSION = 'v1';

const FINGERPRINT_FIELDS = [
  'provider',
  'transactionId',
  'accountId',
  'merchantId',
  'amount',
  'currency',
  'timestamp',
] as const;

const DELIMITER = '|';

export function computeFingerprint(transaction: ValidatedTransaction): string {
  const canonicalParts = FINGERPRINT_FIELDS.map((field) => {
    switch (field) {
      case 'amount':
        return transaction.amount.toFixed(2);
      case 'timestamp':
        return transaction.timestamp.toISOString();
      default:
        return transaction[field];
    }
  });

  const canonicalString = canonicalParts.join(DELIMITER);
  const digest = createHash('sha256')
    .update(canonicalString, 'utf8')
    .digest('hex');

  return `${FINGERPRINT_VERSION}:${digest}`;
}
