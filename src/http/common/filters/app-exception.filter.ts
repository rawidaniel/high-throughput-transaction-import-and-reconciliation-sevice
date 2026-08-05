import { ArgumentsHost, Catch, ExceptionFilter, Inject } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LOGGER } from 'src/application/ports/tokens';
import { type LoggerPort } from '../../../application/ports/logger.port';
import { DomainError, ErrorCategory } from '../../../domain/domain-errors';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: LoggerPort) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const requestId = request.id;

    if (exception instanceof DomainError) {
      this.logDomainError(exception, requestId);
      reply
        .status(exception.httpStatus)
        .send(exception.toSafeResponse(requestId));
      return;
    }

    this.logger.error('Unhandled exception', {
      requestId,
      message:
        exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
      name: exception instanceof Error ? exception.name : typeof exception,
    });

    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId,
      },
    });
  }

  private logDomainError(exception: DomainError, requestId: string): void {
    const logPayload = {
      requestId,
      code: exception.code,
      category: exception.category,
      retryable: exception.retryable,
      context: exception.context,
      cause:
        exception.cause instanceof Error
          ? exception.cause.message
          : exception.cause,
    };

    if (exception.category === ErrorCategory.INFRASTRUCTURE) {
      this.logger.error(exception.message, logPayload);
    } else {
      this.logger.warn(exception.message, logPayload);
    }
  }
}
