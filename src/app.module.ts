import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';

import { AppExceptionFilter } from './http/common/filters/app-exception.filter';
import HealthModule from './http/health/health.module';
import ImportModule from './http/import/import.module';
import { ShutdownModule } from './modules/shutdown.module';
import { LOGGER } from './application/ports/tokens';
import { PinoLogger } from './infrastructure/system/pino-logger';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ImportModule,
    HealthModule,
    ShutdownModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: LOGGER, useClass: PinoLogger },
  ],
})
export class AppModule {}
