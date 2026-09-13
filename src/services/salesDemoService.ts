import { CommentRecord } from '../types/comment';
import { MatchedRuleItem } from '../context/LiveContext';
import { SaleRecord, SttTranscriptLog } from '../types/live';

export interface SalesDemoCallbacks {
  onWaveform?: (audioLevel: number, waveform: Uint8Array) => void;
  onComment?: (comment: CommentRecord) => void;
  onCommentsBatch?: (comments: CommentRecord[]) => void;
  onTranscriptInterim?: (text: string) => void;
  onTranscriptFinal?: (log: SttTranscriptLog) => void;
  onTranscriptReset?: (logs: SttTranscriptLog[]) => void;
  onMatchedRule?: (item: MatchedRuleItem | null) => void;
  onSalesUpdate?: (sales: SaleRecord[]) => void;
  onTotalsUpdate?: (count: number, amount: number) => void;
  onStatusChange?: (isRunning: boolean, elapsedSeconds: number) => void;
}

// 오프라인/네트워크 무관하게 고화질로 렌더링되는 가상 상품 SVG 이미지
const PRODUCT_IMAGES = {
  denimJacket: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"><rect width="100" height="100" rx="16" fill="%23e0f2fe"/><path d="M25 35 L38 25 L50 32 L62 25 L75 35 L70 78 L30 78 Z" fill="%230284c7"/><path d="M50 32 L50 78" stroke="%2338bdf8" stroke-width="2" stroke-dasharray="3 3"/><circle cx="50" cy="45" r="3" fill="%23bae6fd"/><circle cx="50" cy="58" r="3" fill="%23bae6fd"/><circle cx="50" cy="71" r="3" fill="%23bae6fd"/><text x="50" y="92" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="10" fill="%230369a1">01 데님자켓</text></svg>`,
  cashmereKnit: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"><rect width="100" height="100" rx="16" fill="%23fef3c7"/><path d="M26 36 L38 26 L50 33 L62 26 L74 36 L68 76 L32 76 Z" fill="%23d97706"/><ellipse cx="50" cy="33" rx="12" ry="6" fill="%23b45309"/><path d="M38 46 L62 46 M38 56 L62 56 M38 66 L62 66" stroke="%23fde68a" stroke-width="2"/><text x="50" y="92" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="10" fill="%23b45309">02 캐시미어</text></svg>`,
  pleatsDress: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"><rect width="100" height="100" rx="16" fill="%23fce7f3"/><path d="M36 26 L64 26 L60 48 L76 80 L24 80 L40 48 Z" fill="%23db2777"/><path d="M35 80 L44 48 M50 80 L50 48 M65 80 L56 48" stroke="%23fbcfe8" stroke-width="2"/><circle cx="50" cy="36" r="3.5" fill="%23fdf2f8"/><text x="50" y="92" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="10" fill="%23be185d">03 롱원피스</text></svg>`,
  woolCoat: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"><rect width="100" height="100" rx="16" fill="%23f1f5f9"/><path d="M28 28 L50 24 L72 28 L78 82 L22 82 Z" fill="%23475569"/><path d="M50 24 L50 82" stroke="%2394a3b8" stroke-width="2"/><path d="M35 34 L50 48 L65 34" stroke="%23cbd5e1" stroke-width="3" fill="none"/><text x="50" y="92" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="10" fill="%23334155">04 울 코트</text></svg>`,
};

class SalesDemoService {
  private active = false;
  private callbacks: SalesDemoCallbacks = {};
  private timers: number[] = [];
  private audioIntervalId: number | null = null;
  private clockIntervalId: number | null = null;
  private elapsedSeconds = 0;
  private currentSales: SaleRecord[] = [];
  private currentComments: CommentRecord[] = [];
  private currentTranscriptLogs: SttTranscriptLog[] = [];
  private audioPhase = 0;
  private isSpeaking = false;

  public isRunning(): boolean {
    return this.active;
  }

