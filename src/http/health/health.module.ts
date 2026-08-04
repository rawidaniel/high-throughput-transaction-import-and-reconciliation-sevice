import { Module } from '@nestjs/common';
import { HEALTH_CHECK, METRICS_RECORDER } from '../../application/ports/tokens';
import { EventLoopMonitor } from '../../infrastructure/observability/event-loop-monitor';
import { PrometheusMetricsRecorder } from '../../infrastructure/observability/prometheus-metrics-recorder';
import { HealthCheck } from '../../infrastructure/repository/health-check';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [
    EventLoopMonitor,
    { provide: HEALTH_CHECK, useClass: HealthCheck },
    { provide: METRICS_RECORDER, useClass: PrometheusMetricsRecorder },
  ],
})
export default class HealthModule {}
