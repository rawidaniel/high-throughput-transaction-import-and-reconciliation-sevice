import { Module } from '@nestjs/common';
import { DiskFileStorage } from '../infrastructure/storage/disk-file-storage';
import { FILE_STORAGE } from '../application/ports/tokens';

@Module({
  providers: [{ provide: FILE_STORAGE, useClass: DiskFileStorage }],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
