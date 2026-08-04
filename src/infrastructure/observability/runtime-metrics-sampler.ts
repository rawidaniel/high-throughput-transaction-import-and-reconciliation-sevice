import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { EventLoopMonitor } from './event-loop-monitor';
import { HEALTH_CHECK, METRICS_RECORDER } from '../../application/ports/tokens';
import {
  METRICS,
  type MetricsRecorderPort,
} from '../../application/ports/metrics-recorder.port';
import { type HealthCheckPort } from '../../application/ports/health-check.port';

const SAMPLE_INTERVAL_MS = Number(
  process.env.METRICS_SAMPLE_INTERVAL_MS ?? 5_000,
);

@Injectable()
export class RuntimeMetricsSampler
  implements OnModuleInit, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly eventLoopMonitor: EventLoopMonitor,
    @Inject(METRICS_RECORDER) private readonly metrics: MetricsRecorderPort,
    @Inject(HEALTH_CHECK) private readonly healthCheck: HealthCheckPort,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sample();
    }, SAMPLE_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sample(): Promise<void> {
    try {
      this.recordRuntime();
      await this.recordQueueDepth();
    } catch (error) {
      console.warn('Runtime metrics sampling failed', error);
    }
  }

  private recordRuntime(): void {
    const snapshot = this.eventLoopMonitor.snapshot();
    if (!snapshot) return;

    this.metrics.setGauge(METRICS.EVENT_LOOP_DELAY_P99, snapshot.delayP99Ms);
    this.metrics.setGauge(METRICS.EVENT_LOOP_DELAY_MEAN, snapshot.delayMeanMs);
    this.metrics.setGauge(METRICS.EVENT_LOOP_DELAY_MAX, snapshot.delayMaxMs);
    this.metrics.setGauge(METRICS.EVENT_LOOP_UTILIZATION, snapshot.utilization);

    // Label values are a fixed, bounded enumeration — never an id.
    this.metrics.setGauge(METRICS.PROCESS_MEMORY, snapshot.memory.rssBytes, {
      type: 'rss',
    });
    this.metrics.setGauge(
      METRICS.PROCESS_MEMORY,
      snapshot.memory.heapUsedBytes,
      { type: 'heap_used' },
    );
    this.metrics.setGauge(
      METRICS.PROCESS_MEMORY,
      snapshot.memory.heapTotalBytes,
      { type: 'heap_total' },
    );
    this.metrics.setGauge(
      METRICS.PROCESS_MEMORY,
      snapshot.memory.externalBytes,
      { type: 'external' },
    );
    this.metrics.setGauge(
      METRICS.PROCESS_MEMORY,
      snapshot.memory.arrayBuffersBytes,
      {
        type: 'array_buffers',
      },
    );

    this.metrics.setGauge(METRICS.PROCESS_CPU_MICROS, snapshot.cpu.userMicros, {
      mode: 'user',
    });
    this.metrics.setGauge(
      METRICS.PROCESS_CPU_MICROS,
      snapshot.cpu.systemMicros,
      { mode: 'system' },
    );

    this.eventLoopMonitor.reset();
  }

  private async recordQueueDepth(): Promise<void> {
    const [queue, activeImports] = await Promise.all([
      this.healthCheck.getQueueDepth(),
      this.healthCheck.countActiveImports(),
    ]);

    this.metrics.setGauge(METRICS.JOB_QUEUE_DEPTH, queue.pending, {
      status: 'pending',
    });
    this.metrics.setGauge(METRICS.JOB_QUEUE_DEPTH, queue.claimed, {
      status: 'claimed',
    });
    this.metrics.setGauge(METRICS.ACTIVE_IMPORTS, activeImports);
  }
}
