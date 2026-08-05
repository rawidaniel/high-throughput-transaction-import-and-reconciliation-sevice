import {
  ClaimedJob,
  JobRepositoryPort,
  JobStatus,
} from 'src/application/ports/job-repository.port';

export class FakeJobRepository implements JobRepositoryPort {
  public statuses = new Map<string, JobStatus>();
  public markedFailedReasons: string[] = [];
  public totalRecordsByJob = new Map<string, number>();

  async claimNext(): Promise<ClaimedJob | null> {
    return null;
  }
  async renewLease(): Promise<void> {}

  async getStatus(jobId: string): Promise<JobStatus | null> {
    return this.statuses.get(jobId) ?? null;
  }

  async markProcessing(
    jobId: string,
    _importId: string,
    totalRecords: number,
  ): Promise<void> {
    this.statuses.set(jobId, 'PROCESSING');
    this.totalRecordsByJob.set(jobId, totalRecords);
  }
  async markCompleted(jobId: string): Promise<void> {
    this.statuses.set(jobId, 'COMPLETED');
  }
  async markFailed(
    jobId: string,
    _importId: string,
    reason: string,
  ): Promise<void> {
    this.statuses.set(jobId, 'FAILED');
    this.markedFailedReasons.push(reason);
  }
  async markCancelled(jobId: string): Promise<void> {
    this.statuses.set(jobId, 'CANCELLED');
  }

  public releasedLeases: Array<{ jobId: string; workerId: string }> = [];
  public reclaimResult = { reset: 0, failed: 0 };
  public reclaimCalled = false;

  async releaseLease(jobId: string, workerId: string): Promise<void> {
    this.releasedLeases.push({ jobId, workerId });
    this.statuses.set(jobId, 'PENDING');
  }

  async reclaimExpiredLeases(): Promise<{ reset: number; failed: number }> {
    this.reclaimCalled = true;
    return this.reclaimResult;
  }
}
