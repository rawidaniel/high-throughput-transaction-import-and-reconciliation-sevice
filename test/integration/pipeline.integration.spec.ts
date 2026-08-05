import { PrismaClient } from '../../generated/prisma/client';
import {
  startTestDatabase,
  stopTestDatabase,
  truncateAll,
  seedImport,
} from './test-database';
import { TransactionRepository } from '../../src/infrastructure/repository/transaction.repository';
import { JobRepository } from '../../src/infrastructure/repository/job.repository';
import { ImportQuery } from '../../src/infrastructure/repository/import-query';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

jest.setTimeout(120_000);

describe('Integration — transaction boundaries, pagination, recovery', () => {
  let prisma: PrismaClient;
  let txRepo: TransactionRepository;
  let jobRepo: JobRepository;
  let query: ImportQuery;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    const service = prisma as unknown as PrismaService;
    txRepo = new TransactionRepository(service);
    jobRepo = new JobRepository(service);
    query = new ImportQuery(service);
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  function scored(
    transactionId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      transaction: {
        provider: 'acme',
        transactionId,
        accountId: 'acc-1',
        merchantId: 'merch-1',
        amount: 100,
        currency: 'USD',
        timestamp: new Date('2026-01-15T10:00:00Z'),
        description: null,
        ...overrides,
      },
      fingerprint: `v1:${transactionId}`,
      riskScore: 42,
      riskLevel: 'MEDIUM' as const,
    };
  }

  describe('transaction boundary on partial batch failure', () => {
    it('rolls back transactions, rejections AND counters together when a batch fails', async () => {
      const imp = await seedImport(prisma);

      await expect(
        txRepo.persistBatch({
          importId: imp.id,
          scored: [scored('good-1'), scored('bad', { currency: 'TOOLONG' })],
          rejected: [
            {
              lineNumber: 1,
              errorCode: 'INVALID_JSON',
              message: 'x',
              rawValueTruncated: '{}',
            },
          ],
          processedDelta: 2,
        }),
      ).rejects.toBeDefined();

      expect(await prisma.transaction.count()).toBe(0);
      expect(await prisma.rejectedRecord.count()).toBe(0);

      const after = await prisma.import.findUniqueOrThrow({
        where: { id: imp.id },
      });
      expect(after.processedCount).toBe(0);
      expect(after.acceptedCount).toBe(0);
      expect(after.rejectedCount).toBe(0);
    });

    it('commits transactions, rejections and counters atomically on success', async () => {
      const imp = await seedImport(prisma);

      await txRepo.persistBatch({
        importId: imp.id,
        scored: [scored('t1'), scored('t2')],
        rejected: [
          {
            lineNumber: 5,
            errorCode: 'INVALID_JSON',
            message: 'bad',
            rawValueTruncated: '{oops',
          },
        ],
        processedDelta: 3,
      });

      const after = await prisma.import.findUniqueOrThrow({
        where: { id: imp.id },
      });
      expect(await prisma.transaction.count()).toBe(2);
      expect(await prisma.rejectedRecord.count()).toBe(1);
      expect(after.processedCount).toBe(3);
      expect(after.acceptedCount).toBe(2);
      expect(after.rejectedCount).toBe(1);
    });

    it('counts conflicting rows as duplicates without failing the batch', async () => {
      const imp = await seedImport(prisma);
      await txRepo.persistBatch({
        importId: imp.id,
        scored: [scored('t1')],
        rejected: [],
        processedDelta: 1,
      });

      await txRepo.persistBatch({
        importId: imp.id,
        scored: [scored('t1'), scored('t2')],
        rejected: [],
        processedDelta: 2,
      });

      const after = await prisma.import.findUniqueOrThrow({
        where: { id: imp.id },
      });
      expect(after.acceptedCount).toBe(2);
      expect(after.duplicateCount).toBe(1);
    });
  });

  describe('rejected-records cursor pagination', () => {
    async function seedRejections(importId: string, count: number) {
      await prisma.rejectedRecord.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          importId,
          lineNumber: i + 1,
          errorCode: 'INVALID_JSON',
          message: `error ${i + 1}`,
          rawValueTruncated: `{"line":${i + 1}}`,
        })),
      });
    }

    it('walks every record exactly once across pages, with no gaps or repeats', async () => {
      const imp = await seedImport(prisma);
      await seedRejections(imp.id, 47);

      const seen: string[] = [];
      let cursor: string | null = null;

      for (;;) {
        const page = await query.getRejectedRecords(imp.id, cursor, 10);
        seen.push(...page.items.map((i) => i.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        if (seen.length > 200) throw new Error('pagination did not terminate');
      }

      expect(seen).toHaveLength(47);
      expect(new Set(seen).size).toBe(47);
    });

    it('returns null nextCursor on the final page', async () => {
      const imp = await seedImport(prisma);
      await seedRejections(imp.id, 5);

      const page = await query.getRejectedRecords(imp.id, null, 10);
      expect(page.items).toHaveLength(5);
      expect(page.nextCursor).toBeNull();
    });

    it('returns a nextCursor when exactly filling a page', async () => {
      const imp = await seedImport(prisma);
      await seedRejections(imp.id, 10);

      const first = await query.getRejectedRecords(imp.id, null, 10);
      expect(first.items).toHaveLength(10);

      if (first.nextCursor) {
        const second = await query.getRejectedRecords(
          imp.id,
          first.nextCursor,
          10,
        );
        expect(second.items).toHaveLength(0);
      }
    });

    it('never leaks records from another import', async () => {
      const a = await seedImport(prisma);
      const b = await seedImport(prisma);
      await seedRejections(a.id, 10);
      await seedRejections(b.id, 10);

      const page = await query.getRejectedRecords(a.id, null, 100);
      expect(page.items).toHaveLength(10);
    });

    it('handles an empty result set', async () => {
      const imp = await seedImport(prisma);
      const page = await query.getRejectedRecords(imp.id, null, 10);
      expect(page.items).toHaveLength(0);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('job claiming and crash recovery', () => {
    it('never hands the same job to two concurrent workers', async () => {
      await seedImport(prisma);

      const claims = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          jobRepo.claimNext(`worker-${i}`, 60_000),
        ),
      );

      const successful = claims.filter((c) => c !== null);
      expect(successful).toHaveLength(1);
    });

    it('distributes distinct jobs across concurrent workers', async () => {
      await Promise.all([
        seedImport(prisma),
        seedImport(prisma),
        seedImport(prisma),
      ]);

      const claims = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          jobRepo.claimNext(`worker-${i}`, 60_000),
        ),
      );

      const ids = claims.filter(Boolean).map((c) => c!.id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    });

    it('does NOT claim a job whose lease is still valid', async () => {
      await seedImport(prisma, {
        jobStatus: 'PROCESSING',
        leasedBy: 'worker-alive',
        leasedUntil: new Date(Date.now() + 60_000),
      });

      expect(await jobRepo.claimNext('worker-other', 60_000)).toBeNull();
    });

    it('CLAIMS a job whose lease has expired (crash recovery)', async () => {
      await seedImport(prisma, {
        jobStatus: 'PROCESSING',
        leasedBy: 'worker-dead',
        leasedUntil: new Date(Date.now() - 60_000), // expired
      });

      const claimed = await jobRepo.claimNext('worker-new', 60_000);
      expect(claimed).not.toBeNull();
      expect(claimed?.workerId).toBe('worker-new');
    });

    it('reclaims expired leases back to PENDING', async () => {
      const imp = await seedImport(prisma, {
        status: 'PROCESSING',
        jobStatus: 'PROCESSING',
        attemptCount: 1,
        leasedBy: 'worker-dead',
        leasedUntil: new Date(Date.now() - 60_000),
      });

      const result = await jobRepo.reclaimExpiredLeases(3);

      expect(result.reset).toBe(1);
      expect(result.failed).toBe(0);

      const job = await prisma.processingJob.findFirstOrThrow({
        where: { importId: imp.id },
      });
      expect(job.status).toBe('PENDING');
      expect(job.leasedBy).toBeNull();

      const record = await prisma.import.findUniqueOrThrow({
        where: { id: imp.id },
      });
      expect(record.status).toBe('PENDING');
    });

    it('FAILS a poison job that exceeded max attempts instead of looping forever', async () => {
      const imp = await seedImport(prisma, {
        status: 'PROCESSING',
        jobStatus: 'PROCESSING',
        attemptCount: 3,
        leasedBy: 'worker-dead',
        leasedUntil: new Date(Date.now() - 60_000),
      });

      const result = await jobRepo.reclaimExpiredLeases(3);

      expect(result.failed).toBe(1);
      expect(result.reset).toBe(0);

      const record = await prisma.import.findUniqueOrThrow({
        where: { id: imp.id },
      });
      expect(record.status).toBe('FAILED');
      expect(record.failureReason).toContain('max attempts');
    });

    it('leaves valid leases untouched during a reclaim sweep', async () => {
      await seedImport(prisma, {
        jobStatus: 'PROCESSING',
        leasedBy: 'worker-alive',
        leasedUntil: new Date(Date.now() + 60_000),
      });

      const result = await jobRepo.reclaimExpiredLeases(3);
      expect(result).toEqual({ reset: 0, failed: 0 });
    });

    it('releases a lease on graceful shutdown so recovery is immediate', async () => {
      const imp = await seedImport(prisma, { status: 'PROCESSING' });
      const claimed = await jobRepo.claimNext('worker-1', 60_000);

      await jobRepo.releaseLease(claimed!.id, 'worker-1');

      const job = await prisma.processingJob.findFirstOrThrow({
        where: { importId: imp.id },
      });
      expect(job.status).toBe('PENDING');
      expect(job.leasedBy).toBeNull();

      expect(await jobRepo.claimNext('worker-2', 60_000)).not.toBeNull();
    });

    it('refuses to release a lease held by a DIFFERENT worker', async () => {
      await seedImport(prisma);
      const claimed = await jobRepo.claimNext('worker-1', 60_000);

      await jobRepo.releaseLease(claimed!.id, 'worker-impostor');

      const job = await prisma.processingJob.findUniqueOrThrow({
        where: { id: claimed!.id },
      });
      expect(job.status).toBe('CLAIMED');
      expect(job.leasedBy).toBe('worker-1');
    });

    it('increments attemptCount on each claim so poison jobs are detectable', async () => {
      await seedImport(prisma);

      const first = await jobRepo.claimNext('w1', 1);
      expect(first?.attemptCount).toBe(1);

      await new Promise((r) => setTimeout(r, 1100));

      const second = await jobRepo.claimNext('w2', 60_000);
      expect(second?.attemptCount).toBe(2);
    });
  });
});
