import { ImportRecord } from '../../../application/ports/import-repository.port';

export class CreateImportResponseDto {
  id!: string;
  status!: string;
  createdAt!: string;

  static from(record: ImportRecord): CreateImportResponseDto {
    return {
      id: record.id,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
