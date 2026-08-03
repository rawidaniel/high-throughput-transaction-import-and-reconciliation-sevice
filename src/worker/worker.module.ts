import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  IMPORT_FILE_REPOSITORY,
  JOB_REPOSITORY,
  LINE_READER,
} from '../application/ports/tokens';
import { ProcessImportFileUseCase } from '../application/use-cases/process-import-file.use-case';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { ImportFileRepository } from '../infrastructure/repository/import-file.repository';
import { JobRepository } from '../infrastructure/repository/job.repository';
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
    { provide: LINE_READER, useClass: ReadlineLineReader },
    ProcessImportFileUseCase,
    JobPollerService,
  ],
  exports: [JobPollerService],
})
export class WorkerModule {}
