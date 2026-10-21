export interface EnvelopeSample {
  at: number;
  value: number;
}
export interface DelayEstimate {
  seconds: number;
  correlation: number;
}
function correlation(a: number[], b: number[]) {
  const meanA = a.reduce((n, v) => n + v, 0) / a.length,
    meanB = b.reduce((n, v) => n + v, 0) / b.length;
  let numerator = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - meanA,
      y = b[i] - meanB;
    numerator += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0.000001 && bb > 0.000001 ? numerator / Math.sqrt(aa * bb) : 0;
}
/** Audio amplitude only. Silence, weak/ambiguous matches and immediate speaker echo do not change delay. */
export function estimateTouchDelay(
  phone: readonly EnvelopeSample[],
  tab: readonly EnvelopeSample[],
  now: number,
): DelayEstimate | null {
  const grid = new Map<number, number>();
  for (const p of phone) grid.set(Math.round(p.at / 50), p.value);
  const recent = tab.filter((p) => p.at >= now - 12000 && p.at <= now);
  if (recent.length < 140) return null;
  const scores: { ms: number; score: number }[] = [];
  for (let ms = 0; ms <= 20000; ms += 50) {
    const a: number[] = [],
      b: number[] = [];
    for (const t of recent) {
      const value = grid.get(Math.round((t.at - ms) / 50));
      if (value !== undefined) {
        a.push(value);
        b.push(t.value);
      }
    }
    if (a.length < 140) continue;
    const voicedA = a.filter((v) => v > 0.004).length,
      voicedB = b.filter((v) => v > 0.004).length;
    if (voicedA < 30 || voicedB < 30) continue;
    scores.push({ ms, score: correlation(a, b) });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || best.ms < 1000 || best.score < 0.75) return null;
  const rival = scores.find((s) => Math.abs(s.ms - best.ms) > 1000);
  if (rival && best.score - rival.score < 0.07) return null;
  return { seconds: best.ms / 1000, correlation: best.score };
}
export class StableTouchDelay {
  private values: number[] = [];
  add(estimate: DelayEstimate | null) {
    if (!estimate) return null;
    this.values.push(estimate.seconds);
    this.values = this.values.slice(-3);
    if (this.values.length < 3) return null;
    return [...this.values].sort((a, b) => a - b)[1];
  }
}
export class AudioEnvelopeSampler {
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private owns = false;
  private generation = 0;
  async start(
    stream: MediaStream,
    onSample: (sample: EnvelopeSample) => void,
    ownsStream = false,
  ) {
    this.stop();
    const generation = ++this.generation;
    this.stream = stream;
    this.owns = ownsStream;
    if (!stream.getAudioTracks().some((t) => t.readyState === 'live'))
      return false;
    this.context = new AudioContext();
    await this.context.resume();
    if (generation !== this.generation || !this.context) return false;
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    this.source = this.context.createMediaStreamSource(
      new MediaStream(stream.getAudioTracks()),
    );
    this.source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const value of data) sum += value * value;
      onSample({ at: Date.now(), value: Math.sqrt(sum / data.length) });
    }, 50);
    return true;
  }
  stop() {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.source?.disconnect();
    this.source = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    if (this.owns) this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
