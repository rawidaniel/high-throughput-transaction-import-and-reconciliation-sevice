import { Injectable } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { wrapDatabaseError } from 'src/domain/domain-errors';
import {
  CreateImportInput,
  CreateImportResult,
  ImportRecord,
  ImportRepositoryPort,
} from '../../application/ports/import-repository.port';
import { PrismaService } from '../prisma/prisma.service';

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
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== 'P2002'
    ) {
      return false;
    }

    const fields = this.extractViolatedFields(err);
    return fields.length === 1 && fields[0] === 'key';
  }

  private extractViolatedFields(
    err: Prisma.PrismaClientKnownRequestError,
  ): string[] {
    const target = err.meta?.target;
    if (Array.isArray(target)) {
      return target as string[];
    }

    const meta = err.meta as
      | {
          driverAdapterError?: {
            cause?: { constraint?: { fields?: unknown } };
          };
        }
      | undefined;

    const fields = meta?.driverAdapterError?.cause?.constraint?.fields;
    if (Array.isArray(fields)) {
      return fields as string[];
    }

    return [];
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
    return { ...record, status: record.status as ImportRecord['status'] };
  }
}
