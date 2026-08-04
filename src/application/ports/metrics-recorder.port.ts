export interface MetricsRecorderPort {
  incrementCounter(
    name: string,
    labels?: Record<string, string>,
    value?: number,
  ): void;
  observeHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;

  render(): Promise<string>;
  contentType(): string;
}

export const METRICS = {
  IMPORTS_CREATED: 'imports_created_total',
  IMPORTS_COMPLETED: 'imports_completed_total',
  RECORDS_PROCESSED: 'records_processed_total',
  RECORDS_REJECTED: 'records_rejected_total',
  RECORDS_DUPLICATE: 'records_duplicate_total',
  BATCH_PERSIST_DURATION: 'batch_persist_duration_seconds',
  SCORING_BATCH_DURATION: 'scoring_batch_duration_seconds',
  ACTIVE_IMPORTS: 'active_imports',
  JOB_QUEUE_DEPTH: 'job_queue_depth',
  EVENT_LOOP_DELAY_P99: 'event_loop_delay_p99_ms',
  EVENT_LOOP_UTILIZATION: 'event_loop_utilization',
  EVENT_LOOP_DELAY_MEAN: 'event_loop_delay_mean_ms',
  EVENT_LOOP_DELAY_MAX: 'event_loop_delay_max_ms',
  PROCESS_MEMORY: 'process_memory_bytes',
  PROCESS_CPU_MICROS: 'process_cpu_micros',
  BACKPRESSURE_WAITS: 'backpressure_waits_total',
  PERSIST_QUEUE_DEPTH: 'persist_queue_depth',
  RETRY_ATTEMPTS: 'retry_attempts_total',
} as const;
