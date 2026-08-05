import {
  ErrorCategory,
  FileTooLargeError,
  ImportNotFoundError,
  InvalidFileTypeError,
  wrapDatabaseError,
} from '../../../../src/domain/domain-errors';

describe('DomainError (unit)', () => {
  it('exposes only code/message/requestId in the safe response — never context or cause', () => {
    const err = new InvalidFileTypeError('application/exe (.exe)');
    const safe = err.toSafeResponse('req-123');

    expect(safe).toEqual({
      error: {
        code: 'INVALID_FILE_TYPE',
        message: 'Unsupported file type. Allowed: .ndjson, .jsonl, .json',
        requestId: 'req-123',
      },
    });
    expect(err.context).toEqual({ received: 'application/exe (.exe)' });
    expect(JSON.stringify(safe)).not.toContain('exe');
  });

  it('classifies request-validation errors as non-retryable', () => {
    const err = new FileTooLargeError(500 * 1024 * 1024);
    expect(err.category).toBe(ErrorCategory.REQUEST_VALIDATION);
    expect(err.retryable).toBe(false);
  });

  it('classifies business-rule errors as non-retryable, distinct from infra', () => {
    const err = new ImportNotFoundError('abc-123');
    expect(err.category).toBe(ErrorCategory.BUSINESS_RULE);
    expect(err.retryable).toBe(false);
  });

  it('wraps a raw driver error as a retryable infrastructure error and preserves the cause internally without leaking it into the safe response', () => {
    const rawDbError = new Error(
      'connection terminated unexpectedly at 10.0.0.5:5432',
    );
    const wrapped = wrapDatabaseError(rawDbError, 'ImportRepository.findById');

    expect(wrapped.category).toBe(ErrorCategory.INFRASTRUCTURE);
    expect(wrapped.retryable).toBe(true);
    expect(wrapped.cause).toBe(rawDbError);
    expect(JSON.stringify(wrapped.toSafeResponse('req-1'))).not.toContain(
      '10.0.0.5',
    );
  });
});
