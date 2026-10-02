import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled = await build({
  entryPoints: ["src/services/sellerAnalysisCapture.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "analysis-capture-fixture",
    setup(b) {
      b.onResolve({
        filter:
          /\.\/(audioCaptureService|deepgramService|commentStreamService|screenCaptureService)$/,
      }, ({ path }) => ({ path, namespace: "fixture" }));
      b.onLoad(
        { filter: /.*/, namespace: "fixture" },
        ({ path }) => ({
          contents: path.includes("audioCapture")
            ? `
   export class AudioCaptureService {startCapture(_mode,chunk){globalThis.captureFixture.chunk=chunk;return Promise.resolve();}stopCapture(){globalThis.captureFixture.audioStops++;}}
   `
            : path.includes("deepgram")
            ? `
   export class DeepgramSttService {startLiveStream(_config,transcript,error,status){Object.assign(globalThis.captureFixture,{transcript,error,status});}sendAudioChunk(chunk){globalThis.captureFixture.chunks.push(chunk);}stopLiveStream(){globalThis.captureFixture.sttStops++;}}
   `
            : path.includes("commentStream")
            ? `
   export const commentStreamService={get isConnectedToServer(){return true;},connect(){},onComment(f){globalThis.captureFixture.comment=f;return ()=>globalThis.captureFixture.removed++;},onStatus(f){return ()=>globalThis.captureFixture.removed++;},configureCloudPublishing(c){globalThis.captureFixture.cloud=c;},startCollecting(username){globalThis.captureFixture.username=username;},stopCollecting(){globalThis.captureFixture.commentStops++;}};
   `
            : `export const screenCaptureService={getOrCreateStream:async force=>{globalThis.captureFixture.force=force;return globalThis.captureFixture.stream;},getActiveStream:()=>globalThis.captureFixture.stream,stopStream:()=>{globalThis.captureFixture.screenStops++;globalThis.captureFixture.stream=null;}};`,
        }),
      );
    },
  }],
});
const { SellerAnalysisCapture } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
function fixture() {
  const ctx = {
    chunks: [],
    audioStops: 0,
    sttStops: 0,
    commentStops: 0,
    screenStops: 0,
    removed: 0,
    comments: [],
    transcripts: [],
    messages: [],
  };
  const track = {
    readyState: "live",
    addEventListener(_e, f) {
      ctx.ended = f;
    },
    removeEventListener() {
      ctx.removed++;
    },
  };
  ctx.stream = { getAudioTracks: () => [track] };
  globalThis.captureFixture = ctx;
  const options = {
    username: "target-seller",
    serverUrl: "http://helper",
    sessionId: "analysis-session",
    stt: { provider: "SONIOX" },
    comment: (c) => ctx.comments.push(c),
    transcript: (t) => ctx.transcripts.push(t),
    status: (s) => ctx.messages.push(s),
  };
  return { ctx, options, service: new SellerAnalysisCapture() };
}
test("analysis selects its own broadcast, disables cloud sales publishing, and accepts final speech only", async () => {
  const { ctx, options, service } = fixture();
  await service.start(options);
  assert.equal(ctx.force, true);
  assert.equal(ctx.username, "target-seller");
  assert.deepEqual(ctx.cloud, { sessionId: null });
  ctx.comment({ id: "c", nickname: "햇살", content: "1", userId: "account" });
  ctx.transcript({ text: "임시", isFinal: false });
  ctx.transcript({ text: "햇살언니 드릴게요", isFinal: true });
  assert.equal(ctx.comments[0].sessionId, "analysis-session");
  assert.equal(ctx.transcripts.length, 1);
  assert.equal(ctx.transcripts[0].isFinal, true);
  service.stop();
  ctx.transcript({ text: "늦은 콜백", isFinal: true });
  ctx.comment({ id: "late", nickname: "other", content: "1" });
  assert.equal(ctx.transcripts.length, 1);
  assert.equal(ctx.comments.length, 1);
  assert.equal(ctx.screenStops, 1);
});
test("audio termination and STT disconnect release capture resources and report the stopped state", async () => {
  for (const failure of ["audio", "stt"]) {
    const { ctx, options, service } = fixture();
    await service.start(options);
    if (failure === "audio") ctx.ended();
    else ctx.status("DISCONNECTED", "연결 종료");
    assert.match(ctx.messages.at(-1), /청취 중지/);
    assert.equal(ctx.screenStops, 1);
    assert.ok(ctx.removed >= 3);
    ctx.chunk(new ArrayBuffer(4));
    assert.equal(ctx.chunks.length, 0);
  }
});