  public getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  public start(callbacks: SalesDemoCallbacks): void {
    if (this.active) {
      this.stop();
    }

    this.active = true;
    this.callbacks = callbacks;
    this.elapsedSeconds = 0;
    this.currentSales = [];
    this.currentComments = [];
    this.currentTranscriptLogs = [];
    this.audioPhase = 0;
    this.isSpeaking = true;

    // 상태 변경 알림
    this.callbacks.onStatusChange?.(true, 0);
    this.callbacks.onTotalsUpdate?.(0, 0);
    this.callbacks.onSalesUpdate?.([]);
    this.callbacks.onCommentsBatch?.([]);
    this.callbacks.onTranscriptReset?.([]);
    this.callbacks.onTranscriptInterim?.('');
    this.callbacks.onMatchedRule?.(null);

    // 1. 오디오 파형 및 레벨 시뮬레이터 (60fps 수준 부드러운 애니메이션)
    this.startAudioSimulator();

    // 2. 1초 간격 진행 타이머
    this.clockIntervalId = window.setInterval(() => {
      if (!this.active) return;
      this.elapsedSeconds += 1;
      this.callbacks.onStatusChange?.(true, this.elapsedSeconds);
    }, 1000);

    // 3. 실시간 영업 데모 타임라인 스케줄링
    this.scheduleScenarioTimeline();
  }

  public stop(): void {
    this.active = false;
    this.clearAllTimers();

    if (this.audioIntervalId !== null) {
      window.clearInterval(this.audioIntervalId);
      this.audioIntervalId = null;
    }
    if (this.clockIntervalId !== null) {
      window.clearInterval(this.clockIntervalId);
      this.clockIntervalId = null;
    }

    // 오디오 파형 제로 리셋
    this.callbacks.onWaveform?.(0, new Uint8Array(128));
    this.callbacks.onTranscriptInterim?.('');
    this.callbacks.onStatusChange?.(false, 0);
    this.callbacks = {};
  }

  private clearAllTimers(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
  }

  private schedule(fn: () => void, delayMs: number): void {
    if (!this.active) return;
    const timer = window.setTimeout(() => {
      if (!this.active) return;
      fn();
    }, delayMs);
    this.timers.push(timer);
  }

  // 자연스러운 음성 오디오 레벨 및 파형 합성
  private startAudioSimulator(): void {
    const buffer = new Uint8Array(128);

    this.audioIntervalId = window.setInterval(() => {
      if (!this.active) return;

      this.audioPhase += 0.15;
      const baseLevel = this.isSpeaking
        ? 0.42 + 0.38 * Math.sin(this.audioPhase * 2.2) * Math.cos(this.audioPhase * 1.3)
        : 0.04 + 0.05 * Math.sin(this.audioPhase * 0.5);

      const audioLevel = Math.max(0.02, Math.min(0.98, Math.abs(baseLevel)));

      for (let i = 0; i < 128; i++) {
        // 음성 주파수 피크(모음 대역) 및 랜덤 노이즈 결합
        const center = 128 / 2;
        const dist = Math.abs(i - center) / center;
        const bell = Math.exp(-dist * dist * 3.5);
        const wave = Math.sin(this.audioPhase * 4 + i * 0.28) * 0.4 +
                     Math.cos(this.audioPhase * 7 - i * 0.15) * 0.3 +
                     (Math.random() - 0.5) * 0.25;
        const val = 128 + (wave * bell * audioLevel * 115);
        buffer[i] = Math.max(10, Math.min(245, Math.floor(val)));
      }

      this.callbacks.onWaveform?.(audioLevel, buffer);
    }, 50);
  }

  private playChimeBeep(frequency = 1046, durationMs = 120): void {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch {
      // 브라우저 오토플레이 제한 시 무시
    }
  }

