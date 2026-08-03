import { Injectable } from '@nestjs/common';
import { ImportFileRepositoryPort } from '../../application/ports/import-file-repository.port';
import { wrapDatabaseError } from '../../domain/domain-errors';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ImportFileRepository implements ImportFileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findStoragePathByImportId(importId: string): Promise<string | null> {
    try {
      const file = await this.prisma.importFile.findFirst({
        where: { importId },
        orderBy: { createdAt: 'asc' },
      });
      return file?.storagePath ?? null;
    } catch (err) {
      throw wrapDatabaseError(
        err,
        'ImportFileRepository.findStoragePathByImportId',
      );
    }
  }
}
