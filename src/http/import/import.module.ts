import { Module } from '@nestjs/common';
import { CancelImportUseCase } from 'src/application/use-cases/cancel-import.use-case';
import { CreateImportUseCase } from '../../application/use-cases/create-import.use-case';
import { GetImportStatusUseCase } from '../../application/use-cases/get-import-status.use-case';
import { GetImportSummaryUseCase } from '../../application/use-cases/get-import-summary.use-case';
import { GetRejectedRecordsUseCase } from '../../application/use-cases/get-reject-transaction.use-case';
import { RepositoryModule } from '../../modules/repository.module';
import { StorageModule } from '../../modules/storage.module';
import { SystemModule } from '../../modules/system.module';
import { ImportController } from './import.controller';

@Module({
  imports: [StorageModule, SystemModule, RepositoryModule],
  controllers: [ImportController],
  providers: [
    CreateImportUseCase,
    GetImportStatusUseCase,
    CancelImportUseCase,
    GetImportSummaryUseCase,
    GetRejectedRecordsUseCase,
  ],
})
export default class ImportModule {}
