import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ShutdownState } from 'src/application/shutdown/shutdown-state';
import {
  IMPORT_FILE_REPOSITORY,
  JOB_REPOSITORY,
  LINE_READER,
  LOGGER,
  METRICS_RECORDER,
  RETRY_POLICY,
  RISK_SCORING_POOL,
  TRANSACTION_REPOSITORY,
} from '../application/ports/tokens';
import { ProcessImportFileUseCase } from '../application/use-cases/process-import-file.use-case';
import { WorkerThreadPool } from '../infrastructure/concurrency/worker-thread-pool';
import { PrometheusMetricsRecorder } from '../infrastructure/observability/prometheus-metrics-recorder';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { ImportFileRepository } from '../infrastructure/repository/import-file.repository';
import { JobRepository } from '../infrastructure/repository/job.repository';
import { TransactionRepository } from '../infrastructure/repository/transaction.repository';
import { ExponentialBackoffRetryPolicy } from '../infrastructure/resilience/exponential-backoff-retry.policy';
import { ReadlineLineReader } from '../infrastructure/streaming/readline-line-reader';
import { PinoLogger } from '../infrastructure/system/pino-logger';
import { ResilienceModule } from '../modules/resilience.module';
import { SystemModule } from '../modules/system.module';
import { JobPollerService } from '../worker/job-poller.service';
import { WorkerMetricsServer } from './worker-metrics.server';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SystemModule,
    ResilienceModule,
  ],
  providers: [
    { provide: JOB_REPOSITORY, useClass: JobRepository },
    { provide: IMPORT_FILE_REPOSITORY, useClass: ImportFileRepository },
    { provide: TRANSACTION_REPOSITORY, useClass: TransactionRepository },
    { provide: LINE_READER, useClass: ReadlineLineReader },
    { provide: RISK_SCORING_POOL, useClass: WorkerThreadPool },
    { provide: RETRY_POLICY, useClass: ExponentialBackoffRetryPolicy },
    { provide: METRICS_RECORDER, useClass: PrometheusMetricsRecorder },
    { provide: LOGGER, useClass: PinoLogger },
    ProcessImportFileUseCase,
    JobPollerService,
    WorkerMetricsServer,
    ShutdownState,
  ],
  exports: [JobPollerService],
})
export class WorkerModule {}
