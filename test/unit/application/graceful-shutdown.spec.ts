import { ClaimedJob } from '../../../src/application/ports/job-repository.port';
import { ShutdownState } from '../../../src/application/shutdown/shutdown-state';
import { ShutdownInterruptedError } from '../../../src/domain/domain-errors';
import { JobPollerService } from '../../../src/worker/job-poller.service';
import { FakeJobRepository } from './fakes/fake-job-repository';
import { NoopLogger } from './fakes/fakes';

class ScriptedJobRepository extends FakeJobRepository {
  public claimAttempts = 0;
  constructor(private readonly jobs: Array<ClaimedJob | null>) {
    super();
  }
  async claimNext(): Promise<ClaimedJob | null> {
    this.claimAttempts++;
    return this.jobs.shift() ?? null;
  }
}

class ControllableUseCase {
  public started = 0;
  public completed = 0;
  private release: (() => void) | null = null;
  private fail: ((err: Error) => void) | null = null;

  blockNext = false;

  async execute(): Promise<void> {
    this.started++;
    if (this.blockNext) {
      await new Promise<void>((resolve, reject) => {
        this.release = resolve;
        this.fail = reject;
      });
    }
    this.completed++;
  }

  finish(): void {
    this.release?.();
    this.release = null;
    this.fail = null;
  }

  abort(err: Error): void {
    this.fail?.(err);
    this.release = null;
    this.fail = null;
  }
}

function job(id: string): ClaimedJob {
  return {
    id,
    importId: `import-${id}`,
    status: 'CLAIMED',
    attemptCount: 1,
    workerId: 'w',
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('ShutdownState', () => {
  it('starts not shutting down', () => {
    expect(new ShutdownState().isShuttingDown).toBe(false);
  });

  it('flips once begin() is called', () => {
    const state = new ShutdownState();
    state.begin();
    expect(state.isShuttingDown).toBe(true);
  });

  it('is idempotent — a second begin() does not reset the clock', async () => {
    const state = new ShutdownState();
    state.begin();
    await tick();
    const first = state.elapsedMs;
    state.begin();
    expect(state.elapsedMs).toBeGreaterThanOrEqual(first);
  });
});

describe('JobPollerService — crash recovery on startup', () => {
  it('reclaims expired leases before polling begins', async () => {
    const repo = new ScriptedJobRepository([]);
    repo.reclaimResult = { reset: 3, failed: 1 };
    const poller = new JobPollerService(
      repo,
      new ControllableUseCase() as never,
      new ShutdownState(),
      new NoopLogger(),
    );

    await poller.onModuleInit();

    expect(repo.reclaimCalled).toBe(true);
  });

  it('still starts if the reclaim step fails', async () => {
    const repo = new ScriptedJobRepository([]);
    repo.reclaimExpiredLeases = async () => {
      throw new Error('db unavailable at boot');
    };
    const poller = new JobPollerService(
      repo,
      new ControllableUseCase() as never,
      new ShutdownState(),
      new NoopLogger(),
    );

    await expect(poller.onModuleInit()).resolves.toBeUndefined();
  });
});

describe('JobPollerService — graceful shutdown', () => {
  it('releases the lease on an unfinished job so it returns to PENDING', async () => {
    const repo = new ScriptedJobRepository([job('j1')]);
    const useCase = new ControllableUseCase();
    useCase.blockNext = true;

    const poller = new JobPollerService(
      repo,
      useCase as never,
      new ShutdownState(),
      new NoopLogger(),
    );
    poller.start();
    await tick();

    // Job is mid-processing at this point.
    expect(useCase.started).toBe(1);
    expect(useCase.completed).toBe(0);

    const stopping = poller.stop();

    useCase.abort(new ShutdownInterruptedError('risk-scoring-pool'));

    await stopping;

    expect(repo.releasedLeases).toHaveLength(1);
    expect(repo.releasedLeases[0].jobId).toBe('j1');
  });

  it('does NOT release a lease when the job completed normally', async () => {
    const repo = new ScriptedJobRepository([job('j2')]);
    const useCase = new ControllableUseCase();

    const poller = new JobPollerService(
      repo,
      useCase as never,
      new ShutdownState(),
      new NoopLogger(),
    );
    poller.start();
    await tick();
    await poller.stop();

    expect(useCase.completed).toBe(1);
    expect(repo.releasedLeases).toHaveLength(0);
  });

  it('stops claiming new jobs once shutdown begins', async () => {
    const shutdownState = new ShutdownState();
    const repo = new ScriptedJobRepository([]);
    const poller = new JobPollerService(
      repo,
      new ControllableUseCase() as never,
      shutdownState,
      new NoopLogger(),
    );

    poller.start();
    await tick();
    const attemptsBefore = repo.claimAttempts;

    shutdownState.begin();
    await poller.stop();
    await tick();

    expect(repo.claimAttempts).toBeLessThanOrEqual(attemptsBefore + 1);
  });

  it('survives a transient claim failure rather than crashing the loop', async () => {
    const repo = new ScriptedJobRepository([]);
    let calls = 0;
    repo.claimNext = async () => {
      calls++;
      if (calls === 1) throw new Error('connection reset');
      return null;
    };

    const poller = new JobPollerService(
      repo,
      new ControllableUseCase() as never,
      new ShutdownState(),
      new NoopLogger(),
    );

    poller.start();
    await tick();
    await expect(poller.stop()).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
