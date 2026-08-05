import { ValidatedTransaction } from './transaction.entity';

export const MAX_DESCRIPTION_LENGTH = 500;

export type ValidationErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_AMOUNT'
  | 'INVALID_CURRENCY'
  | 'INVALID_TIMESTAMP'
  | 'DESCRIPTION_TOO_LONG'
  | 'INVALID_TYPE';

export type ValidationResult =
  | { ok: true; transaction: ValidatedTransaction }
  | {
      ok: false;
      errorCode: ValidationErrorCode;
      message: string;
      field?: string;
    };

const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

function fail(
  errorCode: ValidationErrorCode,
  message: string,
  field?: string,
): ValidationResult {
  return { ok: false, errorCode, message, field };
}

export function validateTransaction(
  raw: unknown,
  fallbackProvider: string,
): ValidationResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('INVALID_TYPE', 'Record must be a JSON object.');
  }

  const record = raw as Record<string, unknown>;

  const provider = normalizeRequiredString(record.provider) ?? fallbackProvider;
  // if (!provider) {
  //   return fail(
  //     'MISSING_FIELD',
  //     'provider is required and no import-level provider is set.',
  //     'provider',
  //   );
  // }

  const transactionId = normalizeRequiredString(record.transactionId);
  if (!transactionId) {
    return fail('MISSING_FIELD', 'transactionId is required.', 'transactionId');
  }

  const accountId = normalizeRequiredString(record.accountId);
  if (!accountId) {
    return fail('MISSING_FIELD', 'accountId is required.', 'accountId');
  }

  const merchantId = normalizeRequiredString(record.merchantId);
  if (!merchantId) {
    return fail('MISSING_FIELD', 'merchantId is required.', 'merchantId');
  }

  if (record.amount === undefined || record.amount === null) {
    return fail('MISSING_FIELD', 'amount is required.', 'amount');
  }
  const amount = normalizeAmount(record.amount);
  if (amount === null) {
    return fail(
      'INVALID_AMOUNT',
      'amount must be a finite number greater than zero.',
      'amount',
    );
  }

  const rawCurrency = normalizeRequiredString(record.currency);
  if (!rawCurrency) {
    return fail('MISSING_FIELD', 'currency is required.', 'currency');
  }
  if (!CURRENCY_PATTERN.test(rawCurrency)) {
    return fail(
      'INVALID_CURRENCY',
      'currency must be a 3-letter alphabetic code.',
      'currency',
    );
  }
  const currency = rawCurrency.toUpperCase();

  if (record.timestamp === undefined || record.timestamp === null) {
    return fail('MISSING_FIELD', 'timestamp is required.', 'timestamp');
  }
  const timestamp = normalizeTimestamp(record.timestamp);
  if (!timestamp) {
    return fail(
      'INVALID_TIMESTAMP',
      'timestamp must be a valid ISO-8601 date-time.',
      'timestamp',
    );
  }

  let description: string | null = null;
  if (record.description !== undefined && record.description !== null) {
    if (typeof record.description !== 'string') {
      return fail(
        'INVALID_TYPE',
        'description must be a string.',
        'description',
      );
    }
    const trimmed = record.description.replace(CONTROL_CHARS, '').trim();
    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      return fail(
        'DESCRIPTION_TOO_LONG',
        `description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`,
        'description',
      );
    }
    description = trimmed.length > 0 ? trimmed : null;
  }

  return {
    ok: true,
    transaction: {
      provider,
      transactionId,
      accountId,
      merchantId,
      amount,
      currency,
      timestamp,
      description,
    },
  };
}

const MAX_IDENTIFIER_LENGTH = 128;

const CONTROL_CHARS = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f]`, 'g');

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHARS, '').trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length > MAX_IDENTIFIER_LENGTH) return null;
  return cleaned;
}

function normalizeAmount(value: unknown): number | null {
  let parsed: number;

  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    parsed = Number(trimmed);
  } else {
    return null;
  }

  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return Math.round(parsed * 100) / 100;
}

function normalizeTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  if (year < 1970 || year > 2200) return null;

  return date;
}
