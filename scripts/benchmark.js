#!/usr/bin/env node

const fs = require('fs');
const os = require('os');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const FILE = args.file;
const API = args.api ?? 'http://localhost:3000';
const WORKER_METRICS = args.workerMetrics ?? 'http://localhost:3001/metrics';
const CONNECTIONS = Number(args.connections ?? 10);
const LOAD_SECONDS = Number(args.duration ?? 30);

if (!FILE || !fs.existsSync(FILE)) {
  console.error('Usage: node scripts/benchmark.js --file=<path-to.ndjson>');
  console.error(
    'Generate one first: npm run generate:data -- --records=500000',
  );
  process.exit(1);
}

function machineSpecs() {
  const cpus = os.cpus();
  return {
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    cpu: cpus[0]?.model?.trim() ?? 'unknown',
    cores: cpus.length,
    totalMemoryGb: (os.totalmem() / 1024 ** 3).toFixed(1),
    node: process.version,
  };
}

async function scrape(url) {
  try {
    const res = await fetch(url);
    return await res.text();
  } catch {
    return null;
  }
}

function metricValue(text, name, labelFilter) {
  if (!text) return null;
  const lines = text
    .split('\n')
    .filter((l) => l.startsWith(name) && !l.startsWith('#'));
  const match = labelFilter
    ? lines.find((l) => l.includes(labelFilter))
    : lines[0];
  if (!match) return null;
  const value = Number(match.split(/\s+/).pop());
  return Number.isFinite(value) ? value : null;
}

function histogramMean(text, name) {
  const sum = metricValue(text, `${name}_sum`);
  const count = metricValue(text, `${name}_count`);
  if (sum === null || !count) return null;
  return sum / count;
}

