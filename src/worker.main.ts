import { NestFactory } from '@nestjs/core';
import { JobPollerService } from './worker/job-poller.service';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(WorkerModule);
  const poller = appContext.get(JobPollerService);

  poller.start();

  const shutdown = async () => {
    await poller.stop();
    await appContext.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });

  process.on('SIGINT', () => {
    void shutdown();
  });
}

bootstrap();
