import { Injectable } from '@nestjs/common';
import {
  ClaimedJob,
  JobRepositoryPort,
  JobStatus,
} from '../../application/ports/job-repository.port';
import { wrapDatabaseError } from 'src/domain/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface RawClaimRow {
  id: string;
  importId: string;
  status: string;
  attemptCount: number;
}

@Injectable()
export class JobRepository implements JobRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async claimNext(
    workerId: string,
    leaseDurationMs: number,
  ): Promise<ClaimedJob | null> {
    const leaseSeconds = Math.max(1, Math.ceil(leaseDurationMs / 1000));

    try {
      const rows = await this.prisma.$queryRaw<RawClaimRow[]>(Prisma.sql`
        UPDATE processing_jobs
        SET status = 'CLAIMED'::"JobStatus",
            "leasedBy" = ${workerId},
            "leasedUntil" = now() + (${leaseSeconds} || ' seconds')::interval,
            "attemptCount" = "attemptCount" + 1,
            "updatedAt" = now()
        WHERE id = (
          SELECT id FROM processing_jobs
          WHERE status = 'PENDING'::"JobStatus"
             OR (status = 'CLAIMED'::"JobStatus" AND "leasedUntil" < now())
          ORDER BY "createdAt"
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, "importId", status, "attemptCount";
      `);

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        importId: row.importId,
        status: row.status as JobStatus,
        attemptCount: row.attemptCount,
      };
    } catch (err) {
      throw wrapDatabaseError(err, 'JobRepository.claimNext');
    }
  }

  async getStatus(jobId: string): Promise<JobStatus | null> {
    try {
      const job = await this.prisma.processingJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      return (job?.status as JobStatus) ?? null;
    } catch (err) {
      throw wrapDatabaseError(err, 'JobRepository.getStatus');
    }
  }

  async markProcessing(jobId: string, importId: string): Promise<void> {
    await this.updateBoth(
      jobId,
      importId,
      { status: 'PROCESSING' },
      { status: 'PROCESSING', startedAt: new Date() },
    );
  }

  async markCompleted(jobId: string, importId: string): Promise<void> {
    await this.updateBoth(
      jobId,
      importId,
      { status: 'COMPLETED' },
      { status: 'COMPLETED', completedAt: new Date() },
    );
  }

  async markFailed(
    jobId: string,
    importId: string,
    reason: string,
  ): Promise<void> {
    await this.updateBoth(
      jobId,
      importId,
      { status: 'FAILED', lastError: reason },
      { status: 'FAILED', failureReason: reason, completedAt: new Date() },
    );
  }

  async markCancelled(jobId: string, importId: string): Promise<void> {
    await this.updateBoth(
      jobId,
      importId,
      { status: 'CANCELLED' },
      { status: 'CANCELLED', completedAt: new Date() },
    );
  }

  private async updateBoth(
    jobId: string,
    importId: string,
    jobData: Prisma.ProcessingJobUpdateInput,
    importData: Prisma.ImportUpdateInput,
  ): Promise<void> {
    try {
      // NOTE: these two updates are NOT wrapped in a single $transaction
      // here — a deliberate, documented simplification for this phase. A
      // crash between the two would leave imports/processing_jobs briefly
      // inconsistent; Phase 11's crash-recovery sweep is where that gets
      // fully closed. Worth calling out explicitly in your ADRs rather
      // than leaving it as a silent gap.
      await this.prisma.processingJob.update({
        where: { id: jobId },
        data: jobData,
      });
      await this.prisma.import.update({
        where: { id: importId },
        data: importData,
      });
    } catch (err) {
      throw wrapDatabaseError(err, 'JobRepository.updateBoth');
    }
  }
}
