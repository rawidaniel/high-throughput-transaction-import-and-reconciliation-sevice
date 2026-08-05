import { ProcessImportFileUseCase } from '../../../src/application/use-cases/process-import-file.use-case';

import { RetryPolicyPort } from 'src/application/ports/retry-policy.port';
import { ShutdownInterruptedError } from '../../../src/domain/domain-errors';
import { FakeImportFileRepository } from './fakes/fake-import-file-repository';
import { FakeJobRepository } from './fakes/fake-job-repository';
import { FakeLineReader } from './fakes/fake-line-reader';
import {
  FakeMetricsRecorder,
  FakeRetryPolicy,
  NoRetryPolicy,
} from './fakes/fake-resilience';
import { FakeRiskScoringPool } from './fakes/fake-risk-scoring-pool';
import { FakeTransactionRepository } from './fakes/fake-transaction-repository';
import { NoopLogger } from './fakes/fakes';

class CancellingJobRepository extends FakeJobRepository {
  private checkCount = 0;
  async getStatus(jobId: string) {
    this.checkCount++;
    if (this.checkCount === 1) return 'CANCELLING' as const;
    return super.getStatus(jobId);
  }
}

function validLine(i: number): string {
  return JSON.stringify({
    transactionId: `txn-${i}`,
    accountId: 'acc-1',
    merchantId: 'merch-1',
    amount: 100,
    currency: 'USD',
    timestamp: '2026-01-15T10:30:00Z',
  });
}

const JOB = {
  id: 'job-1',
  importId: 'import-1',
  status: 'CLAIMED' as const,
  attemptCount: 1,
  workerId: 'worker-1',
};

function build(
  lines: string[],
  jobRepository = new FakeJobRepository(),
  retryPolicy: RetryPolicyPort = new NoRetryPolicy(),
) {
  const lineReader = new FakeLineReader(lines);
  const pool = new FakeRiskScoringPool();
  const transactionRepository = new FakeTransactionRepository();
  const metrics = new FakeMetricsRecorder();
  const useCase = new ProcessImportFileUseCase(
    jobRepository,
    new FakeImportFileRepository(),
    transactionRepository,
    lineReader,
    pool,
    retryPolicy,
    metrics,
    new NoopLogger(),
  );
  return {
    useCase,
    jobRepository,
    lineReader,
    pool,
    transactionRepository,
    metrics,
  };
}

