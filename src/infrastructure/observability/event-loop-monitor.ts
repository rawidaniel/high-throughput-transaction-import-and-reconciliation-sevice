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

export interface RuntimeSnapshot {
  delayMeanMs: number;
  delayP50Ms: number;
  delayP99Ms: number;
  delayMaxMs: number;
  utilization: number;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  cpu: {
    userMicros: number;
    systemMicros: number;
  };
}

@Injectable()
export class EventLoopMonitor implements OnModuleInit, OnApplicationShutdown {
  private histogram: IntervalHistogram | null = null;
  private lastElu = performance.eventLoopUtilization();
  private lastCpu = process.cpuUsage();

  onModuleInit(): void {
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();
  }

  onApplicationShutdown(): void {
    this.histogram?.disable();
  }

  snapshot(): RuntimeSnapshot | null {
    const h = this.histogram;
    if (!h) return null;

    const elu = performance.eventLoopUtilization(this.lastElu);
    this.lastElu = performance.eventLoopUtilization();

    const cpu = process.cpuUsage(this.lastCpu);
    this.lastCpu = process.cpuUsage();

    const memory = process.memoryUsage();

    return {
      delayMeanMs: round(h.mean / 1e6),
      delayP50Ms: round(h.percentile(50) / 1e6),
      delayP99Ms: round(h.percentile(99) / 1e6),
      delayMaxMs: round(h.max / 1e6),
      utilization: round(elu.utilization, 4),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
      },
      cpu: { userMicros: cpu.user, systemMicros: cpu.system },
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
