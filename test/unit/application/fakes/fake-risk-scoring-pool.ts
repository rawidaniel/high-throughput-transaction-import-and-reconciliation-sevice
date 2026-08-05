import {
  RiskScoringPoolPort,
  ScoringInput,
  ScoringOutput,
} from '../../../../src/application/ports/risk-scoring-pool.port';

export class FakeRiskScoringPool implements RiskScoringPoolPort {
  public batchSizes: number[] = [];
  public totalScored = 0;

  async scoreBatch(inputs: ScoringInput[]): Promise<ScoringOutput[]> {
    this.batchSizes.push(inputs.length);
    this.totalScored += inputs.length;
    return inputs.map((input) => ({
      fingerprint: input.fingerprint,
      score: 42,
      level: 'MEDIUM' as const,
    }));
  }

  async shutdown(): Promise<void> {}
}
