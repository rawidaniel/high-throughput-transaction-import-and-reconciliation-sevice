import {
  CreateImportInput,
  CreateImportResult,
  ImportRecord,
  ImportRepositoryPort,
  ImportStatus,
} from '../../../../src/application/ports/import-repository.port';

export class FakeImportRepository implements ImportRepositoryPort {
  private readonly importsById = new Map<string, ImportRecord>();
  private readonly importIdByIdempotencyKey = new Map<string, string>();

  async createOrReturnExisting(
    input: CreateImportInput,
  ): Promise<CreateImportResult> {
    const existingImportId = this.importIdByIdempotencyKey.get(
      input.idempotencyKey,
    );
    if (existingImportId) {
      return {
        importRecord: this.importsById.get(existingImportId)!,
        isNew: false,
      };
    }

    const record: ImportRecord = {
      id: input.id,
      status: 'PENDING',
      totalRecords: 0,
      processedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      startedAt: null,
      completedAt: null,
      failureReason: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };

    this.importsById.set(record.id, record);
    this.importIdByIdempotencyKey.set(input.idempotencyKey, record.id);

    return { importRecord: record, isNew: true };
  }

  async findById(id: string): Promise<ImportRecord | null> {
    return this.importsById.get(id) ?? null;
  }

  async requestCancellation(importId: string): Promise<ImportStatus> {
    const record = this.importsById.get(importId);
    if (!record) return 'FAILED';
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(record.status)) {
      return record.status;
    }
    record.status = 'CANCELLING';
    return 'CANCELLING';
  }
}
