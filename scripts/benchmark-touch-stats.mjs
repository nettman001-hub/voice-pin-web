import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { CustomerStatsIndex } from '../src/services/customerStatsIndex.ts';
const buyers = Array.from({ length: 1000 }, (_, i) => ({
  id: `buyer-${i}`,
  platform: 'TIKTOK',
  platformUserId: `account-${i}`,
  displayNickname: `고객${i}`,
}));
const sales = Array.from({ length: 10000 }, (_, i) => ({
  id: `sale-${i}`,
  buyerId: `buyer-${i % 1000}`,
  buyerNickname: `고객${i % 1000}`,
  sessionId: `past-${Math.floor(i / 1000)}`,
  amount: 15000,
  status: '자동저장',
  recognizedAt: '2026-10-20T00:00:00Z',
  rawTranscript: '',
}));
const start = performance.now(),
  index = new CustomerStatsIndex().reconcile({
    sales,
    buyers,
    currentSessionId: 'today',
  }),
  built = performance.now();
let checksum = 0;
const repetitions = 500000;
for (let i = 0; i < repetitions; i++)
  checksum += index.lookup({
    platformUserId: `account-${i % 1000}`,
  }).purchaseCount;
const end = performance.now();
if (checksum !== repetitions * 10) throw new Error('incorrect cached totals');
const result = {
  buyers: buyers.length,
  sales: sales.length,
  lookups: repetitions,
  buildMs: built - start,
  totalLookupMs: end - built,
  averageLookupMs: (end - built) / repetitions,
  checksum,
  scope:
    'synthetic local Node benchmark; runtime and hardware affect elapsed time',
  date: new Date().toISOString(),
};
const dir = path.resolve('artifacts/touch-sales');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, 'customer-stats-benchmark.json'),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
