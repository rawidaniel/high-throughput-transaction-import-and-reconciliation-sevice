import { Injectable } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import {
  CreateImportInput,
  CreateImportResult,
  ImportRecord,
  ImportRepositoryPort,
} from '../../application/ports/import-repository.port';
import { PrismaService } from '../prisma/prisma.service';
import { wrapDatabaseError } from 'src/domain/domain-errors';

@Injectable()
export class ImportRepository implements ImportRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createOrReturnExisting(
    input: CreateImportInput,
  ): Promise<CreateImportResult> {
    try {
      const importRecord = await this.prisma.$transaction(async (tx) => {
        const created = await tx.import.create({
          data: { id: input.id, createdAt: input.createdAt, status: 'PENDING' },
        });

        await tx.idempotencyKey.create({
          data: { key: input.idempotencyKey, importId: created.id },
        });

        await tx.importFile.create({
          data: {
            importId: created.id,
            storagePath: input.file.storagePath,
            size: input.file.size,
            checksum: input.file.checksum,
          },
        });

        await tx.processingJob.create({
          data: { importId: created.id, status: 'PENDING' },
        });

        return created;
      });

      return { importRecord: this.toDomain(importRecord), isNew: true };
    } catch (err) {
      if (this.isIdempotencyKeyConflict(err)) {
        const existingKey = await this.prisma.idempotencyKey.findUniqueOrThrow({
          where: { key: input.idempotencyKey },
          include: { import: true },
        });

        return {
          importRecord: this.toDomain(existingKey.import),
          isNew: false,
        };
      }

      throw wrapDatabaseError(err, 'ImportRepository.createOrReturnExisting');
    }
  }

  private isIdempotencyKeyConflict(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      ((err.meta?.target as string[] | undefined)?.includes('key') ?? false)
    );
  }

  private toDomain(record: {
    id: string;
    status: string;
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
  }): ImportRecord {
    // Explicit mapping keeps `domain`/`application` decoupled from Prisma's
    // generated types — swapping ORMs later only touches this method.
    return { ...record, status: record.status as ImportRecord['status'] };
  }
}
