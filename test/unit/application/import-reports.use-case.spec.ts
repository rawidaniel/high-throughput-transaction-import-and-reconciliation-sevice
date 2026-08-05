import {
  GetImportSummaryUseCase,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from '../../../src/application/use-cases/get-import-summary.use-case';
import { CancelImportUseCase } from '../../../src/application/use-cases/cancel-import.use-case';
import { FakeImportRepository } from './fakes/fake-import-repository';
import { NoopLogger } from './fakes/fakes';
import {
  ImportQueryPort,
  ImportSummary,
  RejectedRecordPage,
} from '../../../src/application/ports/import-query.port';
import { ImportStatus } from '../../../src/application/ports/import-repository.port';

import { GetRejectedRecordsUseCase } from '../../../src/application/use-cases/get-reject-transaction.use-case';
import {
  ImportAlreadyFinishedError,
  ImportNotFoundError,
} from '../../../src/domain/domain-errors';

class FakeImportQuery implements ImportQueryPort {
  public lastLimit: number | null = null;
  public lastCursor: string | null = null;

  public summary: ImportSummary = {
    importId: 'import-1',
    totalTransactions: 0,
    totalAmount: 0,
    totals: { accepted: 0, rejected: 0, duplicated: 0 },
    byCurrency: [],
    byRiskLevel: [],
    topMerchants: [],
    earliestTransaction: null,
    latestTransaction: null,
  };

  async getSummary(): Promise<ImportSummary> {
    return this.summary;
  }

  async getRejectedRecords(
    _importId: string,
    cursor: string | null,
    limit: number,
  ): Promise<RejectedRecordPage> {
    this.lastCursor = cursor;
    this.lastLimit = limit;
    return { items: [], nextCursor: null };
  }
}

class CancellableImportRepository extends FakeImportRepository {
  constructor(private readonly resultStatus: ImportStatus) {
    super();
  }
  async requestCancellation(): Promise<ImportStatus> {
    return this.resultStatus;
  }
}

async function seededRepository() {
  const repo = new FakeImportRepository();
  await repo.createOrReturnExisting({
    id: 'import-1',
    createdAt: new Date(),
    idempotencyKey: 'k1',
    file: { storagePath: '/tmp/f', size: 1, checksum: 'c' },
  });
  return repo;
}

describe('GetRejectedRecordsUseCase — server-side limit capping', () => {
  it.each([
    ['an over-large limit is capped', 100_000, MAX_PAGE_SIZE],
    ['exactly the max is allowed', MAX_PAGE_SIZE, MAX_PAGE_SIZE],
    ['a reasonable limit passes through', 25, 25],
    ['undefined falls back to the default', undefined, DEFAULT_PAGE_SIZE],
    ['zero falls back to the default', 0, DEFAULT_PAGE_SIZE],
    ['a negative value falls back to the default', -5, DEFAULT_PAGE_SIZE],
    ['NaN falls back to the default', NaN, DEFAULT_PAGE_SIZE],
    ['a fractional limit is floored', 10.9, 10],
  ])('%s', async (_name, requested, expected) => {
    const query = new FakeImportQuery();
    const useCase = new GetRejectedRecordsUseCase(
      query,
      await seededRepository(),
    );

    await useCase.execute('import-1', null, requested as number | undefined);

    expect(query.lastLimit).toBe(expected);
  });

  it('passes the cursor through unchanged', async () => {
    const query = new FakeImportQuery();
    const useCase = new GetRejectedRecordsUseCase(
      query,
      await seededRepository(),
    );

    await useCase.execute('import-1', 'cursor-abc', 10);

    expect(query.lastCursor).toBe('cursor-abc');
  });

  it('rejects an unknown import rather than returning an empty page', async () => {
    const useCase = new GetRejectedRecordsUseCase(
      new FakeImportQuery(),
      new FakeImportRepository(),
    );
    await expect(useCase.execute('nope', null, 10)).rejects.toBeInstanceOf(
      ImportNotFoundError,
    );
  });
});

describe('GetImportSummaryUseCase', () => {
  it('rejects an unknown import rather than returning a zeroed summary', async () => {
    const useCase = new GetImportSummaryUseCase(
      new FakeImportQuery(),
      new FakeImportRepository(),
    );
    await expect(useCase.execute('nope')).rejects.toBeInstanceOf(
      ImportNotFoundError,
    );
  });
});

describe('CancelImportUseCase', () => {
  it('succeeds when the import transitions to CANCELLING', async () => {
    const useCase = new CancelImportUseCase(
      new CancellableImportRepository('CANCELLING'),
      new NoopLogger(),
    );
    await expect(useCase.execute('import-1')).resolves.toEqual({
      status: 'CANCELLING',
    });
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'] as ImportStatus[])(
    'refuses to cancel an import already in %s',
    async (status) => {
      const useCase = new CancelImportUseCase(
        new CancellableImportRepository(status),
        new NoopLogger(),
      );
      await expect(useCase.execute('import-1')).rejects.toBeInstanceOf(
        ImportAlreadyFinishedError,
      );
    },
  );
});
