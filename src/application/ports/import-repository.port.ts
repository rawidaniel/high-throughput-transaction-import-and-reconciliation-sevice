export type ImportStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'CANCELLING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ImportRecord {
  id: string;
  status: ImportStatus;
  totalRecords: number;
  processedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateImportInput {
  id: string;
  createdAt: Date;
  idempotencyKey: string;
  file: {
    storagePath: string;
    size: number;
    checksum: string;
  };
}

export interface CreateImportResult {
  importRecord: ImportRecord;
  isNew: boolean;
}

export interface ImportRepositoryPort {
  createOrReturnExisting(input: CreateImportInput): Promise<CreateImportResult>;
  findById(id: string): Promise<ImportRecord | null>;
  requestCancellation(importId: string): Promise<ImportStatus>;
}
