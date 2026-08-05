import { PrometheusMetricsRecorder } from '../../../src/infrastructure/observability/prometheus-metrics-recorder';
import { METRICS } from '../../../src/application/ports/metrics-recorder.port';

describe('PrometheusMetricsRecorder — label cardinality guard', () => {
  let recorder: PrometheusMetricsRecorder;

  beforeEach(() => {
    recorder = new PrometheusMetricsRecorder();
    recorder.onModuleInit();
  });

  describe('rejects unbounded label NAMES', () => {
    it.each([
      'import_id',
      'importId',
      'transaction_id',
      'transactionId',
      'request_id',
      'merchant_id',
      'account_id',
      'id',
      'fingerprint',
      'idempotency_key',
    ])('throws when a metric uses "%s" as a label', (labelName) => {
      expect(() =>
        recorder.incrementCounter(METRICS.RECORDS_PROCESSED, {
          [labelName]: 'anything',
        }),
      ).toThrow(/forbidden high-cardinality label/);
    });
  });

  describe('rejects id-shaped label VALUES', () => {
    it('throws when a UUID is passed as a value under an innocuous label name', () => {
      expect(() =>
        recorder.incrementCounter(METRICS.RECORDS_PROCESSED, {
          source: '550e8400-e29b-41d4-a716-446655440000',
        }),
      ).toThrow(/UUID-shaped value/);
    });

    it('applies the same guard to gauges and histograms', () => {
      expect(() =>
        recorder.setGauge(METRICS.ACTIVE_IMPORTS, 1, {
          scope: '550e8400-e29b-41d4-a716-446655440000',
        }),
      ).toThrow(/UUID-shaped value/);

      expect(() =>
        recorder.observeHistogram(METRICS.BATCH_PERSIST_DURATION, 0.5, {
          batch: '550e8400-e29b-41d4-a716-446655440000',
        }),
      ).toThrow(/UUID-shaped value/);
    });
  });

  describe('permits bounded enumerations', () => {
    it.each([
      [METRICS.RECORDS_REJECTED, { error_code: 'INVALID_AMOUNT' }],
      [METRICS.IMPORTS_COMPLETED, { status: 'completed' }],
      [METRICS.RETRY_ATTEMPTS, { operation: 'persistBatch' }],
    ])('accepts %s with a bounded label', (metric, labels) => {
      expect(() => recorder.incrementCounter(metric, labels)).not.toThrow();
    });

    it('accepts gauges with type/mode/status labels', () => {
      expect(() =>
        recorder.setGauge(METRICS.PROCESS_MEMORY, 100, { type: 'rss' }),
      ).not.toThrow();
      expect(() =>
        recorder.setGauge(METRICS.PROCESS_CPU_MICROS, 5, { mode: 'user' }),
      ).not.toThrow();
      expect(() =>
        recorder.setGauge(METRICS.JOB_QUEUE_DEPTH, 3, { status: 'pending' }),
      ).not.toThrow();
    });

    it('accepts metrics with no labels at all', () => {
      expect(() =>
        recorder.incrementCounter(METRICS.RECORDS_PROCESSED),
      ).not.toThrow();
    });
  });

  describe('exposition', () => {
    it('renders Prometheus text format including default process metrics', async () => {
      recorder.incrementCounter(METRICS.RECORDS_PROCESSED, {}, 5);
      const output = await recorder.render();

      expect(recorder.contentType()).toContain('text/plain');
      expect(output).toContain('records_processed_total');
      expect(output).toContain('process_cpu_user_seconds_total');
    });
  });
});
