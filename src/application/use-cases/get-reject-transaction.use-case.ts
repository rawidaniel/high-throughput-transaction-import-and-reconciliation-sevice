import { Inject, Injectable } from '@nestjs/common';
import { IMPORT_QUERY, IMPORT_REPOSITORY } from '../ports/tokens';
import {
  type ImportQueryPort,
  RejectedRecordPage,
} from '../ports/import-query.port';
import { type ImportRepositoryPort } from '../ports/import-repository.port';
import { ImportNotFoundError } from '../../domain/domain-errors';

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class GetRejectedRecordsUseCase {
  constructor(
    @Inject(IMPORT_QUERY) private readonly importQuery: ImportQueryPort,
    @Inject(IMPORT_REPOSITORY)
    private readonly importRepository: ImportRepositoryPort,
  ) {}

  async execute(
    importId: string,
    cursor: string | null,
    requestedLimit: number | undefined,
  ): Promise<RejectedRecordPage> {
    const record = await this.importRepository.findById(importId);
    if (!record) throw new ImportNotFoundError(importId);

    const limit = clampLimit(requestedLimit);
    return this.importQuery.getRejectedRecords(importId, cursor, limit);
  }
}

function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested))
    return DEFAULT_PAGE_SIZE;
  if (requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}
