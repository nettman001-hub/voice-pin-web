/** Opt-in paid integration check. Uses generated speech, real Soniox, and the production capture transport.
 * Run generate-soniox-test-audio.ps1 first, then:
 * node scripts/verify-soniox-live.mjs --audio-dir scratch/soniox-integration.local --key-file <ignored file>
 * SONIOX_API_KEY can replace --key-file. Credentials are never included in the report.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';

const argumentsByName = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const apiKey = process.env.SONIOX_API_KEY || (argumentsByName['key-file'] && fs.readFileSync(argumentsByName['key-file'], 'utf8').trim());
if (!apiKey) throw new Error('Provide SONIOX_API_KEY or --key-file. This test calls the real paid Soniox API.');
const audioDirectory = path.resolve(argumentsByName['audio-dir'] || 'scratch/soniox-integration.local');
const output = path.resolve(argumentsByName.output || 'artifacts/soniox-live-validation.json');
const report = {
  startedAt: new Date().toISOString(), mode: 'REAL_SONIOX_SYNTHETIC_PCM_PRODUCTION_CAPTURE',
  audioSource: 'Generated fictional Korean speech; no microphone or customer audio',
  provider: 'SONIOX', model: 'stt-rt-v5',
  statuses: [], transcripts: [], transcriptEvents: [], comments: [], connections: [],
  sentChunks: 0, capturedBytes: 0, maxBufferedBytes: 0,
  purchaseOnlyHints: argumentsByName['purchase-only'] === 'true',
};
const chunkIds = new WeakMap();
const counts = new Map();
const metadataErrors = [];
let capture, audioDeliver, commentDeliver;

function recordTranscript(value) {
  report.transcriptEvents.push({ id: value.id, revision: value.revision, utteranceId: value.utteranceId,
    utteranceEnded: value.utteranceEnded, endReason: value.endReason, receivedAt: value.receivedAt });
  const index = report.transcripts.findIndex((previous) => previous.id === value.id);
  if (index < 0) {
    report.transcripts.push(value);
    console.log(`Final transcript: ${value.text}`);
    return;
  }
  const previous = report.transcripts[index];
  if (value.revision !== previous.revision + 1) metadataErrors.push('A transcript revision did not advance exactly once');
  for (const field of ['text', 'recognizedAt', 'startedAt', 'endedAt', 'startMs', 'endMs', 'utteranceId']) {
    if (value[field] !== previous[field]) metadataErrors.push(`A boundary-only revision changed ${field}`);
  }
  report.transcripts[index] = value;
  console.log(`Transcript boundary updated: revision ${value.revision}, ${value.endReason}`);
}

function load(name, dependencies = {}, globals = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(`src/services/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (id) => {
    assert.ok(id in dependencies, `Unexpected import ${id}`);
    return dependencies[id];
  }, console, ...globals });
  return exports;
}

class TrackedWebSocket extends WebSocket {
  constructor(url) {
    super(url);
    this.stats = { number: report.connections.length + 1, startedAt: new Date().toISOString(), openedAt: null, firstResponseAt: null, closedAt: null,
      terms: [], sentBytes: 0, chunks: [], finalizedText: '', maxFinalAudioMs: 0, maxTotalAudioMs: 0, finished: false };
    report.connections.push(this.stats);
    this.addEventListener('open', () => { this.stats.openedAt = new Date().toISOString(); });
    this.addEventListener('message', (event) => {
      this.stats.firstResponseAt ||= new Date().toISOString();
      const data = JSON.parse(event.data);
      this.stats.maxFinalAudioMs = Math.max(this.stats.maxFinalAudioMs, data.final_audio_proc_ms || 0);
      this.stats.maxTotalAudioMs = Math.max(this.stats.maxTotalAudioMs, data.total_audio_proc_ms || 0);
      this.stats.finalizedText += (data.tokens || []).filter((token) => token.is_final && !['<fin>', '<end>'].includes(token.text)).map((token) => token.text).join('');
      if (data.finished) this.stats.finished = true;
      if (data.error_code || data.error_type) this.stats.error = { code: data.error_code, type: data.error_type };
    });
    this.addEventListener('close', (event) => { this.stats.closedAt = new Date().toISOString(); this.stats.closeCode = event.code; });
  }
  send(data) {
    super.send(data);
    if (typeof data === 'string' && data.length) {
      const message = JSON.parse(data);
      if (message.context?.terms) this.stats.terms = message.context.terms;
    } else if (data.byteLength) {
      const id = chunkIds.get(data);
      assert.ok(id, 'Only supplied synthetic PCM is sent');
      this.stats.sentBytes += data.byteLength;
      this.stats.chunks.push(id);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
}

class GeneratedAudio {
  async startCapture(_mode, deliver) { audioDeliver = deliver; return { getAudioTracks: () => [] }; }
  stopCapture() {}
}
class GeneratedComments {
  onComment(deliver) { commentDeliver = deliver; return () => {}; }
  onStatus() { return () => {}; }
  connect() {}
  startCollecting() {}
  disconnect() {}
}

function readPcm(file) {
  const wav = fs.readFileSync(file);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4);
    if (name === 'fmt ') {
      assert.equal(wav.readUInt16LE(offset + 8), 1, 'PCM encoding');
      assert.equal(wav.readUInt16LE(offset + 10), 1, 'Mono audio');
      assert.equal(wav.readUInt32LE(offset + 12), 16000, '16 kHz audio');
      assert.equal(wav.readUInt16LE(offset + 22), 16, '16-bit audio');
    }
    if (name === 'data') pcm = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.ok(pcm?.length, 'Wave file has audio data');
  return pcm;
}

async function stream(pcm) {
  for (let offset = 0; offset < pcm.length; offset += 3200) {
    const bytes = pcm.subarray(offset, offset + 3200);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    chunkIds.set(buffer, ++report.sentChunks);
    report.capturedBytes += bytes.length;
    audioDeliver(buffer);
    report.maxBufferedBytes = Math.max(report.maxBufferedBytes, capture.bufferedBytes);
    if (report.statuses.some((item) => item.message.startsWith('청취 중지'))) throw new Error('Capture reported a fatal provider error');
    await delay(bytes.length / 32);
  }
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    // Keep the synthetic capture clock continuous while waiting for provider finalization.
    await stream(Buffer.alloc(3200));
  }
}

try {
  const vocabulary = load('sellerLogicVocabulary', { './nicknameMatcher': load('nicknameMatcher') });
  const { SellerLogicCapture } = load('sellerLogicCapture', {
    './audioCaptureService': { AudioCaptureService: GeneratedAudio },
    './commentStreamService': { CommentStreamService: GeneratedComments },
    './screenCaptureService': { screenCaptureService: {
      async getOrCreateStream() { return { getTracks: () => [] }; }, stopStream() {}, cancelPendingRequest() {},
    } }, './sellerLogicVocabulary': vocabulary,
  }, { WebSocket: TrackedWebSocket, ArrayBuffer, crypto: webcrypto, window: { setTimeout, clearTimeout, setInterval, clearInterval } });
  capture = new SellerLogicCapture();
  await capture.start({
    username: 'generated-integration-test', serverUrl: 'unused', sessionId: `live-check-${webcrypto.randomUUID()}`,
    stt: { provider: 'SONIOX', apiKey },
    purchaseOnlyHints: report.purchaseOnlyHints,
    initialComments: [{ nickname: '루비' }],
    comment: (value) => report.comments.push(value),
    transcript: recordTranscript,
    status: (message) => { report.statuses.push({ at: new Date().toISOString(), message }); console.log(message); },
  });
  for (let index = 1; index <= 3; index++) {
    const nickname = ['루비', 'u', 'mint'][index - 1];
    commentDeliver({ id: `generated-${index}`, uniqueId: `generated-${index}`, nickname,
      content: ['검정색 가디건 저요', '베이지 니트 저주세요', '청바지 제가 살게요'][index - 1],
      receivedAt: new Date().toISOString() });
    if (index > 1) capture.prioritizeNicknames([nickname]);
    await stream(readPcm(path.join(audioDirectory, `phrase-${index}.wav`)));
    await stream(Buffer.alloc(16000));
    await waitUntil(() => report.connections.length >= index && capture.pending === null, `Connection ${index} did not receive provider acceptance`);
  }
  await capture.stop();
  await delay(100);
  assert.equal(report.connections.length, 3, 'Initial connection and two real vocabulary rotations');
  if (report.purchaseOnlyHints) assert.ok(Date.parse(report.connections[2].startedAt) - Date.parse(report.connections[1].startedAt) >= 5000,
    'Subsequent purchase-hint session updates are at least five seconds apart');
  assert.ok(report.maxBufferedBytes > 0, 'Audio buffered during startup or rotation');
  assert.equal(counts.size, report.sentChunks, 'Every captured chunk reached a real WebSocket');
  assert.ok([...counts.values()].every((count) => count === 1), 'Each captured chunk sent exactly once');
  assert.ok(report.connections.every((connection) => connection.finished), 'Every provider session finalized with finished:true');
  assert.ok(report.connections.every((connection) => connection.maxFinalAudioMs >= connection.sentBytes / 32 &&
    connection.maxFinalAudioMs - connection.sentBytes / 32 < 200), 'Provider finalized all sent audio (allowing its frame rounding)');
  assert.ok(report.connections[1].terms.includes('u') && report.connections[1].terms.includes('유'));
  assert.ok(report.connections[2].terms.includes('mint') && report.connections[2].terms.includes('민트'));
  const text = report.transcripts.map((item) => item.text).join(' ');
  assert.match(text, /루비/);
  assert.match(text, /가디건/);
  assert.match(text, /니트/);
  assert.match(text, /청바지/);
  assert.match(text, /종료/);
  assert.ok(report.transcripts.every((item) => Number.isFinite(item.startMs) && item.endMs >= item.startMs));
  assert.equal(new Set(report.transcripts.map((item) => item.id)).size, report.transcripts.length, 'Transcript archive contains one latest row per source ID');
  assert.deepEqual(metadataErrors, [], 'Boundary revisions preserve source text, utterance identity and audio times');
  assert.ok(report.transcripts.every((item) => item.utteranceId && Number.isSafeInteger(item.revision) && item.revision >= 1 &&
    item.isFinal === true && item.startedAt === item.recognizedAt && item.startedAt === new Date(item.startMs).toISOString() &&
    item.endedAt === new Date(item.endMs).toISOString() && Number.isFinite(Date.parse(item.receivedAt)) &&
    typeof item.utteranceEnded === 'boolean' && item.utteranceEnded === (item.endReason === 'endpoint')),
  'Every real transcript preserves capture timing, stable tokens and independent utterance boundary metadata');
  const compactText = (value) => value.replace(/\s+/gu, '');
  const capturedText = [...report.transcripts].sort((a, b) => a.startMs - b.startMs).map((item) => item.text).join('');
  assert.equal(compactText(capturedText), compactText(report.connections.map((item) => item.finalizedText).join('')),
    'Upserted transcript text contains every real final token exactly once in audio order');
  report.metadataValidation = {
    uniqueTranscriptRows: report.transcripts.length,
    transcriptCallbacks: report.transcriptEvents.length,
    boundaryUpdates: report.transcriptEvents.length - report.transcripts.length,
    utterances: new Set(report.transcripts.map((item) => item.utteranceId)).size,
    endReasons: Object.fromEntries(['endpoint', 'flush', 'finalize', 'stream_end', 'rotation']
      .map((reason) => [reason, report.transcriptEvents.filter((item) => item.endReason === reason).length])),
    exactFinalTokenCoverage: true,
  };
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error instanceof Error ? error.message.replaceAll(apiKey, '[REDACTED]') : 'Integration failed';
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await capture?.stop();
  report.completedAt = new Date().toISOString();
  report.audioSeconds = report.capturedBytes / 32000;
  report.sentAudioSeconds = report.connections.reduce((total, connection) => total + connection.sentBytes, 0) / 32000;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Safe integration report: ${output}`);
}
