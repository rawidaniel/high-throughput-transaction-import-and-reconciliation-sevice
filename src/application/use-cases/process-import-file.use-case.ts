import { Inject, Injectable } from '@nestjs/common';
import { ShutdownInterruptedError } from '../../domain/domain-errors';
import { computeFingerprint } from '../../domain/transaction/compute-fingerprint';
import { parseNdjsonLine } from '../../domain/transaction/parse-ndjson-line';
import { validateTransaction } from '../../domain/transaction/validate-transaction';
import { Semaphore } from '../../infrastructure/concurrency/semaphore';
import { type ImportFileRepositoryPort } from '../ports/import-file-repository.port';
import {
  ClaimedJob,
  type JobRepositoryPort,
} from '../ports/job-repository.port';
import { type LineReaderPort } from '../ports/line-reader.port';
import { type LoggerPort } from '../ports/logger.port';
import {
  METRICS,
  type MetricsRecorderPort,
} from '../ports/metrics-recorder.port';
import { type RetryPolicyPort } from '../ports/retry-policy.port';
import {
  type RiskScoringPoolPort,
  ScoringInput,
} from '../ports/risk-scoring-pool.port';
import {
  IMPORT_FILE_REPOSITORY,
  JOB_REPOSITORY,
  LINE_READER,
  LOGGER,
  METRICS_RECORDER,
  RETRY_POLICY,
  RISK_SCORING_POOL,
  TRANSACTION_REPOSITORY,
} from '../ports/tokens';
import {
  RejectedRecordInput,
  ScoredTransaction,
  type TransactionRepositoryPort,
} from '../ports/transaction-repository.port';

const CANCELLATION_CHECK_INTERVAL = 500;
const BATCH_SIZE = Number(process.env.PERSIST_BATCH_SIZE ?? 500);

const MAX_CONCURRENT_PERSISTS = Number(
  process.env.MAX_CONCURRENT_PERSISTS ?? 2,
);

const HEARTBEAT_INTERVAL_MS = 30_000;
const LEASE_DURATION_MS = 2 * 60 * 1000;
const RAW_VALUE_CAP = 2000;