describe('ProcessImportFileUseCase (unit, fakes only)', () => {
  it('persists valid records and marks the job COMPLETED', async () => {
    const { useCase, jobRepository, transactionRepository } = build([
      validLine(1),
      '',
      validLine(2),
    ]);

    await useCase.execute(JOB);

    expect(jobRepository.statuses.get('job-1')).toBe('COMPLETED');
    expect(transactionRepository.totalPersisted).toBe(2);
  });

  it('routes malformed and invalid records to rejected, not to persistence', async () => {
    const { useCase, transactionRepository } = build([
      validLine(1),
      '{not json', // parse failure
      JSON.stringify({ transactionId: 'no-fields' }), // validation failure
    ]);

    await useCase.execute(JOB);

    expect(transactionRepository.totalPersisted).toBe(1);
    expect(transactionRepository.totalRejected).toBe(2);
  });

  it('flushes a final partial batch — small files are not dropped', async () => {
    const { useCase, transactionRepository } = build([
      validLine(1),
      validLine(2),
      validLine(3),
    ]);

    await useCase.execute(JOB);

    expect(transactionRepository.calls).toHaveLength(1);
    expect(transactionRepository.calls[0].scored).toHaveLength(3);
  });

  it('sets totalRecords from the counting pass, excluding blank lines', async () => {
    const { useCase, jobRepository } = build([
      validLine(1),
      '',
      '  ',
      validLine(2),
      validLine(3),
    ]);

    await useCase.execute(JOB);

    expect(jobRepository.totalRecordsByJob.get('job-1')).toBe(3);
  });

  it('reports processedDelta matching totalRecords at completion', async () => {
    const { useCase, jobRepository, transactionRepository } = build([
      validLine(1),
      '',
      '  ',
      validLine(2),
    ]);

    await useCase.execute(JOB);

    // Blank lines count toward NEITHER side, so the numerator can actually
    // reach the denominator — a progress bar hits 100%, not 50%.
    expect(transactionRepository.totalProcessedDelta).toBe(2);
    expect(jobRepository.totalRecordsByJob.get('job-1')).toBe(2);
  });

  it('counts rejected records toward progress, not just accepted ones', async () => {
    const { useCase, jobRepository, transactionRepository } = build([
      validLine(1),
      '{not json',
      JSON.stringify({ transactionId: 'incomplete' }),
    ]);

    await useCase.execute(JOB);

    expect(transactionRepository.totalProcessedDelta).toBe(3);
    expect(jobRepository.totalRecordsByJob.get('job-1')).toBe(3);
  });

  it('marks FAILED when no import file record exists', async () => {
    const jobRepository = new FakeJobRepository();
    const useCase = new ProcessImportFileUseCase(
      jobRepository,
      new FakeImportFileRepository(null),
      new FakeTransactionRepository(),
      new FakeLineReader([]),
      new FakeRiskScoringPool(),
      new NoRetryPolicy(),
      new FakeMetricsRecorder(),
      new NoopLogger(),
    );

    await useCase.execute({ ...JOB, id: 'job-2', importId: 'import-2' });

    expect(jobRepository.statuses.get('job-2')).toBe('FAILED');
    expect(jobRepository.markedFailedReasons[0]).toContain('not found');
  });

  it('marks FAILED with the underlying reason when a batch write fails', async () => {
    const { useCase, jobRepository, transactionRepository } = build([
      validLine(1),
    ]);
    transactionRepository.shouldThrow = new Error('connection lost');

    await useCase.execute(JOB);

    expect(jobRepository.statuses.get('job-1')).toBe('FAILED');
    expect(jobRepository.markedFailedReasons[0]).toContain('connection lost');
  });

  it('recovers from a transient batch-write failure via the retry policy', async () => {
    const retryPolicy = new FakeRetryPolicy(3, true);
    const { useCase, jobRepository, transactionRepository, metrics } = build(
      [validLine(1), validLine(2)],
      new FakeJobRepository(),
      retryPolicy,
    );

    // Fail the first attempt only, then succeed.
    let attempts = 0;
    const original = transactionRepository.persistBatch.bind(
      transactionRepository,
    );
    transactionRepository.persistBatch = async (input) => {
      attempts++;
      if (attempts === 1) {
        const transientError = Object.assign(new Error('connection failure'), {
          code: '08006',
        });
        throw transientError;
      }
      return original(input);
    };

    await useCase.execute(JOB);

    expect(jobRepository.statuses.get('job-1')).toBe('COMPLETED');
    expect(retryPolicy.retryCount).toBe(1);
    expect(metrics.countOf('retry_attempts_total')).toBe(1);
  });

  it('marks FAILED when retries are exhausted rather than looping forever', async () => {
    const retryPolicy = new FakeRetryPolicy(3, true);
    const { useCase, jobRepository, transactionRepository } = build(
      [validLine(1)],
      new FakeJobRepository(),
      retryPolicy,
    );
    transactionRepository.shouldThrow = new Error('database gone');

    await useCase.execute(JOB);

    expect(jobRepository.statuses.get('job-1')).toBe('FAILED');
    expect(jobRepository.markedFailedReasons[0]).toContain('database gone');

    expect(retryPolicy.retryCount).toBe(2);
  });

  it('does NOT mark the job FAILED when interrupted by shutdown', async () => {
    const { useCase, jobRepository, pool } = build([
      validLine(1),
      validLine(2),
    ]);

    pool.scoreBatch = async () => {
      throw new ShutdownInterruptedError('risk-scoring-pool');
    };

    await expect(useCase.execute(JOB)).rejects.toBeInstanceOf(
      ShutdownInterruptedError,
    );

    expect(jobRepository.statuses.get('job-1')).not.toBe('FAILED');
    expect(jobRepository.markedFailedReasons).toHaveLength(0);
  });

  it('still marks FAILED for genuine (non-shutdown) errors', async () => {
    const { useCase, jobRepository, transactionRepository } = build([
      validLine(1),
    ]);
    transactionRepository.shouldThrow = new Error('disk full');

    await useCase.execute(JOB);

    expect(jobRepository.statuses.get('job-1')).toBe('FAILED');
    expect(jobRepository.markedFailedReasons[0]).toContain('disk full');
  });

  it('stops cleanly and marks CANCELLED when cancellation is detected mid-stream', async () => {
    const lines = Array.from({ length: 1500 }, (_, i) => validLine(i));
    const { useCase, jobRepository, lineReader } = build(
      lines,
      new CancellingJobRepository(),
    );

    await useCase.execute({ ...JOB, id: 'job-3', importId: 'import-3' });

    expect(jobRepository.statuses.get('job-3')).toBe('CANCELLED');
    expect(lineReader.wasClosedEarly).toBe(true);
  });

  it('still persists work already done when cancelled — counters stay truthful', async () => {
    const lines = Array.from({ length: 1500 }, (_, i) => validLine(i));
    const { useCase, transactionRepository } = build(
      lines,
      new CancellingJobRepository(),
    );

    await useCase.execute({ ...JOB, id: 'job-4', importId: 'import-4' });

    expect(transactionRepository.totalPersisted).toBeGreaterThan(0);
  });
});
