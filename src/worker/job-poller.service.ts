import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ClaimedJob,
  type JobRepositoryPort,
} from '../application/ports/job-repository.port';
import { type LoggerPort } from '../application/ports/logger.port';
import { JOB_REPOSITORY, LOGGER } from '../application/ports/tokens';
import { ShutdownState } from '../application/shutdown/shutdown-state';
import { ProcessImportFileUseCase } from '../application/use-cases/process-import-file.use-case';
import { ShutdownInterruptedError } from '../domain/domain-errors';

const POLL_INTERVAL_MS = 2000;
const LEASE_DURATION_MS = Number(
  process.env.LEASE_DURATION_MS ?? 2 * 60 * 1000,
);
const MAX_JOB_ATTEMPTS = Number(process.env.MAX_JOB_ATTEMPTS ?? 3);
const RECLAIM_INTERVAL_MS = Number(process.env.RECLAIM_INTERVAL_MS ?? 30_000);

@Injectable()
export class JobPollerService implements OnModuleInit {
  private readonly workerId = `worker-${randomUUID()}`;
  private polling = false;
  z;
  private loopPromise: Promise<void> | null = null;

  private currentJob: ClaimedJob | null = null;
  private lastReclaimAt = Date.now();

  constructor(
    @Inject(JOB_REPOSITORY) private readonly jobRepository: JobRepositoryPort,
    private readonly processImportFile: ProcessImportFileUseCase,
    private readonly shutdownState: ShutdownState,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reclaim('startup');
  }

  private async reclaim(trigger: 'startup' | 'periodic'): Promise<void> {
    try {
      const { reset, failed } =
        await this.jobRepository.reclaimExpiredLeases(MAX_JOB_ATTEMPTS);
      if (reset > 0 || failed > 0) {
        this.logger.warn('Reclaimed jobs abandoned by crashed workers', {
          trigger,
          resetToPending: reset,
          markedFailed: failed,
          maxAttempts: MAX_JOB_ATTEMPTS,
        });
      }
    } catch (err) {
      this.logger.error(
        'LEASE RECLAIM FAILED — jobs from crashed workers may stay stuck until this is fixed',
        {
          trigger,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  start(): void {
    if (this.polling) return;
    this.polling = true;
    this.logger.info('Worker poller starting', { workerId: this.workerId });
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.polling = false;
    await this.loopPromise;

    if (this.currentJob) {
      this.logger.warn('Releasing lease on unfinished job during shutdown', {
        jobId: this.currentJob.id,
        importId: this.currentJob.importId,
        workerId: this.workerId,
      });
      try {
        await this.jobRepository.releaseLease(
          this.currentJob.id,
          this.workerId,
        );
      } catch (err) {
        this.logger.error(
          'Failed to release lease during shutdown; it will expire naturally',
          {
            jobId: this.currentJob.id,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
      this.currentJob = null;
    }

    this.logger.info('Worker poller stopped', { workerId: this.workerId });
  }

  private async loop(): Promise<void> {
    while (this.polling && !this.shutdownState.isShuttingDown) {
      let job: ClaimedJob | null = null;

      try {
        job = await this.jobRepository.claimNext(
          this.workerId,
          LEASE_DURATION_MS,
        );
      } catch (err) {
        this.logger.error('Failed to claim next job; retrying after interval', {
          error: err instanceof Error ? err.message : String(err),
        });
        await this.sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (!job) {
        if (Date.now() - this.lastReclaimAt > RECLAIM_INTERVAL_MS) {
          this.lastReclaimAt = Date.now();
          await this.reclaim('periodic');
        }
        await this.sleep(POLL_INTERVAL_MS);
        continue;
      }

      this.currentJob = job;
      this.logger.info('Claimed job', {
        jobId: job.id,
        importId: job.importId,
        attempt: job.attemptCount,
        workerId: this.workerId,
      });

      try {
        await this.processImportFile.execute(job);

        this.currentJob = null;
      } catch (err) {
        if (err instanceof ShutdownInterruptedError) {
          this.logger.info(
            'Job interrupted by shutdown; lease will be released',
            {
              jobId: job.id,
              importId: job.importId,
            },
          );
          break;
        }

        this.logger.error('Unexpected error escaped job processing', {
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
