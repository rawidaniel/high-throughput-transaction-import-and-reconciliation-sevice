export interface TotalSummary {
  accepted: number;
  rejected: number;
  duplicated: number;
}
export interface CurrencyBreakdown {
  currency: string;
  count: number;
  totalAmount: number;
}

export interface RiskBreakdown {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  count: number;
}

export interface MerchantBreakdown {
  merchantId: string;
  count: number;
  totalAmount: number;
}

export interface ImportSummary {
  importId: string;
  totalTransactions: number;
  totalAmount: number;
  totals: TotalSummary;
  byCurrency: CurrencyBreakdown[];
  byRiskLevel: RiskBreakdown[];
  topMerchants: MerchantBreakdown[];
  earliestTransaction: Date | null;
  latestTransaction: Date | null;
}

export interface RejectedRecordPage {
  items: Array<{
    id: string;
    lineNumber: number;
    errorCode: string;
    message: string;
    rawValueTruncated: unknown;
    createdAt: Date;
  }>;
  nextCursor: string | null;
}

export interface ImportQueryPort {
  getSummary(importId: string): Promise<ImportSummary>;
  getRejectedRecords(
    importId: string,
    cursor: string | null,
    limit: number,
  ): Promise<RejectedRecordPage>;
}
