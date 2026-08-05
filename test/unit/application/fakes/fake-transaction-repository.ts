import {
  BatchPersistResult,
  PersistBatchInput,
  TransactionRepositoryPort,
} from '../../../../src/application/ports/transaction-repository.port';

export class FakeTransactionRepository implements TransactionRepositoryPort {
  public calls: PersistBatchInput[] = [];
  public duplicatesPerBatch = 0;
  public shouldThrow: Error | null = null;

  async persistBatch(input: PersistBatchInput): Promise<BatchPersistResult> {
    if (this.shouldThrow) throw this.shouldThrow;

    this.calls.push(input);
    const duplicateCount = Math.min(
      this.duplicatesPerBatch,
      input.scored.length,
    );

    return {
      insertedCount: input.scored.length - duplicateCount,
      duplicateCount,
      rejectedCount: input.rejected.length,
    };
  }

  async findFingerprints(): Promise<Map<string, string>> {
    return new Map();
  }

  get totalPersisted(): number {
    return this.calls.reduce((sum, c) => sum + c.scored.length, 0);
  }

  get totalRejected(): number {
    return this.calls.reduce((sum, c) => sum + c.rejected.length, 0);
  }

  get totalProcessedDelta(): number {
    return this.calls.reduce((sum, c) => sum + c.processedDelta, 0);
  }
}
