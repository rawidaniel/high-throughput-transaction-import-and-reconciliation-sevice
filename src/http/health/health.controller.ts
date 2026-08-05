import { Controller, Get, Inject, Res } from '@nestjs/common';
import { type FastifyReply } from 'fastify';
import { type HealthCheckPort } from '../../application/ports/health-check.port';
import {
  METRICS,
  type MetricsRecorderPort,
} from '../../application/ports/metrics-recorder.port';
import { HEALTH_CHECK, METRICS_RECORDER } from '../../application/ports/tokens';
import { EventLoopMonitor } from '../../infrastructure/observability/event-loop-monitor';
import {
  ApiEventLoop,
  ApiLiveness,
  ApiMetrics,
  ApiReadiness,
} from './decorator/health.decorator';

@Controller()
export class HealthController {
  constructor(
    private readonly eventLoopMonitor: EventLoopMonitor,
    @Inject(HEALTH_CHECK) private readonly healthCheck: HealthCheckPort,
    @Inject(METRICS_RECORDER) private readonly metrics: MetricsRecorderPort,
  ) {}

  @Get('health/live')
  @ApiLiveness()
  live() {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get('health/ready')
  @ApiReadiness()
  async ready(@Res() reply: FastifyReply) {
    const databaseReachable = await this.healthCheck.pingDatabase();

    if (!databaseReachable) {
      return reply.status(503).send({
        status: 'not_ready',
        checks: { database: 'unreachable' },
      });
    }

    const queue = await this.healthCheck.getQueueDepth();

    return reply.status(200).send({
      status: 'ready',
      checks: { database: 'ok' },
      queue,
    });
  }

  @Get('health/event-loop')
  @ApiEventLoop()
  eventLoop() {
    return this.eventLoopMonitor.snapshot() ?? { status: 'not-initialized' };
  }

  @Get('metrics')
  @ApiMetrics()
  async metricsEndpoint(@Res() reply: FastifyReply) {
    const loop = this.eventLoopMonitor.snapshot();
    if (loop) {
      this.metrics.setGauge(METRICS.EVENT_LOOP_DELAY_P99, loop.delayP99Ms);
      this.metrics.setGauge(METRICS.EVENT_LOOP_UTILIZATION, loop.utilization);
    }

    const queue = await this.healthCheck.getQueueDepth();
    this.metrics.setGauge(METRICS.JOB_QUEUE_DEPTH, queue.pending, {
      status: 'pending',
    });
    this.metrics.setGauge(METRICS.JOB_QUEUE_DEPTH, queue.claimed, {
      status: 'claimed',
    });

    const body = await this.metrics.render();
    return reply.header('Content-Type', this.metrics.contentType()).send(body);
  }
}
