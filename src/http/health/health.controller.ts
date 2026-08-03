import { Controller, Get } from '@nestjs/common';
import { EventLoopMonitor } from '../../infrastructure/observability/event-loop-monitor';

@Controller('health')
export class HealthController {
  constructor(private readonly eventLoopMonitor: EventLoopMonitor) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('event-loop')
  eventLoop() {
    return this.eventLoopMonitor.snapshot() ?? { status: 'not-initialized' };
  }
}
