import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const IMPORT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'CANCELLING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export class CreateImportBodyDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'NDJSON file — one JSON transaction object per line. Max 500 MB. ' +
      'Allowed extensions: .ndjson, .jsonl, .json. Compressed uploads are rejected.',
  })
  file!: unknown;
}

export class CreateImportResponseDto {
  @ApiProperty({
    description: 'Import identifier. Use it to poll status and fetch reports.',
    example: 'a1a16868-10a8-4fa9-bf30-d7e5cfa733d9',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description:
      'Always PENDING on creation — processing happens asynchronously.',
    enum: IMPORT_STATUSES,
    example: 'PENDING',
  })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-05T10:30:00.000Z' })
  createdAt!: string;
}

export class ImportStatusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: IMPORT_STATUSES,
    description:
      'PENDING (queued) → PROCESSING (worker active) → COMPLETED | FAILED. ' +
      'CANCELLING is a transient state after a cancel request; the worker ' +
      'stops between batches and transitions to CANCELLED.',
  })
  status!: string;

  @ApiProperty({
    description:
      'Total non-blank lines in the file, counted by the server before processing. ' +
      'The client-declared record count is never trusted.',
    example: 500000,
  })
  totalRecords!: number;

  @ApiProperty({
    description: 'Records handled so far. Divide by totalRecords for progress.',
    example: 250000,
  })
  processedCount!: number;

  @ApiProperty({
    description: 'Records successfully persisted. Excludes duplicates.',
    example: 245000,
  })
  acceptedCount!: number;

  @ApiProperty({
    description:
      'Records that failed validation. See GET /:id/rejections for detail.',
    example: 3000,
  })
  rejectedCount!: number;

  @ApiProperty({
    description:
      'Records skipped because (provider, transactionId) already existed. ' +
      'First write wins; the stored row is never overwritten.',
    example: 2000,
  })
  duplicateCount!: number;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  startedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Populated only when status is FAILED.',
    example: null,
  })
  failureReason!: string | null;
}

export class CancelImportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description:
      'CANCELLING — the request was accepted. The worker checks this flag ' +
      'between batches and transitions to CANCELLED once it stops. Poll ' +
      'GET /v1/imports/:id to observe the final state.',
    example: 'CANCELLING',
  })
  status!: string;
}

export class TotalSummaryDto {
  @ApiProperty({ example: 245000 })
  accepted!: number;

  @ApiProperty({ example: 3000 })
  rejected!: number;

  @ApiProperty({ example: 2000 })
  duplicated!: number;
}

export class CurrencyBreakdownDto {
  @ApiProperty({ example: 'USD', minLength: 3, maxLength: 3 })
  currency!: string;

  @ApiProperty({ example: 120000 })
  count!: number;

  @ApiProperty({ example: 4523190.55 })
  totalAmount!: number;
}

export class RiskBreakdownDto {
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'] })
  riskLevel!: string;

  @ApiProperty({ example: 180000 })
  count!: number;
}

export class MerchantBreakdownDto {
  @ApiProperty({ example: 'merch-42' })
  merchantId!: string;

  @ApiProperty({ example: 3200 })
  count!: number;

  @ApiProperty({ example: 89412.3 })
  totalAmount!: number;
}

export class ImportSummaryDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ example: 245000 })
  totalTransactions!: number;

  @ApiProperty({ example: 9134221.87 })
  totalAmount!: number;

  @ApiProperty({ type: TotalSummaryDto })
  totals!: TotalSummaryDto;

  @ApiProperty({ type: [CurrencyBreakdownDto] })
  byCurrency!: CurrencyBreakdownDto[];

  @ApiProperty({ type: [RiskBreakdownDto] })
  byRiskLevel!: RiskBreakdownDto[];

  @ApiProperty({
    type: [MerchantBreakdownDto],
    description: 'Top 10 merchants by count.',
  })
  topMerchants!: MerchantBreakdownDto[];

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  earliestTransaction!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  latestTransaction!: string | null;
}

export class RejectedRecordDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: '1-based line number in the uploaded file.',
    example: 4021,
  })
  lineNumber!: number;

  @ApiProperty({
    description: 'Why the record was rejected.',
    enum: [
      'INVALID_JSON',
      'LINE_TOO_LONG',
      'MISSING_FIELD',
      'INVALID_AMOUNT',
      'INVALID_CURRENCY',
      'INVALID_TIMESTAMP',
      'DESCRIPTION_TOO_LONG',
      'INVALID_TYPE',
    ],
    example: 'INVALID_AMOUNT',
  })
  errorCode!: string;

  @ApiProperty({ example: 'amount must be a finite number greater than zero.' })
  message!: string;

  @ApiProperty({
    description: 'The offending record, truncated to 2 KB.',
    example: { transactionId: 'txn-4021', amount: -50 },
  })
  rawValueTruncated!: unknown;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class RejectedRecordsPageDto {
  @ApiProperty({ type: [RejectedRecordDto] })
  items!: RejectedRecordDto[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Pass as ?cursor= to fetch the next page. Null when exhausted. ' +
      'Keyset pagination — every page costs the same regardless of depth.',
    example: 'b7c3d891-0000-4000-8000-000000000000',
  })
  nextCursor!: string | null;
}
