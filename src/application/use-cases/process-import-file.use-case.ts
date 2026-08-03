import { Inject, Injectable } from '@nestjs/common';
import { computeFingerprint } from '../../domain/transaction/compute-fingerprint';
import { parseNdjsonLine } from '../../domain/transaction/parse-ndjson-line';
import { validateTransaction } from '../../domain/transaction/validate-transaction';
import { type ImportFileRepositoryPort } from '../ports/import-file-repository.port';
import {
  ClaimedJob,
  type JobRepositoryPort,
} from '../ports/job-repository.port';
import { type LineReaderPort } from '../ports/line-reader.port';
import {
  type RiskScoringPoolPort,
  ScoringInput,
} from '../ports/risk-scoring-pool.port';
import {
  IMPORT_FILE_REPOSITORY,
  JOB_REPOSITORY,
  LINE_READER,
  RISK_SCORING_POOL,
} from '../ports/tokens';

const CANCELLATION_CHECK_INTERVAL = 500;
const SCORING_BATCH_SIZE = Number(process.env.SCORING_BATCH_SIZE ?? 500);

@Injectable()
export class ProcessImportFileUseCase {
  constructor(
    @Inject(IMPORT_FILE_REPOSITORY)
    private readonly importFileRepository: ImportFileRepositoryPort,
    @Inject(JOB_REPOSITORY) private readonly jobRepository: JobRepositoryPort,
    @Inject(LINE_READER) private readonly lineReader: LineReaderPort,
    @Inject(RISK_SCORING_POOL)
    private readonly riskScoringPool: RiskScoringPoolPort,
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
    await this.jobRepository.markProcessing(job.id, job.importId);

    let lineNumber = 0;
    // let acceptedCount = 0;
    // let rejectedCount = 0;
    let scoredCount = 0;
    let wasCancelled = false;

    // Accumulates validated records until SCORING_BATCH_SIZE is reached.
    let batch: ScoringInput[] = [];

    try {
      for await (const rawLine of this.lineReader.readLines(storagePath)) {
        lineNumber++;

        if (lineNumber % CANCELLATION_CHECK_INTERVAL === 0) {
          const status = await this.jobRepository.getStatus(job.id);
          if (status === 'CANCELLING') {
            wasCancelled = true;
            break;
          }
        }

        const result = parseNdjsonLine(rawLine, lineNumber);

        if (result.kind === 'blank') {
          continue;
        }

        if (result.kind === 'rejected') {
          //   rejectedCount++;

          continue;
        }

        const validation = validateTransaction(result.data, fallbackProvider);

        if (!validation.ok) {
          // rejectedCount++;
          console.warn('Rejected record during import processing', {
            importId: job.importId,
            lineNumber: result.lineNumber,
            errorCode: validation.errorCode,
            field: validation.field,
          });
          continue;
        }

        // acceptedCount++;
        batch.push({
          transaction: validation.transaction,
          fingerprint: computeFingerprint(validation.transaction),
        });

        if (batch.length >= SCORING_BATCH_SIZE) {
          const scored = await this.riskScoringPool.scoreBatch(batch);
          scoredCount += scored.length;
          console.log('11', { scoredCount });

          batch = [];
        }
      }

      if (batch.length > 0 && !wasCancelled) {
        const scored = await this.riskScoringPool.scoreBatch(batch);
        scoredCount += scored.length;
        console.log('222', { scoredCount });
        batch = [];
      }

      if (wasCancelled) {
        await this.jobRepository.markCancelled(job.id, job.importId);
      } else {
        await this.jobRepository.markCompleted(job.id, job.importId);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown streaming error.';

      await this.jobRepository.markFailed(job.id, job.importId, message);
    }
  }
}
