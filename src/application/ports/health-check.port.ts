export interface HealthCheckPort {
  pingDatabase(): Promise<boolean>;
  getQueueDepth(): Promise<{ pending: number; claimed: number }>;
  countActiveImports(): Promise<number>;
}
