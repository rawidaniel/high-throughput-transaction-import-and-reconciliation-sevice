export interface ValidatedTransaction {
  provider: string;
  transactionId: string;
  accountId: string;
  merchantId: string;
  amount: number;
  currency: string;
  timestamp: Date;
  description: string | null;
}
