import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { TooManyConcurrentUploadsError } from '../../../domain/domain-errors';

const MAX_CONCURRENT_UPLOADS = Number(process.env.MAX_CONCURRENT_UPLOADS ?? 10);

@Injectable()
export class ConcurrentUploadLimitInterceptor implements NestInterceptor {
  private inFlight = 0;

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (this.inFlight >= MAX_CONCURRENT_UPLOADS) {
      throw new TooManyConcurrentUploadsError(MAX_CONCURRENT_UPLOADS);
    }

    this.inFlight++;

    return next.handle().pipe(finalize(() => this.inFlight--));
  }

  get currentInFlight(): number {
    return this.inFlight;
  }
}
