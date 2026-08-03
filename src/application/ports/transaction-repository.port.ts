import { ValidatedTransaction } from '../../domain/transaction/transaction.entity';
import { RiskLevel } from '../../domain/risk/compute-risk-score';

export interface ScoredTransaction {
  transaction: ValidatedTransaction;
  fingerprint: string;
  riskScore: number;
  riskLevel: RiskLevel;
}

export interface RejectedRecordInput {
  lineNumber: number;
  errorCode: string;
  message: string;
  rawValueTruncated: string;
}

export interface BatchPersistResult {
  insertedCount: number;
  duplicateCount: number;
  rejectedCount: number;
}

export interface PersistBatchInput {
  importId: string;
  scored: ScoredTransaction[];
  rejected: RejectedRecordInput[];
  processedDelta: number;
}

export interface TransactionRepositoryPort {
  persistBatch(input: PersistBatchInput): Promise<BatchPersistResult>;
  findFingerprints(
    keys: Array<{ provider: string; transactionId: string }>,
  ): Promise<Map<string, string>>;
}
