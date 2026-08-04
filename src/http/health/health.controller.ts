import { Controller, Get, Inject, Res } from '@nestjs/common';
import { type FastifyReply } from 'fastify';
import { type HealthCheckPort } from '../../application/ports/health-check.port';
import { HEALTH_CHECK } from '../../application/ports/tokens';
import { EventLoopMonitor } from '../../infrastructure/observability/event-loop-monitor';

@Controller()
export class HealthController {
  constructor(
    private readonly eventLoopMonitor: EventLoopMonitor,
    @Inject(HEALTH_CHECK) private readonly healthCheck: HealthCheckPort,
  ) {}

  @Get('health/live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get('health/ready')
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
  eventLoop() {
    return this.eventLoopMonitor.snapshot() ?? { status: 'not-initialized' };
  }
}
