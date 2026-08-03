import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JOB_REPOSITORY } from '../application/ports/tokens';
import { type JobRepositoryPort } from '../application/ports/job-repository.port';
import { ProcessImportFileUseCase } from '../application/use-cases/process-import-file.use-case';

const POLL_INTERVAL_MS = 2000;
const LEASE_DURATION_MS = 2 * 60 * 1000;

@Injectable()
export class JobPollerService {
  private readonly workerId = `worker-${randomUUID()}`;
  private polling = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    @Inject(JOB_REPOSITORY) private readonly jobRepository: JobRepositoryPort,
    private readonly processImportFile: ProcessImportFileUseCase,
  ) {}

  start(): void {
    if (this.polling) return;
    this.polling = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.polling = false;
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    while (this.polling) {
      const job = await this.jobRepository.claimNext(
        this.workerId,
        LEASE_DURATION_MS,
      );

      if (!job) {
        await this.sleep(POLL_INTERVAL_MS);
        continue;
      }

      await this.processImportFile.execute(job);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
