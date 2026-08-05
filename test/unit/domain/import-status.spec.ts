import {
  canTransition,
  isCancellable,
  isTerminal,
  ImportStatus,
  TERMINAL_STATUSES,
} from '../../../src/domain/import/import-status';

const ALL: ImportStatus[] = [
  'PENDING',
  'PROCESSING',
  'CANCELLING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

describe('Import status — terminal states', () => {
  it.each(TERMINAL_STATUSES)('%s is terminal', (status) => {
    expect(isTerminal(status)).toBe(true);
  });

  it.each(['PENDING', 'PROCESSING', 'CANCELLING'] as ImportStatus[])(
    '%s is not terminal',
    (status) => {
      expect(isTerminal(status)).toBe(false);
    },
  );

  it.each(TERMINAL_STATUSES)('nothing can transition out of %s', (from) => {
    for (const to of ALL) {
      expect(canTransition(from, to)).toBe(false);
    }
  });
});

describe('Import status — allowed transitions', () => {
  it.each([
    ['PENDING', 'PROCESSING', 'worker claims the job'],
    ['PENDING', 'CANCELLING', 'cancelled before processing started'],
    ['PROCESSING', 'COMPLETED', 'stream finished'],
    ['PROCESSING', 'FAILED', 'unrecoverable error'],
    ['PROCESSING', 'CANCELLING', 'cancel requested mid-stream'],
    [
      'PROCESSING',
      'PENDING',
      'lease released on shutdown or reclaimed after crash',
    ],
    ['CANCELLING', 'CANCELLED', 'worker acknowledged the cancel'],
    [
      'CANCELLING',
      'COMPLETED',
      'stream finished before the cancel was observed',
    ],
  ] as Array<[ImportStatus, ImportStatus, string]>)(
    'allows %s → %s (%s)',
    (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    },
  );
});

describe('Import status — forbidden transitions', () => {
  it.each([
    ['COMPLETED', 'PROCESSING', 'a finished import cannot restart'],
    ['COMPLETED', 'PENDING', 'a finished import cannot be requeued'],
    [
      'FAILED',
      'PROCESSING',
      'a failed import needs a new job, not a status flip',
    ],
    ['CANCELLED', 'PROCESSING', 'a cancelled import cannot resume'],
    ['CANCELLED', 'COMPLETED', 'cancellation is final'],
    ['CANCELLING', 'PROCESSING', 'cancellation cannot be undone'],
    ['CANCELLING', 'PENDING', 'cancellation cannot be undone'],
    ['PENDING', 'COMPLETED', 'cannot complete without processing'],
  ] as Array<[ImportStatus, ImportStatus, string]>)(
    'forbids %s → %s (%s)',
    (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    },
  );
});

describe('Import status — cancellability', () => {
  it.each(['PENDING', 'PROCESSING'] as ImportStatus[])(
    '%s is cancellable',
    (status) => {
      expect(isCancellable(status)).toBe(true);
    },
  );

  it('CANCELLING is cancellable so a repeated cancel is idempotent', () => {
    expect(isCancellable('CANCELLING')).toBe(true);
  });

  it.each(TERMINAL_STATUSES)('%s is not cancellable', (status) => {
    expect(isCancellable(status)).toBe(false);
  });
});

describe('Import status — invariants across all pairs', () => {
  it('never allows a self-transition except PROCESSING→PENDING style resets', () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('every status is reachable from PENDING via some path', () => {
    const reachable = new Set<ImportStatus>(['PENDING']);
    let changed = true;
    while (changed) {
      changed = false;
      for (const from of [...reachable]) {
        for (const to of ALL) {
          if (canTransition(from, to) && !reachable.has(to)) {
            reachable.add(to);
            changed = true;
          }
        }
      }
    }
    for (const status of ALL) {
      expect(reachable.has(status)).toBe(true);
    }
  });
});
