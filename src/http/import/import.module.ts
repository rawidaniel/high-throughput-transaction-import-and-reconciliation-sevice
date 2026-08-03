import { Module } from '@nestjs/common';
import { CreateImportUseCase } from '../../application/use-cases/create-import.use-case';
import { RepositoryModule } from '../../modules/repository.module';
import { StorageModule } from '../../modules/storage.module';
import { SystemModule } from '../../modules/system.module';
import { ImportController } from './import.controller';
import { GetImportStatusUseCase } from '../../application/use-cases/get-import-status.use-case';

@Module({
  imports: [StorageModule, SystemModule, RepositoryModule],
  controllers: [ImportController],
  providers: [CreateImportUseCase, GetImportStatusUseCase],
})
export default class ImportModule {}
