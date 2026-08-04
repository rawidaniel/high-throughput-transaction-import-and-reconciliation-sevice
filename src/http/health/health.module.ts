import { Module } from '@nestjs/common';
import { HEALTH_CHECK } from '../../application/ports/tokens';
import { EventLoopMonitor } from '../../infrastructure/observability/event-loop-monitor';
import { HealthCheck } from '../../infrastructure/repository/health-check';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [
    EventLoopMonitor,
    { provide: HEALTH_CHECK, useClass: HealthCheck },
  ],
})
export default class HealthModule {}
