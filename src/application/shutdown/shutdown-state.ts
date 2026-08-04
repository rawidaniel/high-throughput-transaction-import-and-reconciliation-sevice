import { Injectable } from '@nestjs/common';

@Injectable()
export class ShutdownState {
  private shuttingDown = false;
  private startedAt: Date | null = null;

  begin(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.startedAt = new Date();
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  get elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt.getTime() : 0;
  }
}
