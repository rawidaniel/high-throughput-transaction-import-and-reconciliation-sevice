import { Injectable } from '@nestjs/common';
import { wrapDatabaseError } from '../../domain/domain-errors';
import { Prisma } from '../../../generated/prisma/client';
import {
  BatchPersistResult,
  PersistBatchInput,
  TransactionRepositoryPort,
} from '../../application/ports/transaction-repository.port';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TransactionRepository implements TransactionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async persistBatch(input: PersistBatchInput): Promise<BatchPersistResult> {
    const { importId, scored, rejected, processedDelta } = input;

    try {
      return await this.prisma.$transaction(async (tx) => {
        let insertedCount = 0;

        if (scored.length > 0) {
          const values = scored.map(
            (s) => Prisma.sql`(
              gen_random_uuid(),
              ${importId},
              ${s.transaction.provider},
              ${s.transaction.transactionId},
              ${s.transaction.accountId},
              ${s.transaction.merchantId},
              ${s.transaction.amount},
              ${s.transaction.currency},
              ${s.transaction.timestamp},
              ${s.fingerprint},
              ${s.riskScore},
              ${s.riskLevel}::"RiskLevel",
              ${s.transaction.description},
              now()
            )`,
          );

          const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            INSERT INTO transactions (
              id, "importId", provider, "transactionId", "accountId", "merchantId",
              amount, currency, timestamp, fingerprint, "riskScore", "riskLevel",
              description, "createdAt"
            )
            VALUES ${Prisma.join(values)}
            ON CONFLICT (provider, "transactionId") DO NOTHING
            RETURNING id;
          `);

          insertedCount = inserted.length;
        }

        const duplicateCount = scored.length - insertedCount;

        if (rejected.length > 0) {
          await tx.rejectedRecord.createMany({
            data: rejected.map((r) => ({
              importId,
              lineNumber: r.lineNumber,
              errorCode: r.errorCode,
              message: r.message,
              rawValueTruncated: r.rawValueTruncated,
            })),
          });
        }

        await tx.import.update({
          where: { id: importId },
          data: {
            processedCount: { increment: processedDelta },
            acceptedCount: { increment: insertedCount },
            duplicateCount: { increment: duplicateCount },
            rejectedCount: { increment: rejected.length },
          },
        });

        return {
          insertedCount,
          duplicateCount,
          rejectedCount: rejected.length,
        };
      });
    } catch (err) {
      throw wrapDatabaseError(err, 'TransactionRepository.persistBatch');
    }
  }

  async findFingerprints(
    keys: Array<{ provider: string; transactionId: string }>,
  ): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();

    try {
      const rows = await this.prisma.transaction.findMany({
        where: {
          OR: keys.map((k) => ({
            provider: k.provider,
            transactionId: k.transactionId,
          })),
        },
        select: { provider: true, transactionId: true, fingerprint: true },
      });

      return new Map(
        rows.map((r) => [`${r.provider}:${r.transactionId}`, r.fingerprint]),
      );
    } catch (err) {
      throw wrapDatabaseError(err, 'TransactionRepository.findFingerprints');
    }
  }
}