async function uploadFile() {
  const buffer = fs.readFileSync(FILE);
  const form = new FormData();
  form.append(
    'file',
    new Blob([buffer], { type: 'application/x-ndjson' }),
    'bench.ndjson',
  );

  const res = await fetch(`${API}/v1/imports`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `bench-${Date.now()}` },
    body: form,
  });

  if (!res.ok)
    throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function samplePeaks(state) {
  while (!state.done) {
    const workerText = await scrape(WORKER_METRICS);
    if (workerText) {
      const rss = metricValue(workerText, 'process_memory_bytes', 'type="rss"');
      const heap = metricValue(
        workerText,
        'process_memory_bytes',
        'type="heap_used"',
      );
      const loopP99 = metricValue(workerText, 'event_loop_delay_p99_ms');
      const loopMax = metricValue(workerText, 'event_loop_delay_max_ms');
      const backpressure = metricValue(workerText, 'backpressure_waits_total');

      if (rss !== null)
        state.peakRssMb = Math.max(state.peakRssMb, rss / 1024 / 1024);
      if (heap !== null)
        state.peakHeapMb = Math.max(state.peakHeapMb, heap / 1024 / 1024);
      if (loopP99 !== null)
        state.peakWorkerLoopP99 = Math.max(state.peakWorkerLoopP99, loopP99);
      if (loopMax !== null)
        state.peakWorkerLoopMax = Math.max(state.peakWorkerLoopMax, loopMax);
      if (backpressure !== null) state.backpressureWaits = backpressure;

      state.persistMean = histogramMean(
        workerText,
        'batch_persist_duration_seconds',
      );
      state.scoringMean = histogramMean(
        workerText,
        'scoring_batch_duration_seconds',
      );
    }

    const apiText = await scrape(`${API}/metrics`);
    const apiLoop = metricValue(apiText, 'event_loop_delay_p99_ms');
    if (apiLoop !== null)
      state.peakApiLoopP99 = Math.max(state.peakApiLoopP99, apiLoop);

    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function waitForCompletion(importId, state) {
  for (;;) {
    try {
      const res = await fetch(`${API}/v1/imports/${importId}`);
      const body = await res.json();
      state.lastStatus = body;
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(body.status))
        return body;
    } catch {
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function runAutocannon(importId) {
  let autocannon;
  try {
    autocannon = require('autocannon');
  } catch {
    console.warn(
      '\n⚠  autocannon not installed — skipping latency measurement.',
    );
    console.warn('   npm install -D autocannon\n');
    return null;
  }

  return autocannon({
    url: `${API}/v1/imports/${importId}`,
    connections: CONNECTIONS,
    duration: LOAD_SECONDS,
  });
}

function pad(label, value, width = 22) {
  return `  ${label.padEnd(width)} ${value}`;
}

(async () => {
  const specs = machineSpecs();
  const fileSizeMb = fs.statSync(FILE).size / 1024 / 1024;

  console.log('═'.repeat(72));
  console.log('LOAD BENCHMARK');
  console.log('═'.repeat(72));
  console.log(pad('File:', `${FILE} (${fileSizeMb.toFixed(1)} MB)`));
  console.log(pad('CPU:', specs.cpu));
  console.log(
    pad('Cores / Memory:', `${specs.cores} / ${specs.totalMemoryGb} GB`),
  );
  console.log(pad('Platform:', specs.platform));
  console.log(pad('Node:', specs.node));
  console.log('');

  console.log('Uploading...');
  const uploadStart = Date.now();
  const importId = await uploadFile();
  const uploadMs = Date.now() - uploadStart;
  console.log(
    `Import ${importId} accepted in ${(uploadMs / 1000).toFixed(1)}s\n`,
  );

  const state = {
    done: false,
    peakRssMb: 0,
    peakHeapMb: 0,
    peakWorkerLoopP99: 0,
    peakWorkerLoopMax: 0,
    peakApiLoopP99: 0,
    backpressureWaits: 0,
    persistMean: null,
    scoringMean: null,
    lastStatus: null,
  };

  const processingStart = Date.now();
  const sampling = samplePeaks(state);

  console.log(
    `Load-testing GET /v1/imports/:id (${CONNECTIONS} connections, ${LOAD_SECONDS}s) during processing...\n`,
  );
  const [latency] = await Promise.all([
    runAutocannon(importId),
    waitForCompletion(importId, state),
  ]);

  state.done = true;
  await sampling;

  const processingMs = Date.now() - processingStart;
  const final = state.lastStatus;
  const recordsPerSec = final.processedCount / (processingMs / 1000);

  console.log('\n' + '═'.repeat(72));
  console.log('RESULTS');
  console.log('═'.repeat(72));

  console.log('\nTHROUGHPUT');
  console.log(pad('Status:', final.status));
  console.log(pad('Upload time:', `${(uploadMs / 1000).toFixed(1)} s`));
  console.log(pad('Processing time:', `${(processingMs / 1000).toFixed(1)} s`));
  console.log(pad('Records/sec:', Math.round(recordsPerSec).toLocaleString()));
  console.log(
    pad('Total records:', (final.totalRecords ?? 0).toLocaleString()),
  );
  console.log(pad('Processed:', (final.processedCount ?? 0).toLocaleString()));
  console.log(pad('Accepted:', (final.acceptedCount ?? 0).toLocaleString()));
  console.log(pad('Rejected:', (final.rejectedCount ?? 0).toLocaleString()));
  console.log(pad('Duplicates:', (final.duplicateCount ?? 0).toLocaleString()));

  console.log('\nWORKER RESOURCES');
  console.log(pad('Peak RSS:', `${state.peakRssMb.toFixed(1)} MB`));
  console.log(pad('Peak heap used:', `${state.peakHeapMb.toFixed(1)} MB`));
  console.log(
    pad('Peak loop p99:', `${state.peakWorkerLoopP99.toFixed(2)} ms`),
  );
  console.log(
    pad('Peak loop max:', `${state.peakWorkerLoopMax.toFixed(2)} ms`),
  );
  console.log(
    pad('Backpressure waits:', state.backpressureWaits.toLocaleString()),
  );

  console.log('\nAPI RESPONSIVENESS (under worker load)');
  console.log(pad('Peak loop p99:', `${state.peakApiLoopP99.toFixed(2)} ms`));
  if (latency) {
    console.log(pad('Requests/sec:', latency.requests.average.toFixed(0)));
    console.log(pad('Latency mean:', `${latency.latency.mean.toFixed(2)} ms`));
    console.log(pad('Latency p50:', `${latency.latency.p50} ms`));
    console.log(pad('Latency p99:', `${latency.latency.p99} ms`));
    console.log(pad('Latency max:', `${latency.latency.max} ms`));
    console.log(
      pad('Errors / non-2xx:', `${latency.errors} / ${latency.non2xx}`),
    );
  }

  console.log('\nSTAGE TIMINGS (mean per batch)');
  console.log(
    pad(
      'Batch persist:',
      state.persistMean !== null
        ? `${(state.persistMean * 1000).toFixed(1)} ms`
        : 'n/a',
    ),
  );
  console.log(
    pad(
      'Risk scoring:',
      state.scoringMean !== null
        ? `${(state.scoringMean * 1000).toFixed(1)} ms`
        : 'n/a',
    ),
  );

  console.log('\nCONFIGURATION');
  console.log(
    pad(
      'PERSIST_BATCH_SIZE:',
      process.env.PERSIST_BATCH_SIZE ?? '500 (default)',
    ),
  );
  console.log(
    pad(
      'SCORING_BATCH_SIZE:',
      process.env.SCORING_BATCH_SIZE ?? '500 (default)',
    ),
  );
  console.log(
    pad('WORKER_POOL_SIZE:', process.env.WORKER_POOL_SIZE ?? '4 (default)'),
  );
  console.log(
    pad(
      'MAX_CONCURRENT_PERSISTS:',
      process.env.MAX_CONCURRENT_PERSISTS ?? '2 (default)',
    ),
  );
  console.log(
    pad(
      'HASH_ROUNDS:',
      process.env.RISK_SCORING_HASH_ROUNDS ?? '600 (default)',
    ),
  );

  console.log('\nBOTTLENECK');
  if (state.persistMean !== null && state.scoringMean !== null) {
    const ratio = state.persistMean / state.scoringMean;
    if (ratio > 1.5) {
      console.log('  → DATABASE WRITES dominate.');
      console.log(
        '    Try raising PERSIST_BATCH_SIZE and MAX_CONCURRENT_PERSISTS.',
      );
    } else if (ratio < 0.67) {
      console.log('  → CPU SCORING dominates.');
      console.log('    Try raising WORKER_POOL_SIZE toward core count,');
      console.log(
        '    or lowering RISK_SCORING_HASH_ROUNDS (the cost is artificial).',
      );
    } else {
      console.log('  → Persist and scoring are BALANCED.');
      console.log(
        '    If throughput is still low, stream parsing / disk I/O may be the limit.',
      );
    }
  } else {
    console.log(
      '  Insufficient histogram data — was the worker metrics endpoint reachable?',
    );
  }

  console.log('\nCAVEAT ON API LATENCY');
  console.log(
    '  API and worker are separate PROCESSES, so low API latency here is',
  );
  console.log(
    '  substantially process isolation — it would hold with or without the',
  );
  console.log(
    '  thread pool. The figure that demonstrates the THREAD POOL is the',
  );
  console.log(
    "  worker's loop p99 above. Compare it against a run with scoring done",
  );
  console.log('  inline on the main thread to show the difference.');

  console.log('\n' + '═'.repeat(72));
  console.log('Paste these numbers into BENCHMARK.md.');
})().catch((err) => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
