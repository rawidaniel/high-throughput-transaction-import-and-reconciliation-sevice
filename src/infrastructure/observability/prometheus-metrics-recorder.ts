import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import {
  METRICS,
  MetricsRecorderPort,
} from '../../application/ports/metrics-recorder.port';

@Injectable()
export class PrometheusMetricsRecorder
  implements MetricsRecorderPort, OnModuleInit
{
  private readonly registry = new Registry();
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly gauges = new Map<string, Gauge>();

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry });
    this.registerAll();
  }

  private registerAll(): void {
    this.counter(METRICS.IMPORTS_CREATED, 'Imports created', ['outcome']);
    this.counter(
      METRICS.IMPORTS_COMPLETED,
      'Imports reaching a terminal state',
      ['status'],
    );
    this.counter(METRICS.RECORDS_PROCESSED, 'Records processed', []);
    this.counter(METRICS.RECORDS_REJECTED, 'Records rejected', ['error_code']);
    this.counter(
      METRICS.RECORDS_DUPLICATE,
      'Records skipped as duplicates',
      [],
    );

    this.histogram(
      METRICS.BATCH_PERSIST_DURATION,
      'Batch persistence duration',
      [],
      [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    );
    this.histogram(
      METRICS.SCORING_BATCH_DURATION,
      'Scoring batch duration',
      [],
      [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    );

    this.gauge(METRICS.ACTIVE_IMPORTS, 'Imports currently processing', []);
    this.gauge(METRICS.JOB_QUEUE_DEPTH, 'Jobs awaiting a worker', ['status']);
    this.gauge(METRICS.EVENT_LOOP_DELAY_P99, 'Event loop delay p99 (ms)', []);
    this.gauge(
      METRICS.EVENT_LOOP_UTILIZATION,
      'Event loop utilization (0-1)',
      [],
    );
  }

  incrementCounter(
    name: string,
    labels: Record<string, string> = {},
    value = 1,
  ): void {
    this.counters.get(name)?.inc(labels, value);
  }

  observeHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    this.histograms.get(name)?.observe(labels, value);
  }

  setGauge(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    this.gauges.get(name)?.set(labels, value);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }

  private counter(name: string, help: string, labelNames: string[]): void {
    this.counters.set(
      name,
      new Counter({ name, help, labelNames, registers: [this.registry] }),
    );
  }

  private histogram(
    name: string,
    help: string,
    labelNames: string[],
    buckets: number[],
  ): void {
    this.histograms.set(
      name,
      new Histogram({
        name,
        help,
        labelNames,
        buckets,
        registers: [this.registry],
      }),
    );
  }

  private gauge(name: string, help: string, labelNames: string[]): void {
    this.gauges.set(
      name,
      new Gauge({ name, help, labelNames, registers: [this.registry] }),
    );
  }
}
