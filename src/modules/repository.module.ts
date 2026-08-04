import { Module } from '@nestjs/common';
import { IMPORT_QUERY, IMPORT_REPOSITORY } from '../application/ports/tokens';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { ImportQuery } from '../infrastructure/repository/import-query';
import { ImportRepository } from '../infrastructure/repository/import.repository';

@Module({
  imports: [PrismaModule],
  providers: [
    { provide: IMPORT_REPOSITORY, useClass: ImportRepository },
    { provide: IMPORT_QUERY, useClass: ImportQuery },
  ],
  exports: [IMPORT_REPOSITORY, IMPORT_QUERY],
})
export class RepositoryModule {}
