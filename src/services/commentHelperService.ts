import {
  CommentHelperStatus,
  PrintSettings,
  PrinterDevice,
  SttStatus,
  SttDeviceInfo
} from '../types/helper';

const LOCAL_SERVER_ORIGIN = 'http://127.0.0.1:2137';

const DEFAULT_HELPER_STATUS: CommentHelperStatus = {
  helper: 'starting',
  message: '댓글 서버 연결 확인 중...',
  tiktokState: 'idle',
  tiktokUsername: '',
  viewerCount: 0,
  totalComments: 0,
  lastCheckedAt: null,
  version: '1.3.7',
  autoStart: false,
  webAppUrl: '',
  stt: null,
  print: {
    enabled: false,
    printerName: '',
    paperSize: 'LABEL_50_30',
    message: '프린터를 선택하면 판매 전표를 자동으로 출력합니다.'
  }
};

class CommentHelperService {
  private hasNativeBridge(): boolean {
    return typeof window !== 'undefined' && Boolean(window.voicecap);
  }

  /**
   * 댓글 도우미 및 서버의 전체 상태를 조회합니다.
   */
  async getStatus(): Promise<CommentHelperStatus> {
    if (this.hasNativeBridge()) {
      try {
        return await window.voicecap!.getStatus();
      } catch (err) {
        console.warn('[CommentHelperService] Native getStatus failed, falling back to HTTP:', err);
      }
    }

    try {
      const res = await fetch(`${LOCAL_SERVER_ORIGIN}/status`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tiktok = data.tiktok || {};
      return {
        ...DEFAULT_HELPER_STATUS,
        helper: 'running',
        message: tiktok.message || '댓글 서버가 정상 작동 중입니다.',
        tiktokState: tiktok.state || 'idle',
        tiktokUsername: tiktok.username || '',
        viewerCount: Number(tiktok.viewerCount || 0),
        totalComments: Number(tiktok.totalComments || 0),
        stt: data.stt || null,
        lastCheckedAt: new Date().toISOString()
      };
    } catch {
      return {
        ...DEFAULT_HELPER_STATUS,
        helper: 'error',
        message: '댓글 도우미 서버(127.0.0.1:2137)에 연결할 수 없습니다.'
      };
    }
  }

  /**
   * 댓글 서버를 다시 시작합니다.
   */
  async restart(): Promise<CommentHelperStatus> {
    if (this.hasNativeBridge()) {
      return await window.voicecap!.restart();
    }
    return this.getStatus();
  }

  async restartServer(): Promise<CommentHelperStatus> {
    return this.restart();
  }

  /**
   * 설치된 Windows 프린터 목록을 조회합니다.
   */
  async getPrinters(): Promise<PrinterDevice[]> {
    if (this.hasNativeBridge()) {
      try {
        return await window.voicecap!.getPrinters();
      } catch (err) {
        console.error('[CommentHelperService] getPrinters error:', err);
        return [];
      }
    }
    return [];
  }

  /**
   * 프린터 출력 설정을 저장합니다.
   */
  async savePrintSettings(settings: Partial<PrintSettings>): Promise<PrintSettings> {
    if (this.hasNativeBridge()) {
      return await window.voicecap!.savePrintSettings(settings);
    }
    return {
      enabled: Boolean(settings.enabled),
      printerName: settings.printerName || '',
      paperSize: settings.paperSize || 'LABEL_50_30',
      message: '웹 브라우저에서는 Windows 프린터를 직접 제어할 수 없습니다. VoiceCAP 댓글 도우미를 실행해 주세요.'
    };
  }

  /**
   * 세 줄 전표 테스트 인쇄를 실행합니다.
   */
  async testPrint(): Promise<{ ok: boolean; status: string; error?: string }> {
    if (this.hasNativeBridge()) {
      return await window.voicecap!.testPrint();
    }
    return {
      ok: false,
      status: 'FAILED',
      error: '테스트 인쇄는 VoiceCAP 댓글 도우미에서만 실행할 수 있습니다.'
    };
  }

  /**
   * 윈도우 부팅 시 자동 실행을 설정합니다.
   */
  async setAutoStart(enabled: boolean): Promise<boolean> {
    if (this.hasNativeBridge()) {
      return await window.voicecap!.setAutoStart(enabled);
    }
    return false;
  }

  /**
   * 오프라인 STT 연산 장치를 설정합니다.
   */
  async setSttDevice(device: string): Promise<SttStatus> {
    if (this.hasNativeBridge()) {
      return await window.voicecap!.setSttDevice(device);
    }
    try {
      const res = await fetch(`${LOCAL_SERVER_ORIGIN}/api/stt/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device })
      });
      return await res.json();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '장치 설정 실패' };
    }
  }

  /**
   * PC의 GPU 및 CPU 연산 장치를 재감지합니다.
   */
  async detectSttDevices(): Promise<{ ok: boolean; devices?: SttDeviceInfo[]; error?: string }> {
    if (this.hasNativeBridge()) {
      return await window.voicecap!.detectSttDevices();
    }
    try {
      const res = await fetch(`${LOCAL_SERVER_ORIGIN}/api/stt/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      return await res.json();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '장치 감지 실패' };
    }
  }

  /**
   * 문제 진단 로그 폴더/파일을 엽니다.
   */
  async openLogs(): Promise<void> {
    if (this.hasNativeBridge()) {
      await window.voicecap!.openLogs();
    }
  }

  /**
   * 도우미 상태 변경 이벤트를 구독합니다.
   */
  subscribeStatus(listener: (status: CommentHelperStatus) => void): () => void {
    if (this.hasNativeBridge()) {
      return window.voicecap!.onStatus(listener);
    }
    // 웹 환경에서는 3초 간격 폴링
    let active = true;
    const poll = async () => {
      if (!active) return;
      const status = await this.getStatus();
      if (active) listener(status);
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }
}

export const commentHelperService = new CommentHelperService();
