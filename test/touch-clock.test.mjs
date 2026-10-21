import test from 'node:test';
import assert from 'node:assert/strict';
import { touchClockOffset } from '../src/services/touchClock.ts';
test('phone/PC clock correction excludes server processing time and chooses least delayed sample', () => {
  const result = touchClockOffset([
    {
      sentAt: 1000,
      receivedAt: 2000,
      serverReceivedAt: 6200,
      serverSentAt: 6500,
    },
    {
      sentAt: 3000,
      receivedAt: 3440,
      serverReceivedAt: 8020,
      serverSentAt: 8420,
    },
  ]);
  assert.equal(result.offset, 5000);
  assert.equal(result.rtt, 40);
  assert.equal(
    touchClockOffset([
      { sentAt: 10, receivedAt: 0, serverReceivedAt: 0, serverSentAt: 10 },
    ]),
    null,
  );
});
