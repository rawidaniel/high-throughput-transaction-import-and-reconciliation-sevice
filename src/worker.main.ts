import { NestFactory } from '@nestjs/core';
import 'dotenv/config';
import { LoggerPort } from './application/ports/logger.port';
import { RiskScoringPoolPort } from './application/ports/risk-scoring-pool.port';
import { LOGGER, RISK_SCORING_POOL } from './application/ports/tokens';
import { ShutdownState } from './application/shutdown/shutdown-state';
import { RuntimeMetricsSampler } from './infrastructure/observability/runtime-metrics-sampler';
import { registerGracefulShutdown } from './shutdown/graceful-shutdown';
import { JobPollerService } from './worker/job-poller.service';
import { WorkerModule } from './worker/worker.module';

const SHUTDOWN_GRACE_MS = Number(
  process.env.WORKER_SHUTDOWN_GRACE_MS ?? 30_000,
);

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(WorkerModule);
  appContext.enableShutdownHooks();

  const poller = appContext.get(JobPollerService);
  const scoringPool = appContext.get<RiskScoringPoolPort>(RISK_SCORING_POOL);
  const logger = appContext.get<LoggerPort>(LOGGER);
  const shutdownState = appContext.get(ShutdownState);

  appContext.get(RuntimeMetricsSampler);

  registerGracefulShutdown({
    processName: 'worker',
    graceMs: SHUTDOWN_GRACE_MS,
    context: appContext,
    logger,
    shutdownState,
    steps: [
      {
        name: 'stop-poller-and-release-lease',
        run: () => poller.stop(),
      },
      {
        name: 'shutdown-scoring-pool',
        run: () => scoringPool.shutdown(),
      },
    ],
  });

  poller.start();

  logger.info('Worker started', {
    pid: process.pid,
    metricsPort: process.env.WORKER_METRICS_PORT ?? 3001,
  });
}

bootstrap();
