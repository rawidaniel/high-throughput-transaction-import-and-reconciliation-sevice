import { Global, Module } from '@nestjs/common';
import { ShutdownState } from '../application/shutdown/shutdown-state';

@Global()
@Module({
  providers: [ShutdownState],
  exports: [ShutdownState],
})
export class ShutdownModule {}