  // 실시간 시연 시나리오 타임라인 등록
  private scheduleScenarioTimeline(): void {
    const demoSessionId = `DEMO_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

    // ==========================================
    // 시나리오 1: 1번 청자켓 (초코송이님 35,000원)
    // ==========================================
    // [1.2초] 댓글 유입
    this.schedule(() => {
      this.addDemoComment({
        id: `demo-cmt-1`,
        sessionId: demoSessionId,
        nickname: '초코송이',
        content: '1번 청자켓 55 사이즈 있나요??',
        capturedAt: new Date().toISOString(),
      });
    }, 1200);

    this.schedule(() => {
      this.addDemoComment({
        id: `demo-cmt-2`,
        sessionId: demoSessionId,
        nickname: '민지맘',
        content: '1번 저 살게요!',
        capturedAt: new Date().toISOString(),
      });
    }, 2400);

    // [3.6초] 호스트 발화 Interim (실시간 타이핑 자막)
    this.schedule(() => {
      this.isSpeaking = true;
      this.callbacks.onTranscriptInterim?.('구매확정 됐습니다! 1번...');
    }, 3600);

    this.schedule(() => {
      this.callbacks.onTranscriptInterim?.('구매확정 됐습니다! 1번 청자켓 35,000원 초코송이님');
    }, 4500);

    // [5.2초] 호스트 발화 확정 및 규칙 감지
    this.schedule(() => {
      this.callbacks.onTranscriptInterim?.('');
      const text = '구매확정 됐습니다! 1번 청자켓 35,000원 구매하신 분은 초코송이님 이시구요.';
      this.addTranscriptLog({
        id: `demo-log-1`,
        timestamp: new Date().toLocaleTimeString('ko-KR'),
        text,
        isFinal: true,
        confidence: 0.99,
        matchedKeywords: ['구매확정', '35,000원', '초코송이'],
        actionTriggered: 'SALE_SAVED'
      });

      this.callbacks.onMatchedRule?.({
        text,
        matchedKeywords: ['구매확정', '35,000원', '초코송이'],
        action: '🛍️ 판매 DB 자동 저장',
        timestamp: new Date().toLocaleTimeString('ko-KR')
      });
      this.playChimeBeep(1046, 120);
    }, 5200);

    // [5.8초] 1번 판매 내역 자동 적재 (전표 출력 중)
    this.schedule(() => {
      const sale1: SaleRecord = {
        id: `demo-sale-1`,
        sessionId: demoSessionId,
        buyerNickname: '초코송이',
        amount: 35000,
        recognizedAt: new Date().toISOString(),
        rawTranscript: '구매확정 됐습니다! 1번 청자켓 35,000원 구매하신 분은 초코송이님 이시구요.',
        status: '자동저장',
        productName: '프리미엄 데님 자켓',
        productCode: '01',
        productImageUrl: PRODUCT_IMAGES.denimJacket,
        source: 'WEB_VOICE',
        printStatus: 'QUEUED',
        note: '댓글 닉네임 검증 완료 (초코송이)',
      };
      this.addDemoSale(sale1);
    }, 5800);

    // [7.2초] 1번 전표 출력 완료
    this.schedule(() => {
      this.updateDemoSale('demo-sale-1', { printStatus: 'PRINTED' });
    }, 7200);

    // ==========================================
    // 시나리오 2: 2번 캐시미어 니트 + 댓글창 캡처 연동
    // ==========================================
    // [8.8초] 2차 댓글 유입
    this.schedule(() => {
      this.addDemoComment({
        id: `demo-cmt-3`,
        sessionId: demoSessionId,
        nickname: '동대문언니',
        content: '2번 캐시미어 니트 주문이요~',
        capturedAt: new Date().toISOString(),
      });
    }, 8800);

    this.schedule(() => {
      this.addDemoComment({
        id: `demo-cmt-4`,
        sessionId: demoSessionId,
        nickname: '달콤한하루',
        content: '니트 색상 너무 화사하네요!',
        capturedAt: new Date().toISOString(),
      });
    }, 9800);

    // [11.0초] 호스트 발화 ("캡처하세요" 연동)
    this.schedule(() => {
      this.isSpeaking = true;
      this.callbacks.onTranscriptInterim?.('2번 캐시미어 니트 29,000원...');
    }, 11000);

    this.schedule(() => {
      this.callbacks.onTranscriptInterim?.('');
      const text = '2번 캐시미어 니트 29,000원 동대문언니님 구매확정입니다. 화면 캡처하세요.';
      this.addTranscriptLog({
        id: `demo-log-2`,
        timestamp: new Date().toLocaleTimeString('ko-KR'),
        text,
        isFinal: true,
        confidence: 0.98,
        matchedKeywords: ['구매확정', '29,000원', '캡처하세요'],
        actionTriggered: 'SALE_SAVED'
      });

      this.callbacks.onMatchedRule?.({
        text,
        matchedKeywords: ['구매확정', '29,000원', '캡처하세요'],
        action: '🛍️ 판매 DB 저장 + 📸 캡처하세요 연동',
        timestamp: new Date().toLocaleTimeString('ko-KR')
      });
      this.playChimeBeep(1046, 120);
    }, 12200);

    // [12.8초] 2번 판매 적재
    this.schedule(() => {
      const sale2: SaleRecord = {
        id: `demo-sale-2`,
        sessionId: demoSessionId,
        buyerNickname: '동대문언니',
        amount: 29000,
        recognizedAt: new Date().toISOString(),
        rawTranscript: '2번 캐시미어 니트 29,000원 동대문언니님 구매확정입니다. 화면 캡처하세요.',
        status: '자동저장',
        productName: '소프트 캐시미어 니트',
        productCode: '02',
        productImageUrl: PRODUCT_IMAGES.cashmereKnit,
        source: 'WEB_VOICE',
        printStatus: 'QUEUED',
        note: '댓글 닉네임 검증 완료 (동대문언니)',
      };
      this.addDemoSale(sale2);
    }, 12800);

    // [14.0초] 2번 전표 출력 완료
    this.schedule(() => {
      this.updateDemoSale('demo-sale-2', { printStatus: 'PRINTED' });
    }, 14000);

    // ==========================================
    // 시나리오 3: 음성 정정 시연 (Voice Correction AI)
    // "동대문언니님이 아니고 민지맘님으로 변경"
    // ==========================================
    this.schedule(() => {
      this.isSpeaking = true;
      this.callbacks.onTranscriptInterim?.('어 잠시만요 2번 방금 구매하신 분...');
    }, 16200);

    this.schedule(() => {
      this.callbacks.onTranscriptInterim?.('');
      const text = '어 잠시만요! 2번 방금 구매하신 분 동대문언니님이 아니고 민지맘님으로 변경할게요!';
      this.addTranscriptLog({
        id: `demo-log-3`,
        timestamp: new Date().toLocaleTimeString('ko-KR'),
        text,
        isFinal: true,
        confidence: 0.99,
        matchedKeywords: ['아니고', '변경'],
        actionTriggered: 'VOICE_EDIT_START'
      });

      this.callbacks.onMatchedRule?.({
        text,
        matchedKeywords: ['아니고', '변경'],
        action: '✏️ 구매자 정정 감지 (동대문언니 ➔ 민지맘)',
        timestamp: new Date().toLocaleTimeString('ko-KR')
      });
      this.playChimeBeep(880, 160);
    }, 17500);

    // [18.2초] 2번 판매 내역 실시간 자동 정정 완료 반영
    this.schedule(() => {
      this.updateDemoSale('demo-sale-2', {
        buyerNickname: '민지맘',
        status: '수동수정',
        note: '음성 정정 적용 완료 (동대문언니 ➔ 민지맘)',
        printStatus: 'PRINTED'
      });
    }, 18200);

    // ==========================================
    // 시나리오 4: 3번 플리츠 롱원피스 (러블리님 48,000원)
    // ==========================================
    this.schedule(() => {
      this.addDemoComment({
        id: `demo-cmt-5`,
        sessionId: demoSessionId,
        nickname: '러블리',
        content: '3번 롱원피스 48,000원 살게요!',
        capturedAt: new Date().toISOString(),
      });
    }, 20500);

    this.schedule(() => {
      this.isSpeaking = true;
      this.callbacks.onTranscriptInterim?.('3번 플리츠 롱원피스 48,000원...');
    }, 22200);

    this.schedule(() => {
      this.callbacks.onTranscriptInterim?.('');
      const text = '3번 플리츠 롱원피스 48,000원 러블리님 구매확정입니다!';
      this.addTranscriptLog({
        id: `demo-log-4`,
        timestamp: new Date().toLocaleTimeString('ko-KR'),
        text,
        isFinal: true,
        confidence: 0.99,
        matchedKeywords: ['구매확정', '48,000원', '러블리'],
        actionTriggered: 'SALE_SAVED'
      });

      this.callbacks.onMatchedRule?.({
        text,
        matchedKeywords: ['구매확정', '48,000원', '러블리'],
        action: '🛍️ 판매 DB 자동 저장',
        timestamp: new Date().toLocaleTimeString('ko-KR')
      });
      this.playChimeBeep(1046, 120);
    }, 23500);

    // [24.0초] 3번 판매 적재
    this.schedule(() => {
      const sale3: SaleRecord = {
        id: `demo-sale-3`,
        sessionId: demoSessionId,
        buyerNickname: '러블리',
        amount: 48000,
        recognizedAt: new Date().toISOString(),
        rawTranscript: '3번 플리츠 롱원피스 48,000원 러블리님 구매확정입니다!',
        status: '자동저장',
        productName: '데일리 플리츠 롱원피스',
        productCode: '03',
        productImageUrl: PRODUCT_IMAGES.pleatsDress,
        source: 'WEB_VOICE',
        printStatus: 'QUEUED',
        note: '댓글 닉네임 검증 완료 (러블리)',
      };
      this.addDemoSale(sale3);
    }, 24000);

    this.schedule(() => {
      this.updateDemoSale('demo-sale-3', { printStatus: 'PRINTED' });
    }, 25500);

    // ==========================================
    // 시나리오 5: 4번 울 코트 (별빛천사님 79,000원)
    // ==========================================
    this.schedule(() => {
      this.addDemoComment({
        id: `demo-cmt-6`,
        sessionId: demoSessionId,
        nickname: '별빛천사',
        content: '4번 코트 베이지 있나요? 주문할게요',
        capturedAt: new Date().toISOString(),
      });
    }, 28000);

    this.schedule(() => {
      this.isSpeaking = true;
      this.callbacks.onTranscriptInterim?.('4번 핸드메이드 울 코트 79,000원...');
    }, 29800);

    this.schedule(() => {
      this.callbacks.onTranscriptInterim?.('');
      const text = '4번 핸드메이드 울 코트 79,000원 별빛천사님 구매확정 되셨습니다!';
      this.addTranscriptLog({
        id: `demo-log-5`,
        timestamp: new Date().toLocaleTimeString('ko-KR'),
        text,
        isFinal: true,
        confidence: 0.99,
        matchedKeywords: ['구매확정', '79,000원', '별빛천사'],
        actionTriggered: 'SALE_SAVED'
      });

      this.callbacks.onMatchedRule?.({
        text,
        matchedKeywords: ['구매확정', '79,000원', '별빛천사'],
        action: '🛍️ 판매 DB 자동 저장',
        timestamp: new Date().toLocaleTimeString('ko-KR')
      });
      this.playChimeBeep(1046, 120);
    }, 31000);

    this.schedule(() => {
      const sale4: SaleRecord = {
        id: `demo-sale-4`,
        sessionId: demoSessionId,
        buyerNickname: '별빛천사',
        amount: 79000,
        recognizedAt: new Date().toISOString(),
        rawTranscript: '4번 핸드메이드 울 코트 79,000원 별빛천사님 구매확정 되셨습니다!',
        status: '자동저장',
        productName: '핸드메이드 울 코트',
        productCode: '04',
        productImageUrl: PRODUCT_IMAGES.woolCoat,
        source: 'WEB_VOICE',
        printStatus: 'QUEUED',
        note: '댓글 닉네임 검증 완료 (별빛천사)',
      };
      this.addDemoSale(sale4);
    }, 31600);

    this.schedule(() => {
      this.updateDemoSale('demo-sale-4', { printStatus: 'PRINTED' });
    }, 33000);

    // ==========================================
    // 시나리오 6: 이후 주기적인 배경 댓글 및 추가 호스트 소통 (데모가 멈추지 않고 지속)
    // ==========================================
    this.scheduleRecurringAmbientComments(demoSessionId, 36000);
  }

  private addDemoSale(sale: SaleRecord): void {
    this.currentSales = [sale, ...this.currentSales];
    this.callbacks.onSalesUpdate?.([...this.currentSales]);
    this.recomputeTotals();
  }

  private updateDemoSale(saleId: string, patch: Partial<SaleRecord>): void {
    this.currentSales = this.currentSales.map((s) => s.id === saleId ? { ...s, ...patch } : s);
    this.callbacks.onSalesUpdate?.([...this.currentSales]);
    this.recomputeTotals();
  }

  private recomputeTotals(): void {
    const validSales = this.currentSales.filter((s) => s.status !== '보류');
    const count = validSales.length;
    const amount = validSales.reduce((acc, s) => acc + s.amount, 0);
    this.callbacks.onTotalsUpdate?.(count, amount);
  }

  private addDemoComment(comment: CommentRecord): void {
    this.currentComments = [...this.currentComments, comment].slice(-100);
    this.callbacks.onComment?.(comment);
    this.callbacks.onCommentsBatch?.([...this.currentComments]);
  }

  private addTranscriptLog(log: SttTranscriptLog): void {
    this.currentTranscriptLogs = [log, ...this.currentTranscriptLogs].slice(0, 300);
    this.callbacks.onTranscriptFinal?.(log);
  }

  private scheduleRecurringAmbientComments(sessionId: string, startMs: number): void {
    const ambientPool = [
      { nickname: '하늘바람', content: '방금 주문한거 오늘 바로 출고되나요?' },
      { nickname: '핑크뮬리', content: '자켓 너무 예뻐요 구매하고 싶네요' },
      { nickname: '동대문언니', content: '다음 번호 상품도 보여주세요!' },
      { nickname: '수국꽃길', content: '원단이 진짜 좋아 보이네요' },
      { nickname: '햇살가득', content: '배송비는 얼마인가요?' },
      { nickname: '초코송이', content: '감사합니다 입금 바로 넣을게요!' }
    ];

    let delay = startMs;
    ambientPool.forEach((item, idx) => {
      this.schedule(() => {
        this.addDemoComment({
          id: `demo-ambient-${idx}-${Date.now()}`,
          sessionId,
          nickname: item.nickname,
          content: item.content,
          capturedAt: new Date().toISOString(),
        });
      }, delay);
      delay += 5500;
    });
  }
}

export const salesDemoService = new SalesDemoService();
