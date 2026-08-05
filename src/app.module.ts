import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: LOGGER, useClass: PinoLogger },
  ],
})
export class AppModule {}
