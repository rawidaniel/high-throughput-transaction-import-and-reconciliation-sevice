import {
  RetryOptions,
  RetryPolicyPort,
} from '../../../../src/application/ports/retry-policy.port';
import { MetricsRecorderPort } from '../../../../src/application/ports/metrics-recorder.port';

export class FakeRetryPolicy implements RetryPolicyPort {
  public retryCount = 0;
  constructor(
    private readonly maxAttempts = 3,
    private readonly retryable = true,
  ) {}

  async execute<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!this.retryable || attempt === this.maxAttempts) throw err;
        this.retryCount++;
        options.onRetry?.({
          attempt,
          maxAttempts: this.maxAttempts,
          delayMs: 0,
          error: err,
          operation: options.operation,
        });
      }
    }
    throw new Error('unreachable');
  }

  isRetryable(): boolean {
    return this.retryable;
  }
}

export class NoRetryPolicy implements RetryPolicyPort {
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  isRetryable(): boolean {
    return false;
  }
}

export class FakeMetricsRecorder implements MetricsRecorderPort {
  public counters: Array<{ name: string; labels?: Record<string, string> }> =
    [];

  incrementCounter(name: string, labels?: Record<string, string>): void {
    this.counters.push({ name, labels });
  }
  observeHistogram(): void {}
  setGauge(): void {}
  async render(): Promise<string> {
    return '';
  }
  contentType(): string {
    return 'text/plain';
  }

  countOf(name: string): number {
    return this.counters.filter((c) => c.name === name).length;
  }
}