@Injectable()
export class ProcessImportFileUseCase {
  constructor(
    @Inject(JOB_REPOSITORY) private readonly jobRepository: JobRepositoryPort,
    @Inject(IMPORT_FILE_REPOSITORY)
    private readonly importFileRepository: ImportFileRepositoryPort,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactionRepository: TransactionRepositoryPort,
    @Inject(LINE_READER) private readonly lineReader: LineReaderPort,
    @Inject(RISK_SCORING_POOL)
    private readonly riskScoringPool: RiskScoringPoolPort,
    @Inject(RETRY_POLICY) private readonly retryPolicy: RetryPolicyPort,
    @Inject(METRICS_RECORDER) private readonly metrics: MetricsRecorderPort,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  async execute(job: ClaimedJob): Promise<void> {
    const fileLocation = await this.importFileRepository.findByImportId(
      job.importId,
    );
    if (!fileLocation) {
      await this.jobRepository.markFailed(
        job.id,
        job.importId,
        'Import file record not found.',
      );
      return;
    }

    const { storagePath, provider } = fileLocation;
    const fallbackProvider = provider ?? '';

    const totalRecords = await this.lineReader.countLines(storagePath);

    await this.jobRepository.markProcessing(job.id, job.importId, totalRecords);

    const persistLimiter = new Semaphore(MAX_CONCURRENT_PERSISTS);
    const inFlightPersists: Array<Promise<void>> = [];

    let lineNumber = 0;
    const totals = { inserted: 0, duplicates: 0, rejected: 0 };
    let wasCancelled = false;
    let lastHeartbeat = Date.now();

    // Accumulators for the current batch.
    let pendingScoring: ScoringInput[] = [];
    let pendingRejected: RejectedRecordInput[] = [];
    let pendingLineCount = 0;

    const flush = async (): Promise<void> => {
      if (pendingScoring.length === 0 && pendingRejected.length === 0) return;

      const scoringBatch = pendingScoring;
      const rejectedBatch = pendingRejected;
      const processedDelta = pendingLineCount;
      pendingScoring = [];
      pendingRejected = [];
      pendingLineCount = 0;

      const scoringStart = Date.now();
      const scored =
        scoringBatch.length > 0
          ? await this.riskScoringPool.scoreBatch(scoringBatch)
          : [];
      if (scoringBatch.length > 0) {
        this.metrics.observeHistogram(
          METRICS.SCORING_BATCH_DURATION,
          (Date.now() - scoringStart) / 1000,
        );
      }

      const scoredTransactions: ScoredTransaction[] = scoringBatch.map(
        (input, i) => ({
          transaction: input.transaction,
          fingerprint: input.fingerprint,
          riskScore: scored[i].score,
          riskLevel: scored[i].level,
        }),
      );

      const persistStart = Date.now();
      const persistPromise = persistLimiter.run(async () => {
        const result = await this.retryPolicy.execute(
          () =>
            this.transactionRepository.persistBatch({
              importId: job.importId,
              scored: scoredTransactions,
              rejected: rejectedBatch,
              processedDelta,
            }),
          {
            operation: 'persistBatch',
            onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
              this.metrics.incrementCounter(METRICS.RETRY_ATTEMPTS, {
                operation: 'persistBatch',
              });
              this.logger.warn(
                'Retrying batch persistence after transient failure',
                {
                  importId: job.importId,
                  attempt,
                  maxAttempts,
                  delayMs,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            },
          },
        );

        totals.inserted += result.insertedCount;
        totals.duplicates += result.duplicateCount;
        totals.rejected += result.rejectedCount;

        this.metrics.observeHistogram(
          METRICS.BATCH_PERSIST_DURATION,
          (Date.now() - persistStart) / 1000,
        );
        this.metrics.incrementCounter(
          METRICS.RECORDS_PROCESSED,
          {},
          processedDelta,
        );
        this.metrics.incrementCounter(
          METRICS.RECORDS_DUPLICATE,
          {},
          result.duplicateCount,
        );
        for (const r of rejectedBatch) {
          this.metrics.incrementCounter(METRICS.RECORDS_REJECTED, {
            error_code: r.errorCode,
          });
        }
      });

      inFlightPersists.push(persistPromise);
      await persistPromise;
    };

    try {
      for await (const rawLine of this.lineReader.readLines(storagePath)) {
        lineNumber++;

        if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
          await this.jobRepository.renewLease(
            job.id,
            job.workerId,
            LEASE_DURATION_MS,
          );
          lastHeartbeat = Date.now();
        }

        if (lineNumber % CANCELLATION_CHECK_INTERVAL === 0) {
          const status = await this.jobRepository.getStatus(job.id);
          if (status === 'CANCELLING') {
            wasCancelled = true;
            break;
          }
        }

        const parsed = parseNdjsonLine(rawLine, lineNumber);

        if (parsed.kind === 'blank') {
          continue;
        }

        pendingLineCount++;

        if (parsed.kind === 'rejected') {
          pendingRejected.push({
            lineNumber: parsed.lineNumber,
            errorCode: parsed.errorCode,
            message: parsed.message,
            rawValueTruncated: parsed.rawValueTruncated.slice(0, RAW_VALUE_CAP),
          });
        } else {
          const validation = validateTransaction(parsed.data, fallbackProvider);
          if (!validation.ok) {
            pendingRejected.push({
              lineNumber: parsed.lineNumber,
              errorCode: validation.errorCode,
              message: validation.message,
              rawValueTruncated: JSON.stringify(parsed.data).slice(
                0,
                RAW_VALUE_CAP,
              ),
            });
          } else {
            pendingScoring.push({
              transaction: validation.transaction,
              fingerprint: computeFingerprint(validation.transaction),
            });
          }
        }

        if (pendingScoring.length + pendingRejected.length >= BATCH_SIZE) {
          if (
            persistLimiter.queueDepth > 0 ||
            persistLimiter.inFlight >= MAX_CONCURRENT_PERSISTS
          ) {
            this.metrics.incrementCounter(METRICS.BACKPRESSURE_WAITS);
          }
          this.metrics.setGauge(
            METRICS.PERSIST_QUEUE_DEPTH,
            persistLimiter.queueDepth,
          );
          await flush();
        }
      }

      await flush();

      await Promise.all(inFlightPersists);

      if (wasCancelled) {
        await this.jobRepository.markCancelled(job.id, job.importId);
        this.metrics.incrementCounter(METRICS.IMPORTS_COMPLETED, {
          status: 'cancelled',
        });
      } else {
        await this.jobRepository.markCompleted(job.id, job.importId);
        this.metrics.incrementCounter(METRICS.IMPORTS_COMPLETED, {
          status: 'completed',
        });
      }

      this.logger.info('Finished processing import file', {
        importId: job.importId,
        totalLines: lineNumber,
        inserted: totals.inserted,
        duplicates: totals.duplicates,
        rejected: totals.rejected,
        cancelled: wasCancelled,
      });
    } catch (err) {
      await Promise.allSettled(inFlightPersists);

      if (err instanceof ShutdownInterruptedError) {
        this.logger.info(
          'Processing interrupted by shutdown; job will be retried',
          {
            importId: job.importId,
            lineNumber,
            processedBeforeInterrupt: totals.inserted,
          },
        );
        throw err;
      }

      const message =
        err instanceof Error ? err.message : 'Unknown processing error.';

      this.logger.error('Unexpected error while processing import file', {
        importId: job.importId,
        lineNumber,
        error: message,
      });
      await this.jobRepository.markFailed(job.id, job.importId, message);
      this.metrics.incrementCounter(METRICS.IMPORTS_COMPLETED, {
        status: 'failed',
      });
    }
  }
}
