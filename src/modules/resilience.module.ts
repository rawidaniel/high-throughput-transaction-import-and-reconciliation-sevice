import { Module } from '@nestjs/common';
import { ExponentialBackoffRetryPolicy } from '../infrastructure/resilience/exponential-backoff-retry.policy';
import { RETRY_POLICY } from '../application/ports/tokens';

@Module({
  providers: [
    { provide: RETRY_POLICY, useClass: ExponentialBackoffRetryPolicy },
  ],
  exports: [RETRY_POLICY],
})
export class ResilienceModule {}
