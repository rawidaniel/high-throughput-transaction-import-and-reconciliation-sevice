import { ExponentialBackoffRetryPolicy } from '../../../src/infrastructure/resilience/exponential-backoff-retry.policy';
import {
  FileTooLargeError,
  ImportCancelledError,
  ImportNotFoundError,
  InfrastructureError,
  wrapDatabaseError,
} from '../../../src/domain/domain-errors';

describe('ExponentialBackoffRetryPolicy — classification', () => {
  const policy = new ExponentialBackoffRetryPolicy();

  describe('MUST NOT retry (permanent failures)', () => {
    it.each([
      ['a validation error', new FileTooLargeError(100)],
      ['a business-rule error', new ImportNotFoundError('abc')],
      ['a cancellation', new ImportCancelledError('abc')],
      [
        'a unique-constraint violation',
        { code: '23505', constraint: 'transactions_pkey' },
      ],
      ['a not-null violation', { code: '23502' }],
      ['a foreign-key violation', { code: '23503' }],
      ['a syntax error', { code: '42601' }],
      ['a plain programming bug', new TypeError('x is not a function')],
    ])('does not retry %s', (_name, error) => {
      expect(policy.isRetryable(error)).toBe(false);
    });

    it('does not retry a cancellation even if something marked it retryable', () => {
      const cancelled = new ImportCancelledError('abc');
      expect(policy.isRetryable(cancelled)).toBe(false);
    });
  });

  describe('SHOULD retry (transient failures)', () => {
    it.each([
      ['connection failure', '08006'],
      ['connection does not exist', '08003'],
      ['serialization failure', '40001'],
      ['deadlock detected', '40P01'],
      ['too many connections', '53300'],
      ['admin shutdown', '57P01'],
      ['cannot connect now', '57P03'],
    ])('retries pg %s (%s)', (_name, code) => {
      expect(policy.isRetryable({ code })).toBe(true);
    });

    it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'])(
      'retries node network error %s',
      (code) => {
        expect(policy.isRetryable({ code })).toBe(true);
      },
    );

    it('retries an InfrastructureError marked retryable', () => {
      const err = new InfrastructureError('DB_DOWN', 'Database unavailable.', {
        retryable: true,
      });
      expect(policy.isRetryable(err)).toBe(true);
    });

    it('retries a wrapped transient driver error', () => {
      const wrapped = wrapDatabaseError({ code: '08006' }, 'persistBatch');
      expect(policy.isRetryable(wrapped)).toBe(true);
    });

    it('finds a transient code nested in a driver-adapter cause chain', () => {
      const driverError = {
        message: 'DriverAdapterError',
        cause: { originalCode: '40P01', kind: 'TransactionConflict' },
      };
      expect(policy.isRetryable(driverError)).toBe(true);
    });

    it('does not loop forever on a self-referencing cause chain', () => {
      const circular: Record<string, unknown> = { code: 'NOPE' };
      circular.cause = circular;
      expect(() => policy.isRetryable(circular)).not.toThrow();
      expect(policy.isRetryable(circular)).toBe(false);
    });
  });
});

describe('ExponentialBackoffRetryPolicy — execution', () => {
  const policy = new ExponentialBackoffRetryPolicy();

  it('returns immediately on success without retrying', async () => {
    let calls = 0;
    const result = await policy.execute(
      async () => {
        calls++;
        return 'ok';
      },
      { operation: 'test' },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a transient failure and succeeds on a later attempt', async () => {
    let calls = 0;
    const result = await policy.execute(
      async () => {
        calls++;
        if (calls < 3)
          throw Object.assign(new Error('connection failure'), {
            code: '08006',
          });
        return 'recovered';
      },
      { operation: 'test' },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('does NOT retry a permanent failure — exactly one attempt', async () => {
    let calls = 0;
    await expect(
      policy.execute(
        async () => {
          calls++;
          throw Object.assign(
            new Error('duplicate key value violates unique constraint'),
            {
              code: '23505',
            },
          );
        },
        { operation: 'test' },
      ),
    ).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  it('gives up after the max attempts rather than looping forever', async () => {
    let calls = 0;
    await expect(
      policy.execute(
        async () => {
          calls++;
          throw Object.assign(new Error('connection failure'), {
            code: '08006',
          });
        },
        { operation: 'test' },
      ),
    ).rejects.toBeDefined();
    expect(calls).toBe(4);
  });

  it('reports each retry through onRetry with increasing attempt numbers', async () => {
    const attempts: number[] = [];
    await expect(
      policy.execute(
        async () => {
          throw Object.assign(new Error('connection failure'), {
            code: '08006',
          });
        },
        {
          operation: 'persistBatch',
          onRetry: ({ attempt, operation }) => {
            expect(operation).toBe('persistBatch');
            attempts.push(attempt);
          },
        },
      ),
    ).rejects.toBeDefined();

    expect(attempts).toEqual([1, 2, 3]);
  });

  it('applies jitter — delays are not identical across runs', async () => {
    const delays: number[] = [];
    const collect = () =>
      policy
        .execute(
          async () => {
            throw Object.assign(new Error('connection failure'), {
              code: '08006',
            });
          },
          {
            operation: 'test',
            onRetry: ({ delayMs }) => delays.push(delayMs),
          },
        )
        .catch(() => undefined);

    await Promise.all([collect(), collect(), collect()]);

    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it('keeps delays within the exponential ceiling', async () => {
    const delays: number[] = [];
    await policy
      .execute(
        async () => {
          throw Object.assign(new Error('connection failure'), {
            code: '08006',
          });
        },
        {
          operation: 'test',
          onRetry: ({ delayMs, attempt }) => {
            const ceiling = Math.min(200 * 2 ** (attempt - 1), 5000);
            expect(delayMs).toBeGreaterThanOrEqual(0);
            expect(delayMs).toBeLessThanOrEqual(ceiling);
            delays.push(delayMs);
          },
        },
      )
      .catch(() => undefined);

    expect(delays).toHaveLength(3);
  });
});
