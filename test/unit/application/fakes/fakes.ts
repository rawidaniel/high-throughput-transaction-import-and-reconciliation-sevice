import { ClockPort } from '../../../../src/application/ports/clock.port';
import { IdGeneratorPort } from '../../../../src/application/ports/id-generator.port';
import { LoggerPort } from '../../../../src/application/ports/logger.port';

export class FixedClock implements ClockPort {
  constructor(private readonly fixedTime: Date) {}
  now(): Date {
    return this.fixedTime;
  }
}

export class SequentialIdGenerator implements IdGeneratorPort {
  private counter = 0;
  generate(): string {
    this.counter += 1;
    return `fake-id-${this.counter}`;
  }
}

export class NoopLogger implements LoggerPort {
  info(): void {}
  warn(): void {}
  error(): void {}
}
