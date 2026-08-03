export type JobStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'PROCESSING'
  | 'CANCELLING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ClaimedJob {
  id: string;
  importId: string;
  status: JobStatus;
  attemptCount: number;
}

export interface JobRepositoryPort {
  claimNext(
    workerId: string,
    leaseDurationMs: number,
  ): Promise<ClaimedJob | null>;

  getStatus(jobId: string): Promise<JobStatus | null>;

  markProcessing(jobId: string, importId: string): Promise<void>;
  markCompleted(jobId: string, importId: string): Promise<void>;
  markFailed(jobId: string, importId: string, reason: string): Promise<void>;
  markCancelled(jobId: string, importId: string): Promise<void>;
}
