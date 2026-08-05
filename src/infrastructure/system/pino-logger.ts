import { Injectable } from '@nestjs/common';
import pino, { Logger } from 'pino';
import { sanitizeForLog, sanitizeLogContext } from './log-sanitizer';
import { LoggerPort } from '../../application/ports/logger.port';

@Injectable()
export class PinoLogger implements LoggerPort {
  private readonly logger: Logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',

    redact: {
      paths: [
        'password',
        'token',
        'apiKey',
        'authorization',
        'secret',
        'idempotencyKey',
        '*.password',
        '*.token',
        '*.authorization',
      ],
      censor: '[REDACTED]',
    },
  });

  info(message: string, context?: Record<string, unknown>): void {
    this.logger.info(
      sanitizeLogContext(context) ?? {},
      sanitizeForLog(message),
    );
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(
      sanitizeLogContext(context) ?? {},
      sanitizeForLog(message),
    );
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.logger.error(
      sanitizeLogContext(context) ?? {},
      sanitizeForLog(message),
    );
  }
}
