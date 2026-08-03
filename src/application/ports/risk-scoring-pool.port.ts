import { ValidatedTransaction } from '../../domain/transaction/transaction.entity';
import { RiskAssessment } from '../../domain/risk/compute-risk-score';

export interface ScoringInput {
  transaction: ValidatedTransaction;
  fingerprint: string;
}

export interface ScoringOutput extends RiskAssessment {
  fingerprint: string;
}

export interface RiskScoringPoolPort {
  scoreBatch(inputs: ScoringInput[]): Promise<ScoringOutput[]>;
  shutdown(): Promise<void>;
}
