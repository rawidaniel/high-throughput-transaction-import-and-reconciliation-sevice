import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  RiskScoringPoolPort,
  ScoringInput,
  ScoringOutput,
} from '../../application/ports/risk-scoring-pool.port';

const POOL_SIZE = Math.max(1, Number(process.env.WORKER_POOL_SIZE ?? 4));

interface PendingTask {
  inputs: ScoringInput[];
  resolve: (results: ScoringOutput[]) => void;
  reject: (err: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  current: { taskId: number; task: PendingTask } | null;
}

@Injectable()
export class WorkerThreadPool
  implements RiskScoringPoolPort, OnModuleInit, OnApplicationShutdown
{
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: PendingTask[] = [];
  private nextTaskId = 0;
  private shuttingDown = false;

  onModuleInit(): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.slots.push(this.spawnSlot());
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  async scoreBatch(inputs: ScoringInput[]): Promise<ScoringOutput[]> {
    if (this.shuttingDown) {
      throw new Error('Risk scoring pool is shutting down.');
    }
    if (inputs.length === 0) {
      return [];
    }

    return new Promise<ScoringOutput[]>((resolve, reject) => {
      this.queue.push({ inputs, resolve, reject });
      this.dispatch();
    });
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    while (this.queue.length > 0) {
      this.queue
        .shift()
        ?.reject(new Error('Risk scoring pool shut down before task ran.'));
    }

    await Promise.all(this.slots.map((slot) => slot.worker.terminate()));
    this.slots.length = 0;
  }

  private spawnSlot(): WorkerSlot {
    const workerPath = path.resolve(
      __dirname,
      'risk-score.worker' + path.extname(__filename),
    );

    const worker = new Worker(workerPath, {
      execArgv: /\.ts$/.test(__filename)
        ? ['--require', 'ts-node/register']
        : undefined,
    });

    const slot: WorkerSlot = { worker, busy: false, current: null };

    worker.on(
      'message',
      (message: {
        taskId: number;
        ok: boolean;
        results?: ScoringOutput[];
        error?: string;
      }) => {
        const current = slot.current;
        if (!current || current.taskId !== message.taskId) return;

        slot.current = null;
        slot.busy = false;

        if (message.ok && message.results) {
          current.task.resolve(message.results);
        } else {
          current.task.reject(
            new Error(message.error ?? 'Unknown scoring error.'),
          );
        }

        this.dispatch();
      },
    );

    worker.on('error', (err) => {
      slot.current?.task.reject(err);
      slot.current = null;
      slot.busy = false;
      this.replaceSlot(slot);
    });

    worker.on('exit', (code) => {
      if (this.shuttingDown || code === 0) return;
      slot.current?.task.reject(
        new Error(`Scoring worker exited unexpectedly with code ${code}.`),
      );
      slot.current = null;
      slot.busy = false;
      this.replaceSlot(slot);
    });

    return slot;
  }

  private replaceSlot(dead: WorkerSlot): void {
    if (this.shuttingDown) return;
    const index = this.slots.indexOf(dead);
    if (index === -1) return;
    this.slots[index] = this.spawnSlot();
    this.dispatch();
  }

  private dispatch(): void {
    if (this.shuttingDown) return;

    for (const slot of this.slots) {
      if (slot.busy) continue;
      const task = this.queue.shift();
      if (!task) return;

      const taskId = this.nextTaskId++;
      slot.busy = true;
      slot.current = { taskId, task };
      slot.worker.postMessage({ taskId, inputs: task.inputs });
    }
  }
}
