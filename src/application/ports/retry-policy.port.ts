export interface RetryAttemptContext {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
  operation: string;
}

export interface RetryOptions {
  operation: string;
  onRetry?: (context: RetryAttemptContext) => void;
}

export interface RetryPolicyPort {
  execute<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
  isRetryable(error: unknown): boolean;
}
