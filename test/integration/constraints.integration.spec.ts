import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ImportRepository } from '../../src/infrastructure/repository/import.repository';
import { TransactionRepository } from '../../src/infrastructure/repository/transaction.repository';
import {
  seedImport,
  startTestDatabase,
  stopTestDatabase,
  truncateAll,
} from './test-database';

jest.setTimeout(120_000);

describe('Integration — constraints and idempotency', () => {
  let prisma: PrismaClient;
  let importRepo: ImportRepository;
  let txRepo: TransactionRepository;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    importRepo = new ImportRepository(prisma as unknown as PrismaService);
    txRepo = new TransactionRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  describe('idempotency key uniqueness under CONCURRENT requests', () => {
    it('creates exactly ONE import when N identical requests race', async () => {
      const CONCURRENCY = 20;
      const key = 'concurrent-key-1';

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) =>
          importRepo.createOrReturnExisting({
            id: crypto.randomUUID(),
            createdAt: new Date(),
            idempotencyKey: key,
            file: {
              storagePath: `/tmp/f${i}.ndjson`,
              size: 100,
              checksum: `c${i}`,
            },
          }),
        ),
      );

      const created = results.filter((r) => r.isNew);
      expect(created).toHaveLength(1);

      const ids = new Set(results.map((r) => r.importRecord.id));
      expect(ids.size).toBe(1);

      expect(await prisma.import.count()).toBe(1);
      expect(await prisma.idempotencyKey.count()).toBe(1);
    });

    it('rolls back the whole transaction for losing racers — no orphan imports', async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          importRepo.createOrReturnExisting({
            id: crypto.randomUUID(),
            createdAt: new Date(),
            idempotencyKey: 'rollback-key',
            file: { storagePath: `/tmp/r${i}.ndjson`, size: 1, checksum: 'x' },
          }),
        ),
      );

      expect(await prisma.import.count()).toBe(1);
      expect(await prisma.importFile.count()).toBe(1);
      expect(await prisma.processingJob.count()).toBe(1);
    });

    it('returns the existing import for a sequential replay', async () => {
      const first = await importRepo.createOrReturnExisting({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        idempotencyKey: 'seq-key',
        file: { storagePath: '/tmp/a.ndjson', size: 1, checksum: 'a' },
      });

      const second = await importRepo.createOrReturnExisting({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        idempotencyKey: 'seq-key',
        file: { storagePath: '/tmp/b.ndjson', size: 1, checksum: 'b' },
      });

      expect(first.isNew).toBe(true);
      expect(second.isNew).toBe(false);
      expect(second.importRecord.id).toBe(first.importRecord.id);
    });

    it('allows different keys to create separate imports', async () => {
      await Promise.all(
        ['k1', 'k2', 'k3'].map((key) =>
          importRepo.createOrReturnExisting({
            id: crypto.randomUUID(),
            createdAt: new Date(),
            idempotencyKey: key,
            file: { storagePath: `/tmp/${key}.ndjson`, size: 1, checksum: key },
          }),
        ),
      );

      expect(await prisma.import.count()).toBe(3);
    });
  });

  describe('duplicate constraint on (provider, transactionId)', () => {
    function scored(transactionId: string, amount = 100) {
      return {
        transaction: {
          provider: 'acme',
          transactionId,
          accountId: 'acc-1',
          merchantId: 'merch-1',
          amount,
          currency: 'USD',
          timestamp: new Date('2026-01-15T10:00:00Z'),
          description: null,
        },
        fingerprint: `v1:${transactionId}`,
        riskScore: 42,
        riskLevel: 'MEDIUM' as const,
      };
    }

    it('silently skips duplicates within a single batch', async () => {
      const imp = await seedImport(prisma);

      const result = await txRepo.persistBatch({
        importId: imp.id,
        scored: [scored('t1'), scored('t2'), scored('t1')],
        rejected: [],
        processedDelta: 3,
      });

      expect(result.insertedCount).toBe(2);
      expect(result.duplicateCount).toBe(1);
      expect(await prisma.transaction.count()).toBe(2);
    });

    it('skips duplicates ACROSS batches — first write wins', async () => {
      const imp = await seedImport(prisma);

      await txRepo.persistBatch({
        importId: imp.id,
        scored: [scored('t1', 100)],
        rejected: [],
        processedDelta: 1,
      });

      const second = await txRepo.persistBatch({
        importId: imp.id,
        scored: [scored('t1', 999)],
        rejected: [],
        processedDelta: 1,
      });

      expect(second.insertedCount).toBe(0);
      expect(second.duplicateCount).toBe(1);

      const stored = await prisma.transaction.findFirst({
        where: { transactionId: 't1' },
      });
      expect(Number(stored?.amount)).toBe(100);
    });

    it('enforces the constraint ACROSS DIFFERENT imports', async () => {
      const first = await seedImport(prisma);
      const second = await seedImport(prisma);

      await txRepo.persistBatch({
        importId: first.id,
        scored: [scored('shared-txn')],
        rejected: [],
        processedDelta: 1,
      });

      const result = await txRepo.persistBatch({
        importId: second.id,
        scored: [scored('shared-txn')],
        rejected: [],
        processedDelta: 1,
      });

      expect(result.duplicateCount).toBe(1);
      expect(await prisma.transaction.count()).toBe(1);
    });

    it('treats the same transactionId from a DIFFERENT provider as distinct', async () => {
      const imp = await seedImport(prisma);
      const other = {
        ...scored('t1'),
        transaction: { ...scored('t1').transaction, provider: 'other-bank' },
      };

      const result = await txRepo.persistBatch({
        importId: imp.id,
        scored: [scored('t1'), other],
        rejected: [],
        processedDelta: 2,
      });

      expect(result.insertedCount).toBe(2);
      expect(result.duplicateCount).toBe(0);
    });
  });
});
