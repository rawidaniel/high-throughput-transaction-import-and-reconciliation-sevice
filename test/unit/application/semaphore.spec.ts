import { Semaphore } from '../../../src/infrastructure/concurrency/semaphore';

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('Semaphore', () => {
  it('never exceeds the configured limit', async () => {
    const semaphore = new Semaphore(3);
    let concurrent = 0;
    let peak = 0;

    const task = () =>
      semaphore.run(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await tick();
        concurrent--;
      });

    await Promise.all(Array.from({ length: 20 }, task));

    expect(peak).toBe(3);
  });

  it('runs every task despite the limit', async () => {
    const semaphore = new Semaphore(2);
    let completed = 0;

    await Promise.all(
      Array.from({ length: 10 }, () =>
        semaphore.run(async () => {
          await tick();
          completed++;
        }),
      ),
    );

    expect(completed).toBe(10);
  });

  it('releases the slot even when a task throws', async () => {
    const semaphore = new Semaphore(1);

    await expect(
      semaphore.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
    expect(semaphore.inFlight).toBe(0);
  });

  it('reports in-flight and queue depth', async () => {
    const semaphore = new Semaphore(1);
    let release!: () => void;
    const blocker = semaphore.run(
      () => new Promise<void>((r) => (release = r)),
    );

    await tick();
    expect(semaphore.inFlight).toBe(1);

    const queued = semaphore.run(async () => {});
    await tick();
    expect(semaphore.queueDepth).toBe(1);

    release();
    await Promise.all([blocker, queued]);
    expect(semaphore.inFlight).toBe(0);
    expect(semaphore.queueDepth).toBe(0);
  });

  it('rejects an invalid limit', () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});
