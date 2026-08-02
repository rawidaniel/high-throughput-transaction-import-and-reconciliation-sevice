import { Module } from '@nestjs/common';
import { IMPORT_REPOSITORY } from '../application/ports/tokens';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { ImportRepository } from '../infrastructure/repository/import.repository';

@Module({
  imports: [PrismaModule],
  providers: [{ provide: IMPORT_REPOSITORY, useClass: ImportRepository }],
  exports: [IMPORT_REPOSITORY],
})
export class RepositoryModule {}
