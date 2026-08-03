import { ValidatedTransaction } from './transaction.entity';

export type RecordOutcome =
  | { kind: 'accepted'; transaction: ValidatedTransaction; fingerprint: string }
  | {
      kind: 'rejected';
      lineNumber: number;
      errorCode: string;
      message: string;
      rawValueTruncated: string;
    }
  | {
      kind: 'duplicate';
      lineNumber: number;
      errorCode: 'DUPLICATE' | 'CONTENT_MISMATCH';
      transactionId: string;
    };

export function classifyDuplicate(
  incomingFingerprint: string,
  storedFingerprint: string | null,
): 'DUPLICATE' | 'CONTENT_MISMATCH' {
  if (storedFingerprint === null) return 'DUPLICATE';
  return incomingFingerprint === storedFingerprint
    ? 'DUPLICATE'
    : 'CONTENT_MISMATCH';
}
