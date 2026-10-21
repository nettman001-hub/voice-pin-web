export interface ClockSample {
  sentAt: number;
  receivedAt: number;
  serverReceivedAt: number;
  serverSentAt: number;
}
/** Four timestamps remove server processing time; select the least delayed network sample. */
export function touchClockOffset(samples: ClockSample[]) {
  const valid = samples
    .map((s) => ({
      offset:
        (s.serverReceivedAt - s.sentAt + (s.serverSentAt - s.receivedAt)) / 2,
      rtt: s.receivedAt - s.sentAt - (s.serverSentAt - s.serverReceivedAt),
    }))
    .filter((s) => Number.isFinite(s.offset) && s.rtt >= 0 && s.rtt < 10000);
  valid.sort((a, b) => a.rtt - b.rtt);
  return valid[0] || null;
}
export async function measureTouchClock(
  request: () => Promise<{ receivedAt: number; sentAt: number }>,
  count = 3,
) {
  const samples: ClockSample[] = [];
  for (let i = 0; i < count; i++) {
    const sentAt = Date.now(),
      reply = await request(),
      receivedAt = Date.now();
    samples.push({
      sentAt,
      receivedAt,
      serverReceivedAt: reply.receivedAt,
      serverSentAt: reply.sentAt,
    });
  }
  return touchClockOffset(samples);
}
