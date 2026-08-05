export type ImportStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'CANCELLING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export const TERMINAL_STATUSES: readonly ImportStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

const ALLOWED_TRANSITIONS: Record<ImportStatus, readonly ImportStatus[]> = {
  PENDING: ['PROCESSING', 'CANCELLING', 'CANCELLED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED', 'CANCELLING', 'PENDING'],
  CANCELLING: ['CANCELLED', 'COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isTerminal(status: ImportStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: ImportStatus, to: ImportStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isCancellable(status: ImportStatus): boolean {
  return (
    status === 'PENDING' || status === 'PROCESSING' || status === 'CANCELLING'
  );
}
