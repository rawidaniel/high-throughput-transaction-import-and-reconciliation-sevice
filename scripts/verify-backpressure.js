#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const RECORDS = Number(args.records ?? 200000);
const API = args.api ?? 'http://localhost:3000';
const WORKER_METRICS = args.workerMetrics ?? 'http://localhost:3001/metrics';
const FILE = path.join(os.tmpdir(), `backpressure-${RECORDS}.ndjson`);

function generate() {
  console.log(`Generating ${RECORDS.toLocaleString()} records -> ${FILE}`);
  const out = fs.createWriteStream(FILE);
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let i = 0;

    function writeChunk() {
      let ok = true;
      while (i < RECORDS && ok) {
        const record = {
          transactionId: `txn-${i}`,
          accountId: `acc-${i % 1000}`,
          merchantId: `merch-${i % 250}`,
          amount: Math.round(Math.random() * 500000) / 100,
          currency: ['USD', 'EUR', 'GBP'][i % 3],
          timestamp: new Date(Date.now() - i * 1000).toISOString(),
          description:
            i % 7 === 0 ? null : `Purchase number ${i} at a merchant`,
        };
        i++;
        ok = out.write(JSON.stringify(record) + '\n');
      }
      if (i < RECORDS) {
        out.once('drain', writeChunk);
      } else {
        out.end();
      }
    }

    out.on('finish', () => {
      const bytes = fs.statSync(FILE).size;
      console.log(
        `Generated in ${((Date.now() - start) / 1000).toFixed(1)}s — ` +
          `${(bytes / 1024 / 1024).toFixed(1)} MB\n`,
      );
      resolve();
    });
    out.on('error', reject);
    writeChunk();
  });
}

async function parseMetric(text, name, labelFilter) {
  const lines = text
    .split('\n')
    .filter((l) => l.startsWith(name) && !l.startsWith('#'));
  const match = labelFilter
    ? lines.find((l) => l.includes(labelFilter))
    : lines[0];
  if (!match) return null;
  return Number(match.split(/\s+/).pop());
}

async function sampleWorker() {
  try {
    const res = await fetch(WORKER_METRICS);
    const text = await res.text();
    return {
      rssMb:
        (await parseMetric(text, 'process_memory_bytes', 'type="rss"')) /
        1024 /
        1024,
      heapMb:
        (await parseMetric(text, 'process_memory_bytes', 'type="heap_used"')) /
        1024 /
        1024,
      loopP99: await parseMetric(text, 'event_loop_delay_p99_ms'),
      backpressureWaits: await parseMetric(text, 'backpressure_waits_total'),
      persistQueue: await parseMetric(text, 'persist_queue_depth'),
    };
  } catch {
    return null;
  }
}

async function upload() {
  const form = new FormData();
  form.append(
    'file',
    new Blob([fs.readFileSync(FILE)], { type: 'application/x-ndjson' }),
    'data.ndjson',
  );

  const res = await fetch(`${API}/v1/imports`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `backpressure-${Date.now()}` },
    body: form,
  });

  if (!res.ok)
    throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function monitor(importId) {
  console.log(
    'sample   rss(MB)  heap(MB)  loopP99  bpWaits  queue  processed/total  status',
  );
  console.log('─'.repeat(84));

  const rssSamples = [];
  let sample = 0;

  for (;;) {
    const [worker, statusRes] = await Promise.all([
      sampleWorker(),
      fetch(`${API}/v1/imports/${importId}`).then((r) => r.json()),
    ]);

    if (worker) {
      rssSamples.push(worker.rssMb);
      console.log(
        `${String(++sample).padStart(6)}  ` +
          `${worker.rssMb.toFixed(1).padStart(8)}  ` +
          `${worker.heapMb.toFixed(1).padStart(8)}  ` +
          `${String(worker.loopP99 ?? '-').padStart(7)}  ` +
          `${String(worker.backpressureWaits ?? 0).padStart(7)}  ` +
          `${String(worker.persistQueue ?? 0).padStart(5)}  ` +
          `${String(statusRes.processedCount).padStart(8)}/${String(statusRes.totalRecords).padEnd(7)}  ` +
          statusRes.status,
      );
    }

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(statusRes.status)) {
      report(rssSamples, statusRes);
      return;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

function report(rssSamples, status) {
  if (rssSamples.length < 3) {
    console.log('\nToo few samples to judge — try a larger file.');
    return;
  }

  const min = Math.min(...rssSamples);
  const max = Math.max(...rssSamples);
  const growth = ((max - min) / min) * 100;

  console.log('\n' + '─'.repeat(84));
  console.log(`Final status:     ${status.status}`);
  console.log(
    `Records:          ${status.processedCount} / ${status.totalRecords}`,
  );
  console.log(`Accepted:         ${status.acceptedCount}`);
  console.log(`Rejected:         ${status.rejectedCount}`);
  console.log(`Duplicates:       ${status.duplicateCount}`);
  console.log(`\nWorker RSS min:   ${min.toFixed(1)} MB`);
  console.log(`Worker RSS max:   ${max.toFixed(1)} MB`);
  console.log(`Growth:           ${growth.toFixed(1)}%`);

  console.log('\nINTERPRETATION');
  if (growth < 50) {
    console.log(
      '  RSS stayed roughly flat — consistent with working backpressure.',
    );
  } else {
    console.log(
      '  RSS grew substantially. That MAY indicate backpressure is not',
    );
    console.log(
      '  holding, but it may also be normal GC behaviour or heap growth',
    );
    console.log('  under load. The decisive test is COMPARATIVE:');
  }
  console.log(
    '\n  Re-run with a much larger --records value. If backpressure works,',
  );
  console.log(
    '  peak RSS should stay in the same ballpark. If it scales with file',
  );
  console.log('  size, batches are accumulating rather than being awaited.');
}

(async () => {
  await generate();
  console.log('Uploading...');
  const importId = await upload();
  console.log(`Import ${importId} created. Monitoring...\n`);
  await monitor(importId);
  fs.unlinkSync(FILE);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
