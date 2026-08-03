import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  IMPORT_FILE_REPOSITORY,
  JOB_REPOSITORY,
  LINE_READER,
  RISK_SCORING_POOL,
  TRANSACTION_REPOSITORY,
} from '../application/ports/tokens';
import { ProcessImportFileUseCase } from '../application/use-cases/process-import-file.use-case';
import { WorkerThreadPool } from '../infrastructure/concurrency/worker-thread-pool';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { ImportFileRepository } from '../infrastructure/repository/import-file.repository';
import { JobRepository } from '../infrastructure/repository/job.repository';
import { TransactionRepository } from '../infrastructure/repository/transaction.repository';
import { ReadlineLineReader } from '../infrastructure/streaming/readline-line-reader';
import { SystemModule } from '../modules/system.module';
import { JobPollerService } from '../worker/job-poller.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SystemModule,
  ],
  providers: [
    { provide: JOB_REPOSITORY, useClass: JobRepository },
    { provide: IMPORT_FILE_REPOSITORY, useClass: ImportFileRepository },
    { provide: TRANSACTION_REPOSITORY, useClass: TransactionRepository },
    { provide: LINE_READER, useClass: ReadlineLineReader },
    { provide: RISK_SCORING_POOL, useClass: WorkerThreadPool },
    ProcessImportFileUseCase,
    JobPollerService,
  ],
  exports: [JobPollerService],
})
export class WorkerModule {}
