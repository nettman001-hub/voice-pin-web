import { AudioCaptureService } from "./audioCaptureService";
import { DeepgramSttService } from "./deepgramService";
import { commentStreamService } from "./commentStreamService";
import { screenCaptureService } from "./screenCaptureService";
import type { CommentRecord } from "../types/comment";
import type { WorkflowTranscript } from "../types/salesWorkflow";
import type { SttConfig } from "../types/deepgram";

/** Analysis capture has no sales writer and no access to seller business callbacks. */
export class SellerAnalysisCapture {
  private audio = new AudioCaptureService();
  private stt = new DeepgramSttService();
  private generation = 0;
  private off: Array<() => void> = [];
  private stream: MediaStream | null = null;
  async start(
    options: {
      username: string;
      serverUrl: string;
      stt: SttConfig;
      sessionId: string;
      comment: (c: CommentRecord) => void;
      transcript: (t: WorkflowTranscript) => void;
      status: (s: string) => void;
    },
  ) {
    this.stop();
    const generation = ++this.generation;
    const active = () => generation === this.generation;
    try {
      // Always select the broadcast being analysed; a paused seller tab must not
      // silently supply audio for a different comment collector target.
      const stream = await screenCaptureService.getOrCreateStream(true);
      if (!active()) {
        if (stream === screenCaptureService.getActiveStream()) {
          screenCaptureService.stopStream();
        }
        return;
      }
      this.stream = stream;
      const track = stream?.getAudioTracks().find((t) =>
        t.readyState === "live"
      );
      if (!track) {
        throw new Error("분석할 방송 탭의 오디오 공유를 선택해 주세요.");
      }
      const ended = () => {
        if (active()) {
          this.stop();
          options.status("청취 중지: 방송 탭 오디오 공유가 종료되었습니다.");
        }
      };
      track.addEventListener("ended", ended);
      this.off.push(() => track.removeEventListener("ended", ended));
      const startComments = () => {
        if (active() && commentStreamService.isConnectedToServer) {
          commentStreamService.configureCloudPublishing({ sessionId: null });
          commentStreamService.startCollecting(options.username);
        }
      };
      this.off.push(commentStreamService.onComment((c) => {
        if (active()) {
          options.comment({
            id: c.id || crypto.randomUUID(),
            platformMessageId: c.id,
            platformUserId: c.userId,
            uniqueId: c.uniqueId,
            nickname: c.nickname,
            content: c.content,
            capturedAt: c.receivedAt || new Date().toISOString(),
            sessionId: options.sessionId,
          });
        }
      }));
      this.off.push(commentStreamService.onStatus((s, m) => {
        if (active()) {
          options.status(m || s);
          if (s === "CONNECTED") startComments();
        }
      }));
      commentStreamService.connect(options.serverUrl);
      startComments();
      this.stt.startLiveStream(options.stt, (data) => {
        if (active() && data.isFinal && data.text.trim()) {
          options.transcript({
            id: crypto.randomUUID(),
            text: data.text,
            recognizedAt: new Date().toISOString(),
            isFinal: true,
          });
        }
      }, (error) => {
        if (active()) {
          this.stop();
          options.status(`청취 중지: ${error}`);
        }
      }, (s, m) => {
        if (!active()) return;
        if (s === "ERROR" || s === "DISCONNECTED") {
          this.stop();
          options.status(`청취 중지: ${m || s}`);
        } else options.status(m || s);
      });
      await this.audio.startCapture("TAB_AUDIO", (chunk) => {
        if (active()) this.stt.sendAudioChunk(chunk);
      }, () => {});
      if (!active()) this.audio.stopCapture(false);
    } catch (e) {
      this.stop();
      throw e;
    }
  }
  stop() {
    ++this.generation;
    this.off.forEach((f) => f());
    this.off = [];
    this.stt.stopLiveStream();
    this.audio.stopCapture(false);
    commentStreamService.stopCollecting();
    if (this.stream && this.stream === screenCaptureService.getActiveStream()) {
      screenCaptureService.stopStream();
    }
    this.stream = null;
  }
}
