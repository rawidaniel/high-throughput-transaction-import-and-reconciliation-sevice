import { Injectable } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { wrapDatabaseError } from 'src/domain/domain-errors';
import {
  ClaimedJob,
  JobRepositoryPort,
  JobStatus,
} from '../../application/ports/job-repository.port';
import { PrismaService } from '../prisma/prisma.service';

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
        workerId,
      };
    } catch (err) {
      throw wrapDatabaseError(err, 'JobRepository.claimNext');
    }
  }

  async renewLease(
    jobId: string,
    workerId: string,
    leaseDurationMs: number,
  ): Promise<void> {
    const leaseSeconds = Math.max(1, Math.ceil(leaseDurationMs / 1000));
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE processing_jobs
        SET "leasedUntil" = now() + (${leaseSeconds} || ' seconds')::interval,
            "updatedAt" = now()
        WHERE id = ${jobId} AND "leasedBy" = ${workerId};
      `);
    } catch (err) {
      throw wrapDatabaseError(err, 'JobRepository.renewLease');
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

  async markProcessing(
    jobId: string,
    importId: string,
    totalRecords: number,
  ): Promise<void> {
    await this.updateBoth(
      jobId,
      importId,
      { status: 'PROCESSING' },
      { status: 'PROCESSING', startedAt: new Date(), totalRecords },
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

  async releaseLease(jobId: string, workerId: string): Promise<void> {
    try {
      const released = await this.prisma.processingJob.updateMany({
        where: {
          id: jobId,
          leasedBy: workerId,
          status: { in: ['CLAIMED', 'PROCESSING'] },
        },
        data: { status: 'PENDING', leasedBy: null, leasedUntil: null },
      });

      if (released.count > 0) {
        const job = await this.prisma.processingJob.findUnique({
          where: { id: jobId },
          select: { importId: true },
        });
        if (job) {
          await this.prisma.import.updateMany({
            where: { id: job.importId, status: 'PROCESSING' },
            data: { status: 'PENDING' },
          });
        }
      }
    } catch (err) {
      throw wrapDatabaseError(err, 'JobRepository.releaseLease');
    }
  }

  async reclaimExpiredLeases(
    maxAttempts: number,
  ): Promise<{ reset: number; failed: number }> {
    try {
      const now = new Date();

      const expired = await this.prisma.processingJob.findMany({
        where: {
          status: { in: ['CLAIMED', 'PROCESSING'] },
          leasedUntil: { lt: now },
        },
        select: { id: true, importId: true, attemptCount: true },
      });

      if (expired.length === 0) {
        return { reset: 0, failed: 0 };
      }

      const toFail = expired.filter((j) => j.attemptCount >= maxAttempts);
      const toReset = expired.filter((j) => j.attemptCount < maxAttempts);

      const failureReason =
        'Abandoned by a crashed worker; exceeded max attempts.';

      await this.prisma.$transaction(async (tx) => {
        if (toFail.length > 0) {
          await tx.processingJob.updateMany({
            where: { id: { in: toFail.map((j) => j.id) } },
            data: {
              status: 'FAILED',
              leasedBy: null,
              leasedUntil: null,
              lastError: failureReason,
            },
          });
          await tx.import.updateMany({
            where: { id: { in: toFail.map((j) => j.importId) } },
            data: { status: 'FAILED', failureReason, completedAt: now },
          });
        }

        if (toReset.length > 0) {
          await tx.processingJob.updateMany({
            where: { id: { in: toReset.map((j) => j.id) } },
            data: { status: 'PENDING', leasedBy: null, leasedUntil: null },
          });

          await tx.import.updateMany({
            where: {
              id: { in: toReset.map((j) => j.importId) },
              status: 'PROCESSING',
            },
            data: { status: 'PENDING' },
          });
        }
      });

      return { reset: toReset.length, failed: toFail.length };
    } catch (err) {
      throw wrapDatabaseError(err, 'JobRepository.reclaimExpiredLeases');
    }
  }

  private async updateBoth(
    jobId: string,
    importId: string,
    jobData: Prisma.ProcessingJobUpdateInput,
    importData: Prisma.ImportUpdateInput,
  ): Promise<void> {
    try {
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
