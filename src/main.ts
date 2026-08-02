import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    genReqId: () => randomUUID(),
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
