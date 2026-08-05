import { Inject, Injectable } from '@nestjs/common';
import { ImportAlreadyFinishedError } from '../../domain/domain-errors';
import {
  type ImportRepositoryPort,
  ImportStatus,
} from '../ports/import-repository.port';
import { type LoggerPort } from '../ports/logger.port';
import { IMPORT_REPOSITORY, LOGGER } from '../ports/tokens';

@Injectable()
export class CancelImportUseCase {
  constructor(
    @Inject(IMPORT_REPOSITORY)
    private readonly importRepository: ImportRepositoryPort,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  async execute(importId: string): Promise<{ status: ImportStatus }> {
    const status = await this.importRepository.requestCancellation(importId);

    if (status !== 'CANCELLING') {
      throw new ImportAlreadyFinishedError(importId, status);
    }

    this.logger.info('Cancellation requested', { importId });
    return { status };
  }
}
