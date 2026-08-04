import { Injectable } from '@nestjs/common';
import {
  RetryOptions,
  RetryPolicyPort,
} from '../../application/ports/retry-policy.port';
import { DomainError, ErrorCategory } from '../../domain/domain-errors';

const MAX_ATTEMPTS = Number(process.env.RETRY_MAX_ATTEMPTS ?? 4);
const BASE_DELAY_MS = Number(process.env.RETRY_BASE_DELAY_MS ?? 200);
const MAX_DELAY_MS = Number(process.env.RETRY_MAX_DELAY_MS ?? 5_000);

const RETRYABLE_PG_CODES = new Set([
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '40001',
  '40P01',
  '53300',
  '57P01',
  '57P02',
  '57P03',
  '55P03',
]);

const RETRYABLE_NODE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

@Injectable()
export class ExponentialBackoffRetryPolicy implements RetryPolicyPort {
  async execute<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        if (!this.isRetryable(err)) {
          throw err;
        }

        if (attempt === MAX_ATTEMPTS) {
          throw err;
        }

        const delayMs = this.computeDelay(attempt);
        options.onRetry?.({
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          delayMs,
          error: err,
          operation: options.operation,
        });

        await sleep(delayMs);
      }
    }

    throw lastError;
  }

  isRetryable(error: unknown): boolean {
    if (error instanceof DomainError) {
      if (error.category === ErrorCategory.CANCELLATION) return false;
      if (error.retryable) return true;

      return this.hasRetryableCause(error.cause);
    }

    return this.hasRetryableCause(error);
  }

  private hasRetryableCause(error: unknown, depth = 0): boolean {
    if (!error || typeof error !== 'object' || depth > 5) return false;

    const candidate = error as {
      code?: unknown;
      cause?: unknown;
      originalCode?: unknown;
    };

    const codes = [candidate.code, candidate.originalCode].filter(
      (c): c is string => typeof c === 'string',
    );

    for (const code of codes) {
      if (RETRYABLE_PG_CODES.has(code) || RETRYABLE_NODE_CODES.has(code))
        return true;
    }

    return this.hasRetryableCause(candidate.cause, depth + 1);
  }

  private computeDelay(attempt: number): number {
    const ceiling = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
    return Math.floor(Math.random() * ceiling);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
