import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { LoggerPort } from './application/ports/logger.port';
import { LOGGER } from './application/ports/tokens';
import { ShutdownState } from './application/shutdown/shutdown-state';
import { registerGracefulShutdown } from './shutdown/graceful-shutdown';
import { setupSwagger } from './swagger';

const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 15_000);

async function bootstrap() {
  const adapter = new FastifyAdapter({
    genReqId: () => randomUUID(),
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  );

  await app.register(multipart, {
    limits: {
      fileSize: parseInt(process.env.MAX_UPLOAD_BYTES || '500') * 1024 * 1024,
      files: 1,
    },
    throwFileSizeLimit: true,
  });

  app.enableShutdownHooks();
  setupSwagger(app);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');

  const logger = app.get<LoggerPort>(LOGGER);
  const shutdownState = app.get(ShutdownState);

  registerGracefulShutdown({
    processName: 'api',
    graceMs: SHUTDOWN_GRACE_MS,
    context: app,
    logger,
    shutdownState,
    steps: [
      {
        name: 'drain-readiness',
        run: () => sleep(Number(process.env.SHUTDOWN_DRAIN_MS ?? 3000)),
      },
      {
        name: 'close-http-server',
        run: async () => {
          await app.getHttpAdapter().getInstance().close();
        },
      },
    ],
  });

  console.log('API listening', { port: process.env.PORT ?? 3000 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

bootstrap();
