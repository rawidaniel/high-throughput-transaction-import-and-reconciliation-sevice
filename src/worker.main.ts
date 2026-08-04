import { NestFactory } from '@nestjs/core';
import 'dotenv/config';
import { RiskScoringPoolPort } from './application/ports/risk-scoring-pool.port';
import { RISK_SCORING_POOL } from './application/ports/tokens';
import { ShutdownState } from './application/shutdown/shutdown-state';
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
  const shutdownState = appContext.get(ShutdownState);

  registerGracefulShutdown({
    processName: 'worker',
    graceMs: SHUTDOWN_GRACE_MS,
    context: appContext,
    // logger,
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
  console.log('Worker started');
}

bootstrap();
