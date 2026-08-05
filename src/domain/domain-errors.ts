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

export class InvalidFileTypeError extends DomainError {
  readonly code = 'INVALID_FILE_TYPE';
  readonly httpStatus = 400;
  readonly category = ErrorCategory.REQUEST_VALIDATION;
  readonly retryable = false;
  constructor(received: string) {
    super('Unsupported file type. Allowed: .ndjson, .jsonl, .json', {
      context: { received },
    });
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

export class ShutdownInterruptedError extends DomainError {
  readonly code = 'SHUTDOWN_INTERRUPTED';
  readonly httpStatus = 503;
  readonly category = ErrorCategory.CANCELLATION;
  readonly retryable = false;
  constructor(component: string) {
    super('Operation interrupted because the process is shutting down.', {
      context: { component },
    });
  }
}

export class TooManyConcurrentUploadsError extends DomainError {
  readonly code = 'TOO_MANY_CONCURRENT_UPLOADS';
  readonly httpStatus = 503;
  readonly category = ErrorCategory.BUSINESS_RULE;
  readonly retryable = false;
  constructor(limit: number) {
    super('Too many uploads in progress. Please retry shortly.', {
      context: { limit },
    });
  }
}

export class FileTooLargeError extends DomainError {
  readonly code = 'IMPORT_FILE_TOO_LARGE';
  readonly httpStatus = 413;
  readonly category = ErrorCategory.REQUEST_VALIDATION;
  readonly retryable = false;
  constructor(limitBytes: number) {
    super('The uploaded file exceeds the allowed size', {
      context: { limitBytes },
    });
  }
}

export class ImportNotFoundError extends DomainError {
  readonly code = 'IMPORT_NOT_FOUND';
  readonly httpStatus = 404;
  readonly category = ErrorCategory.BUSINESS_RULE;
  readonly retryable = false;
  constructor(id: string) {
    super('The requested import does not exist.', {
      context: { importId: id },
    });
  }
}

export class ImportAlreadyFinishedError extends DomainError {
  readonly code = 'IMPORT_ALREADY_FINISHED';
  readonly httpStatus = 409;
  readonly category = ErrorCategory.BUSINESS_RULE;
  readonly retryable = false;
  constructor(id: string, currentStatus: string) {
    super('This import has already finished and cannot be modified.', {
      context: { importId: id, currentStatus },
    });
  }
}

export class ImportCancelledError extends DomainError {
  readonly code = 'IMPORT_CANCELLED';
  readonly httpStatus = 409;
  readonly category = ErrorCategory.CANCELLATION;
  readonly retryable = false;
  constructor(id: string) {
    super('This import was cancelled.', { context: { importId: id } });
  }
}

export class InfrastructureError extends DomainError {
  readonly code: string;
  readonly httpStatus = 503;
  readonly category = ErrorCategory.INFRASTRUCTURE;
  readonly retryable: boolean;

  constructor(
    code: string,
    safeMessage: string,
    options: DomainErrorOptions & { retryable: boolean },
  ) {
    super(safeMessage, options);
    this.code = code;
    this.retryable = options.retryable;
  }
}

export function wrapDatabaseError(
  cause: unknown,
  operation: string,
): InfrastructureError {
  return new InfrastructureError(
    'DATABASE_UNAVAILABLE',
    'A database operation failed.',
    {
      cause,
      context: { operation },
      retryable: true,
    },
  );
}
