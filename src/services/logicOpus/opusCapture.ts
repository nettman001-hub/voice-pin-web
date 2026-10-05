import { AudioCaptureService } from "../audioCaptureService";
import { commentStreamService } from "../commentStreamService";
import { screenCaptureService } from "../screenCaptureService";
import type { LogicOpusCommentEvent, LogicOpusSpeechEvent } from "../../types/logicOpus";
import { OpusSttManager, type SttManagerStatus } from "./opusSttManager";

/**
 * 방송 탭 오디오 + 댓글 도우미 수집 (판매자 로직분석01opus 전용).
 * 운영 판매(sales)에는 아무것도 쓰지 않는다.
 */
export class OpusCapture {
  private audio = new AudioCaptureService();
  private stt: OpusSttManager | null = null;
  private off: Array<() => void> = [];
  private stream: MediaStream | null = null;
  private generation = 0;
  private startedAtWall = 0;
  private seq = 0;

  get manager(): OpusSttManager | null {
    return this.stt;
  }

  async start(options: {
    username: string;
    serverUrl: string;
    sonioxApiKey: string;
    initialTerms: string[];
    onComment: (e: LogicOpusCommentEvent) => void;
    onSpeech: (e: LogicOpusSpeechEvent) => void;
    onInterim: (text: string) => void;
    onSttStatus: (s: SttManagerStatus) => void;
    onStatus: (message: string) => void;
  }) {
    await this.stop();
    const generation = ++this.generation;
    const active = () => generation === this.generation;
    try {
      const stream = await screenCaptureService.getOrCreateStream(true);
      if (!active()) return;
      this.stream = stream;
      const track = stream?.getAudioTracks().find((t) => t.readyState === "live");
      if (!track) throw new Error("방송 탭을 고를 때 '탭 오디오 공유'를 켜 주세요.");
      const ended = () => {
        if (active()) {
          void this.stop();
          options.onStatus("청취 중지: 방송 탭 오디오 공유가 종료되었습니다.");
        }
      };
      track.addEventListener("ended", ended);
      this.off.push(() => track.removeEventListener("ended", ended));

      // 댓글
      const startComments = () => {
        if (active() && commentStreamService.isConnectedToServer) {
          commentStreamService.configureCloudPublishing({ sessionId: null });
          commentStreamService.startCollecting(options.username);
        }
      };
      this.off.push(commentStreamService.onComment((c) => {
        if (!active()) return;
        options.onComment({
          id: `c_${c.id || crypto.randomUUID()}`,
          kind: "COMMENT",
          at: c.receivedAt || new Date().toISOString(),
          nickname: c.nickname,
          uniqueId: c.uniqueId,
          text: c.content,
        });
      }));
      this.off.push(commentStreamService.onStatus((s, m) => {
        if (!active()) return;
        options.onStatus(`댓글: ${m || s}`);
        if (s === "CONNECTED") startComments();
      }));
      commentStreamService.connect(options.serverUrl);
      startComments();

      // STT
      this.startedAtWall = Date.now();
      const stt = new OpusSttManager({
        apiKey: options.sonioxApiKey,
        onUtterance: (u) => {
          if (!active()) return;
          this.seq += 1;
          options.onSpeech({
            id: `s_${String(this.seq).padStart(5, "0")}`,
            kind: "SPEECH",
            at: new Date(this.startedAtWall + u.audioStartMs).toISOString(),
            text: u.text,
            audioStartMs: Math.round(u.audioStartMs),
            audioEndMs: Math.round(u.audioEndMs),
            sttSessionNo: u.sessionNo,
          });
        },
        onInterim: (t) => active() && options.onInterim(t),
        onStatus: (s) => active() && options.onSttStatus(s),
      });
      this.stt = stt;
      const ok = await stt.start(options.initialTerms);
      if (!ok) throw new Error("Soniox 연결에 실패했습니다. 관리자 STT API 키를 확인해 주세요.");
      if (!active()) return;
      await this.audio.startCapture("TAB_AUDIO", (chunk) => {
        if (active()) stt.pushAudio(chunk);
      }, () => {});
      if (!active()) this.audio.stopCapture(false);
    } catch (e) {
      await this.stop();
      throw e;
    }
  }

  async stop() {
    // 오디오를 먼저 멈추고 STT에 남은 단어를 받아낸 뒤 세대를 바꾼다
    this.audio.stopCapture(false);
    const stt = this.stt;
    this.stt = null;
    if (stt) await stt.stop();
    ++this.generation;
    this.off.forEach((f) => f());
    this.off = [];
    commentStreamService.stopCollecting();
    if (this.stream && this.stream === screenCaptureService.getActiveStream()) screenCaptureService.stopStream();
    this.stream = null;
  }
}
