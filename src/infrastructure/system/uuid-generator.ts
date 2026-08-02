import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IdGeneratorPort } from '../../application/ports/id-generator.port';

@Injectable()
export class UuidGenerator implements IdGeneratorPort {
  generate(): string {
    return randomUUID();
  }
}
