import { Module } from '@nestjs/common';
import { FILE_STORAGE, HEALTH_CHECK } from '../application/ports/tokens';
import { HealthCheck } from '../infrastructure/repository/health-check';
import { DiskFileStorage } from '../infrastructure/storage/disk-file-storage';

@Module({
  providers: [
    { provide: FILE_STORAGE, useClass: DiskFileStorage },
    { provide: HEALTH_CHECK, useClass: HealthCheck },
  ],
  exports: [FILE_STORAGE, HEALTH_CHECK],
})
export class StorageModule {}
