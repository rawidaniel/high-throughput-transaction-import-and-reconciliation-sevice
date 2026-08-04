import { Controller, Get } from '@nestjs/common';
import { EventLoopMonitor } from '../../infrastructure/observability/event-loop-monitor';

@Controller()
export class HealthController {
  constructor(private readonly eventLoopMonitor: EventLoopMonitor) {}

  @Get('health/live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get('health/event-loop')
  eventLoop() {
    return this.eventLoopMonitor.snapshot() ?? { status: 'not-initialized' };
  }
}
