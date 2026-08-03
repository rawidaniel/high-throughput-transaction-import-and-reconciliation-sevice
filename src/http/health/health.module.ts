import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { EventLoopMonitor } from '../../infrastructure/observability/event-loop-monitor';

@Module({
  controllers: [HealthController],
  providers: [EventLoopMonitor],
})
export default class HealthModule {}
