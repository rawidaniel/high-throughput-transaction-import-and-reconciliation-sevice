import { Inject, Injectable } from '@nestjs/common';
import {
  ImportRecord,
  type ImportRepositoryPort,
} from '../ports/import-repository.port';
import { IMPORT_REPOSITORY } from '../ports/tokens';
import { ImportNotFoundError } from '../../domain/domain-errors';

@Injectable()
export class GetImportStatusUseCase {
  constructor(
    @Inject(IMPORT_REPOSITORY)
    private readonly importRepository: ImportRepositoryPort,
  ) {}

  async execute(importId: string): Promise<ImportRecord> {
    const record = await this.importRepository.findById(importId);

    if (!record) {
      throw new ImportNotFoundError(importId);
    }
    return record;
  }
}
