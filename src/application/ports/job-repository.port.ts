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
  workerId: string;
}

export interface JobRepositoryPort {
  claimNext(
    workerId: string,
    leaseDurationMs: number,
  ): Promise<ClaimedJob | null>;

  renewLease(
    jobId: string,
    workerId: string,
    leaseDurationMs: number,
  ): Promise<void>;

  getStatus(jobId: string): Promise<JobStatus | null>;

  markProcessing(
    jobId: string,
    importId: string,
    totalRecords: number,
  ): Promise<void>;
  markCompleted(jobId: string, importId: string): Promise<void>;
  markFailed(jobId: string, importId: string, reason: string): Promise<void>;
  markCancelled(jobId: string, importId: string): Promise<void>;

  releaseLease(jobId: string, workerId: string): Promise<void>;
  reclaimExpiredLeases(
    maxAttempts: number,
  ): Promise<{ reset: number; failed: number }>;
}
