import { Injectable } from '@nestjs/common';
import {
  ImportFileLocation,
  ImportFileRepositoryPort,
} from '../../application/ports/import-file-repository.port';
import { wrapDatabaseError } from '../../domain/domain-errors';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ImportFileRepository implements ImportFileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByImportId(importId: string): Promise<ImportFileLocation | null> {
    try {
      const file = await this.prisma.importFile.findFirst({
        where: { importId },
        orderBy: { createdAt: 'asc' },
        include: { import: { select: { provider: true } } },
      });

      if (!file) return null;

      return {
        storagePath: file.storagePath,
        provider: file.import.provider,
      };
    } catch (err) {
      throw wrapDatabaseError(err, 'ImportFileRepository.findByImportId');
    }
  }
}
