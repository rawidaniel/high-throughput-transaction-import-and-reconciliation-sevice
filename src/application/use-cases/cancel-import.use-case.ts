import { Inject, Injectable } from '@nestjs/common';
import { IMPORT_REPOSITORY } from '../ports/tokens';
import {
  type ImportRepositoryPort,
  ImportStatus,
} from '../ports/import-repository.port';
import { ImportAlreadyFinishedError } from 'src/domain/domain-errors';

@Injectable()
export class CancelImportUseCase {
  constructor(
    @Inject(IMPORT_REPOSITORY)
    private readonly importRepository: ImportRepositoryPort,
  ) {}

  async execute(importId: string): Promise<{ status: ImportStatus }> {
    const status = await this.importRepository.requestCancellation(importId);

    if (status !== 'CANCELLING') {
      throw new ImportAlreadyFinishedError(importId, status);
    }

    return { status };
  }
}
