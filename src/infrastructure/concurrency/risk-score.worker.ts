import { parentPort } from 'node:worker_threads';
import { computeRiskScore } from '../../domain/risk/compute-risk-score';
import {
  ScoringInput,
  ScoringOutput,
} from '../../application/ports/risk-scoring-pool.port';
import { ValidatedTransaction } from 'src/domain/transaction/transaction.entity';

interface TaskMessage {
  taskId: number;
  inputs: Array<
    Omit<ScoringInput, 'transaction'> & { transaction: ValidatedTransaction }
  >;
}

interface ResultMessage {
  taskId: number;
  ok: true;
  results: ScoringOutput[];
}

interface ErrorMessage {
  taskId: number;
  ok: false;
  error: string;
}

parentPort?.on('message', (message: TaskMessage) => {
  try {
    const results: ScoringOutput[] = message.inputs.map(
      ({ transaction, fingerprint }) => {
        const normalizedTransaction = {
          ...transaction,
          timestamp:
            transaction.timestamp instanceof Date
              ? transaction.timestamp
              : new Date(transaction.timestamp),
        };

        const assessment = computeRiskScore(normalizedTransaction, fingerprint);

        return { ...assessment, fingerprint };
      },
    );

    const response: ResultMessage = {
      taskId: message.taskId,
      ok: true,
      results,
    };
    parentPort?.postMessage(response);
  } catch (err) {
    const response: ErrorMessage = {
      taskId: message.taskId,
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown scoring error.',
    };
    parentPort?.postMessage(response);
  }
});
