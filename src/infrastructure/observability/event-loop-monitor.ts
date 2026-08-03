import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import {
  monitorEventLoopDelay,
  performance,
  IntervalHistogram,
} from 'node:perf_hooks';

@Injectable()
export class EventLoopMonitor implements OnModuleInit, OnApplicationShutdown {
  private histogram: IntervalHistogram | null = null;
  private lastElu = performance.eventLoopUtilization();

  onModuleInit(): void {
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();
  }

  onApplicationShutdown(): void {
    this.histogram?.disable();
  }

  snapshot() {
    const h = this.histogram;
    if (!h) return null;

    const elu = performance.eventLoopUtilization(this.lastElu);
    this.lastElu = performance.eventLoopUtilization();

    return {
      delayMeanMs: round(h.mean / 1e6),
      delayP50Ms: round(h.percentile(50) / 1e6),
      delayP99Ms: round(h.percentile(99) / 1e6),
      delayMaxMs: round(h.max / 1e6),
      utilization: round(elu.utilization, 4),
    };
  }

  reset(): void {
    this.histogram?.reset();
  }
}

function round(value: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
