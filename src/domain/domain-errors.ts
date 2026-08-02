export enum ErrorCategory {
  REQUEST_VALIDATION = 'REQUEST_VALIDATION',
  RECORD_VALIDATION = 'RECORD_VALIDATION',
  BUSINESS_RULE = 'BUSINESS_RULE',
  INFRASTRUCTURE = 'INFRASTRUCTURE',
  CANCELLATION = 'CANCELLATION',
}

export interface DomainErrorOptions {
  context?: Record<string, unknown>;
  cause?: unknown;
}

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  abstract readonly category: ErrorCategory;

  abstract readonly retryable: boolean;

  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;

  protected constructor(message: string, options?: DomainErrorOptions) {
    super(message);
    this.context = options?.context;
    this.cause = options?.cause;
  }

  toSafeResponse(requestId: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
      },
    };
  }
}

export class MissingIdempotencyKeyError extends DomainError {
  readonly code = 'MISSING_IDEMPOTENCY_KEY';
  readonly httpStatus = 400;
  readonly category = ErrorCategory.REQUEST_VALIDATION;
  readonly retryable = false;
  constructor() {
    super('Idempotency-Key header is required.');
  }
}

export class InvalidRequestBodyError extends DomainError {
  readonly code = 'INVALID_REQUEST_BODY';
  readonly httpStatus = 400;
  readonly category = ErrorCategory.REQUEST_VALIDATION;
  readonly retryable = false;
  constructor(reason: string) {
    super(reason);
  }
}
export class NoFileUploadedError extends DomainError {
  readonly code = 'NO_FILE_UPLOADED';
  readonly httpStatus = 400;
  readonly category = ErrorCategory.REQUEST_VALIDATION;
  readonly retryable = false;
  constructor() {
    super('No file part found in multipart request.');
  }
}
