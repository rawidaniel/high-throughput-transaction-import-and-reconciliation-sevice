#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const RECORDS = Number(args.records ?? 100_000);
const MALFORMED_PCT = Number(args.malformed ?? 2);
const DUPLICATE_PCT = Number(args.duplicates ?? 3);
const OUT = args.out ?? path.join(process.cwd(), `data-${RECORDS}.ndjson`);

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD'];

function validRecord(i) {
  return {
    transactionId: `txn-${i}`,
    accountId: `acc-${i % 1000}`,
    merchantId: `merch-${i % 250}`,
    amount: Math.round(Math.random() * 500_000) / 100,
    currency: CURRENCIES[i % CURRENCIES.length],
    timestamp: new Date(Date.now() - i * 1000).toISOString(),
    description: i % 7 === 0 ? null : `Purchase ${i} at merchant ${i % 250}`,
  };
}

let malformedMode = 0;
function malformedLine(i) {
  const modes = [
    () => `{"transactionId":"${i}", broken json`,
    () => JSON.stringify({ ...validRecord(i), amount: -50 }),
    () => JSON.stringify({ ...validRecord(i), currency: 'INVALID' }),
    () => JSON.stringify({ ...validRecord(i), timestamp: 'not-a-date' }),
    () => JSON.stringify({ accountId: `acc-${i}` }), // missing required fields
    () => JSON.stringify({ ...validRecord(i), description: 'x'.repeat(600) }),
  ];
  const line = modes[malformedMode % modes.length]();
  malformedMode++;
  return line;
}

function generate() {
  const out = fs.createWriteStream(OUT);
  const started = Date.now();

  let i = 0;
  let malformed = 0;
  let duplicates = 0;

  return new Promise((resolve, reject) => {
    function write() {
      let ok = true;

      while (i < RECORDS && ok) {
        let line;

        const isDuplicate =
          DUPLICATE_PCT > 0 &&
          i > 0 &&
          i % Math.max(1, Math.round(100 / DUPLICATE_PCT)) === 0;
        const isMalformed =
          !isDuplicate &&
          MALFORMED_PCT > 0 &&
          i > 0 &&
          (i + 1) % Math.max(1, Math.round(100 / MALFORMED_PCT)) === 0;

        if (isDuplicate) {
          line = JSON.stringify(validRecord(i - 1));
          duplicates++;
        } else if (isMalformed) {
          line = malformedLine(i);
          malformed++;
        } else {
          line = JSON.stringify(validRecord(i));
        }

        i++;
        ok = out.write(line + '\n');
      }

      if (i < RECORDS) {
        out.once('drain', write);
      } else {
        out.end();
      }
    }

    out.on('finish', () => {
      const bytes = fs.statSync(OUT).size;
      console.log(`Generated ${RECORDS.toLocaleString()} records`);
      console.log(`  file:       ${OUT}`);
      console.log(`  size:       ${(bytes / 1024 / 1024).toFixed(1)} MB`);
      console.log(`  malformed:  ~${malformed.toLocaleString()}`);
      console.log(`  duplicates: ~${duplicates.toLocaleString()}`);
      console.log(
        `  took:       ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      resolve();
    });
    out.on('error', reject);

    write();
  });
}

generate().catch((err) => {
  console.error('Generation failed:', err.message);
  process.exit(1);
});
