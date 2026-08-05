import { Inject, Injectable } from '@nestjs/common';
import { ImportNotFoundError } from '../../domain/domain-errors';
import {
  ImportSummary,
  type ImportQueryPort,
} from '../ports/import-query.port';
import { type ImportRepositoryPort } from '../ports/import-repository.port';
import { IMPORT_QUERY, IMPORT_REPOSITORY } from '../ports/tokens';

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class GetImportSummaryUseCase {
  constructor(
    @Inject(IMPORT_QUERY) private readonly importQuery: ImportQueryPort,
    @Inject(IMPORT_REPOSITORY)
    private readonly importRepository: ImportRepositoryPort,
  ) {}

  async execute(importId: string): Promise<ImportSummary> {
    const record = await this.importRepository.findById(importId);
    if (!record) throw new ImportNotFoundError(importId);

    return this.importQuery.getSummary(importId);
  }
}
