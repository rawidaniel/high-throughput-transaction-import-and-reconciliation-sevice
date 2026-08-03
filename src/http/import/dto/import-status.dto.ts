import { ImportRecord } from '../../../application/ports/import-repository.port';

export class ImportStatusDto {
  id!: string;
  status!: string;
  totalRecords!: number;
  processedCount!: number;
  acceptedCount!: number;
  rejectedCount!: number;
  duplicateCount!: number;
  startedAt!: string | null;
  completedAt!: string | null;
  failureReason!: string | null;

  static from(record: ImportRecord): ImportStatusDto {
    return {
      id: record.id,
      status: record.status,
      totalRecords: record.totalRecords,
      processedCount: record.processedCount,
      acceptedCount: record.acceptedCount,
      rejectedCount: record.rejectedCount,
      duplicateCount: record.duplicateCount,
      startedAt: record.startedAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      failureReason: record.failureReason,
    };
  }
}
