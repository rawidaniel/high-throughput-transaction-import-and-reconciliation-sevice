import {
  ImportSummary,
  RejectedRecordPage,
} from '../../../application/ports/import-query.port';

export class ImportSummaryDto {
  static from(summary: ImportSummary) {
    return {
      importId: summary.importId,
      totalTransactions: summary.totalTransactions,
      totalAmount: summary.totalAmount,
      earliestTransaction: summary.earliestTransaction?.toISOString() ?? null,
      latestTransaction: summary.latestTransaction?.toISOString() ?? null,
      totals: summary.totals,
      byCurrency: summary.byCurrency,
      byRiskLevel: summary.byRiskLevel,
      topMerchants: summary.topMerchants,
    };
  }
}

export class RejectedRecordsDto {
  static from(page: RejectedRecordPage) {
    return {
      items: page.items.map((item) => ({
        id: item.id,
        lineNumber: item.lineNumber,
        errorCode: item.errorCode,
        message: item.message,
        rawValueTruncated: item.rawValueTruncated,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }
}
