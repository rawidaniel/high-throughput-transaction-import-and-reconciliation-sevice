import { Module } from '@nestjs/common';
import { HEALTH_CHECK, METRICS_RECORDER } from '../application/ports/tokens';
import { EventLoopMonitor } from '../infrastructure/observability/event-loop-monitor';
import { PrometheusMetricsRecorder } from '../infrastructure/observability/prometheus-metrics-recorder';
import { RuntimeMetricsSampler } from '../infrastructure/observability/runtime-metrics-sampler';
import { HealthCheck } from '../infrastructure/repository/health-check';
import { RepositoryModule } from './repository.module';

@Module({
  imports: [RepositoryModule],
  providers: [
    { provide: METRICS_RECORDER, useClass: PrometheusMetricsRecorder },
    { provide: HEALTH_CHECK, useClass: HealthCheck },
    EventLoopMonitor,
    RuntimeMetricsSampler,
  ],
  exports: [METRICS_RECORDER, EventLoopMonitor, RuntimeMetricsSampler],
})
export class ObservabilityModule {}
