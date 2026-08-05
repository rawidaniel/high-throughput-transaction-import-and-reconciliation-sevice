import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import {
  FILE_STORAGE,
  HEALTH_CHECK,
  LOGGER,
} from '../application/ports/tokens';
import { type FileStoragePort } from '../application/ports/file-storage.port';
import { type HealthCheckPort } from '../application/ports/health-check.port';
import { type LoggerPort } from '../application/ports/logger.port';

const SWEEP_INTERVAL_MS = Number(
  process.env.ORPHAN_SWEEP_INTERVAL_MS ?? 60 * 60 * 1000,
);

@Injectable()
export class OrphanFileSweeper implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStoragePort,
    @Inject(HEALTH_CHECK) private readonly healthCheck: HealthCheckPort,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<void> {
    try {
      const referenced = await this.healthCheck.listReferencedStoragePaths();
      const removed = await this.fileStorage.cleanupOrphans(referenced);

      if (removed > 0) {
        this.logger.warn('Removed orphaned upload files', { removed });
      }
    } catch (err) {
      // Maintenance failing must never affect processing.
      this.logger.error('Orphan file sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
