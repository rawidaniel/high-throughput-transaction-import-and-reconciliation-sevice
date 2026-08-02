import { Module } from '@nestjs/common';
import { CLOCK, ID_GENERATOR } from '../application/ports/tokens';
import { SystemClock } from '../infrastructure/system/system-clock';
import { UuidGenerator } from '../infrastructure/system/uuid-generator';

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
  ],
  exports: [CLOCK, ID_GENERATOR],
})
export class SystemModule {}
