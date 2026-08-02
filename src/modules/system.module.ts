import { Module } from '@nestjs/common';
import { CLOCK } from '../application/ports/tokens';
import { SystemClock } from '../infrastructure/system/system-clock';

@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class SystemModule {}
