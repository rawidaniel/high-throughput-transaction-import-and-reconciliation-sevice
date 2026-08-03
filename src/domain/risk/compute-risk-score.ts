import { createHash } from 'node:crypto';
import { ValidatedTransaction } from '../transaction/transaction.entity';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
}

const WEIGHTS = {
  amount: 0.35,
  hour: 0.2,
  merchant: 0.2,
  description: 0.15,
  entropy: 0.1,
} as const;

const AMOUNT_SATURATION = 10_000;

const HASH_ROUNDS = Number(process.env.RISK_SCORING_HASH_ROUNDS ?? 600);

export function computeRiskScore(
  transaction: ValidatedTransaction,
  fingerprint: string,
): RiskAssessment {
  const amountSignal = scoreAmount(transaction.amount);
  const hourSignal = scoreHour(transaction.timestamp);
  const merchantSignal = scoreMerchant(transaction.merchantId);
  const descriptionSignal = scoreDescription(transaction.description);
  const entropySignal = scoreEntropy(fingerprint);

  const weighted =
    amountSignal * WEIGHTS.amount +
    hourSignal * WEIGHTS.hour +
    merchantSignal * WEIGHTS.merchant +
    descriptionSignal * WEIGHTS.description +
    entropySignal * WEIGHTS.entropy;

  const score = Math.round(clamp01(weighted) * 100 * 100) / 100; // 2dp

  return { score, level: toLevel(score) };
}

function scoreAmount(amount: number): number {
  const ratio = Math.min(amount, AMOUNT_SATURATION) / AMOUNT_SATURATION;
  return clamp01(Math.log10(1 + 9 * ratio)); // log10(1..10) -> 0..1
}

function scoreHour(timestamp: Date): number {
  const hour = timestamp.getUTCHours();
  const radians = ((hour - 2 + 24) % 24) * (Math.PI / 12);
  return clamp01((Math.cos(radians) + 1) / 2);
}

const MERCHANT_BUCKETS = 16;
function scoreMerchant(merchantId: string): number {
  const digest = createHash('sha256').update(merchantId, 'utf8').digest();
  const bucket = digest.readUInt16BE(0) % MERCHANT_BUCKETS;
  return bucket / (MERCHANT_BUCKETS - 1); // 0..1 across buckets
}

function scoreDescription(description: string | null): number {
  if (description === null) return 1;
  const length = description.length;
  if (length >= 40) return 0;
  return clamp01(1 - length / 40);
}

function scoreEntropy(fingerprint: string): number {
  let digest = createHash('sha256').update(fingerprint, 'utf8').digest();
  for (let i = 0; i < HASH_ROUNDS; i++) {
    digest = createHash('sha256').update(digest).digest();
  }
  return digest.readUInt32BE(0) / 0xffffffff;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toLevel(score: number): RiskLevel {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}
