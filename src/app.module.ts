import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppExceptionFilter } from './http/common/app-exception.filter';
import HealthModule from './http/health/health.module';
import ImportModule from './http/import/import.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ImportModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
