import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { LOGGER, METRICS_RECORDER } from '../application/ports/tokens';
import { type MetricsRecorderPort } from '../application/ports/metrics-recorder.port';
import { type LoggerPort } from 'src/application/ports/logger.port';

const PORT = Number(process.env.WORKER_METRICS_PORT ?? 3001);

@Injectable()
export class WorkerMetricsServer
  implements OnModuleInit, OnApplicationShutdown
{
  private server: Server | null = null;

  constructor(
    @Inject(METRICS_RECORDER) private readonly metrics: MetricsRecorderPort,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    this.server = createServer((req, res) => {
      void this.handle(req.url ?? '/', res);
    });
    this.server.listen(PORT, () => {
      this.logger.info('Worker metrics endpoint listening', { port: PORT });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = null;
  }

  private async handle(
    url: string,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    if (url.startsWith('/metrics')) {
      const body = await this.metrics.render();
      res.writeHead(200, { 'Content-Type': this.metrics.contentType() });
      res.end(body);
      return;
    }

    if (url.startsWith('/health/live')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptimeSeconds: Math.floor(process.uptime()),
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  }
}
