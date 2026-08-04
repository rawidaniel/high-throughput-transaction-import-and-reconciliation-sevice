import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ImportQueryPort,
  ImportSummary,
} from '../../application/ports/import-query.port';
import { Prisma } from 'generated/prisma/client';
import { wrapDatabaseError } from '../../domain/domain-errors';

const TOP_MERCHANTS_LIMIT = 10;

@Injectable()
export class ImportQuery implements ImportQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(importId: string): Promise<ImportSummary> {
    try {
      const [importData, overall, byCurrency, byRiskLevel, topMerchants] =
        await Promise.all([
          this.prisma.import.findUnique({
            where: { id: importId },
          }),

          this.prisma.transaction.aggregate({
            where: { importId },
            _count: { _all: true },
            _sum: { amount: true },
            _min: { timestamp: true },
            _max: { timestamp: true },
          }),
          this.prisma.transaction.groupBy({
            by: ['currency'],
            where: { importId },
            _count: { _all: true },
            _sum: { amount: true },
            orderBy: { currency: 'asc' },
          }),
          this.prisma.transaction.groupBy({
            by: ['riskLevel'],
            where: { importId },
            _count: { _all: true },
          }),
          this.prisma.transaction.groupBy({
            by: ['merchantId'],
            where: { importId },
            _count: { _all: true },
            _sum: { amount: true },
            orderBy: { _count: { merchantId: 'desc' } },
            take: TOP_MERCHANTS_LIMIT,
          }),
        ]);

      return {
        importId,
        totalTransactions: overall._count._all,
        totalAmount: toNumber(overall._sum.amount),
        earliestTransaction: overall._min.timestamp ?? null,
        latestTransaction: overall._max.timestamp ?? null,
        totals: {
          accepted: importData?.acceptedCount || 0,
          rejected: importData?.rejectedCount || 0,
          duplicated: importData?.duplicateCount || 0,
        },
        byCurrency: byCurrency.map((row) => ({
          currency: row.currency,
          count: row._count._all,
          totalAmount: toNumber(row._sum.amount),
        })),
        byRiskLevel: byRiskLevel.map((row) => ({
          riskLevel: row.riskLevel,
          count: row._count._all,
        })),
        topMerchants: topMerchants.map((row) => ({
          merchantId: row.merchantId,
          count: row._count._all,
          totalAmount: toNumber(row._sum.amount),
        })),
      };
    } catch (err) {
      throw wrapDatabaseError(err, 'ImportQuery.getSummary');
    }
  }
}

function toNumber(value: Prisma.Decimal | null): number {
  return value ? Number(value) : 0;
}
