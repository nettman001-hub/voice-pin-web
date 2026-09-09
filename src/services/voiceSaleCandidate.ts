export type CandidateType = 'PRODUCT_REGISTRATION' | 'SALE';

export type CandidateState =
  | 'IDLE'
  | 'EDITING'
  | 'COUNTDOWN'
  | 'SAVING'
  | 'SAVED'
  | 'ERROR'
  | 'CANCELLED';

export interface VoiceSaleCandidate {
  id: string;
  type: CandidateType;
  sessionId: string;
  sessionRevision: number;
  productId?: string;
  productRevision?: number;
  productCode?: string;
  productName?: string;
  unitPrice?: number;
  buyerId?: string;
  buyerNickname?: string;
  quantity: number;
  sourceCommentId?: string;
  state: CandidateState;
  error?: string;
  countdownMs: number;
  totalMs: number;
}

export interface VoiceCommandsConfig {
  registerProduct?: string[];
  captureProduct?: string[];
  setProductName?: string[];
  setPrice?: string[];
  confirmSale?: string[];
  setBuyer?: string[];
}

export interface ParsedVoiceCommand {
  action: 'registerProduct' | 'captureProduct' | 'setProductName' | 'setPrice' | 'confirmSale' | 'setBuyer' | 'unknown';
  numberParam?: number;
  textParam?: string;
  rawText: string;
}

export function parseKoreanNumber(text: string): number | undefined {
  if (!text) return undefined;

  // 0. 소숫점 가격 표현 감지 (예: "1.7" -> 17,000원)
  const decimalMatch = text.match(/(?<!\d\.)(?<!\d)(\d{1,3})\s*(?:[.]|점)\s*(\d{1,2})(?!\.\d)(?!\s*(?:월|일|시|분|초|버전|ver))\b/u);
  if (decimalMatch) {
    const compactValue = Number(`${decimalMatch[1]}.${decimalMatch[2]}`);
    if (Number.isFinite(compactValue) && compactValue > 0) {
      return Math.round(compactValue * 10000);
    }
  }

  const cleaned = text.replace(/[, \s]/g, '');

  const numMatch = cleaned.match(/(\d+)/);
  if (numMatch) {
    let val = parseInt(numMatch[1], 10);
    if (cleaned.includes('만')) {
      val = val * 10000;
    }
    return val;
  }

  const koreanUnits: [string, number][] = [
    ['십만', 100000],
    ['만오천', 15000],
    ['이만', 20000],
    ['삼만', 30000],
    ['사만', 40000],
    ['오만', 50000],
    ['만', 10000],
    ['구천', 9000],
    ['팔천', 8000],
    ['칠천', 7000],
    ['육천', 6000],
    ['오천', 5000],
    ['사천', 4000],
    ['삼천', 3000],
    ['이천', 2000],
    ['천', 1000],
  ];

  for (const [word, val] of koreanUnits) {
    if (cleaned.includes(word)) {
      return val;
    }
  }

  const singleDigits: Record<string, number> = {
    하나: 1,
    한: 1,
    일: 1,
    둘: 2,
    두: 2,
    이: 2,
    셋: 3,
    세: 3,
    삼: 3,
    넷: 4,
    네: 4,
    사: 4,
    다섯: 5,
    오: 5,
  };

  for (const [k, v] of Object.entries(singleDigits)) {
    if (cleaned.includes(k)) return v;
  }

  return undefined;
}

export function parseVoiceCommand(
  transcript: string,
  commandsConfig?: VoiceCommandsConfig
): ParsedVoiceCommand {
  const text = transcript.trim();
  const lower = text.toLowerCase();

  const cfg: VoiceCommandsConfig = commandsConfig || {
    registerProduct: ['상품등록', '등록'],
    captureProduct: ['상품캡처'],
    setProductName: ['상품번호', '상품명'],
    setPrice: ['단가', '가격', '금액', '원'],
    confirmSale: ['판매', '확정', '낙찰', '판매완료', '구매확정'],
    setBuyer: ['닉네임'],
  };

  function matches(words?: string[]): boolean {
    if (!words || !Array.isArray(words)) return false;
    return words.some((w) => lower.includes(w.toLowerCase()));
  }

  const numberParam = parseKoreanNumber(text);

  if (matches(cfg.registerProduct)) {
    return { action: 'registerProduct', numberParam, textParam: text, rawText: text };
  }
  if (matches(cfg.captureProduct)) {
    return { action: 'captureProduct', textParam: text, rawText: text };
  }
  if (matches(cfg.setPrice)) {
    return { action: 'setPrice', numberParam, textParam: text, rawText: text };
  }
  if (matches(cfg.setProductName)) {
    const cleaned = text.replace(/^(상품번호|상품명)\s*/, '').trim();
    return { action: 'setProductName', numberParam, textParam: cleaned, rawText: text };
  }
  if (matches(cfg.confirmSale)) {
    return { action: 'confirmSale', numberParam: numberParam || 1, textParam: text, rawText: text };
  }
  if (matches(cfg.setBuyer)) {
    const cleaned = text.replace(/^닉네임\s*/, '').trim();
    return { action: 'setBuyer', textParam: cleaned, rawText: text };
  }

  return { action: 'unknown', numberParam, textParam: text, rawText: text };
}

export class VoiceCandidateController {
  private candidate: VoiceSaleCandidate | null = null;
  private timer: any = null;
  private onStateChange: (candidate: VoiceSaleCandidate | null) => void;
  private onCommit: (candidate: VoiceSaleCandidate) => Promise<void>;
  private defaultPreviewMs: number;

  constructor(
    defaultPreviewMs = 2500,
    onStateChange: (candidate: VoiceSaleCandidate | null) => void,
    onCommit: (candidate: VoiceSaleCandidate) => Promise<void>
  ) {
    this.defaultPreviewMs = defaultPreviewMs;
    this.onStateChange = onStateChange;
    this.onCommit = onCommit;
  }

  public getCandidate(): VoiceSaleCandidate | null {
    return this.candidate;
  }

  public setCandidate(c: VoiceSaleCandidate | null) {
    this.clearTimer();
    this.candidate = c;
    this.onStateChange(this.candidate);
  }

  public createCandidate(
    type: CandidateType,
    sessionId: string,
    sessionRevision: number,
    productId?: string,
    productRevision?: number,
    unitPrice?: number,
    buyerId?: string,
    buyerNickname?: string,
    quantity = 1,
    sourceCommentId?: string
  ): VoiceSaleCandidate {
    this.clearTimer();
    const candidate: VoiceSaleCandidate = {
      id: `cand-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type,
      sessionId,
      sessionRevision,
      productId,
      productRevision,
      unitPrice,
      buyerId,
      buyerNickname,
      quantity,
      sourceCommentId,
      state: 'COUNTDOWN',
      countdownMs: this.defaultPreviewMs,
      totalMs: this.defaultPreviewMs,
    };

    // Validation
    if (type === 'SALE') {
      if (unitPrice === undefined || unitPrice === null) {
        candidate.state = 'ERROR';
        candidate.error = '판매 단가를 입력해 주세요.';
      } else if (!buyerId && !buyerNickname) {
        candidate.state = 'ERROR';
        candidate.error = '구매자 정보가 누락되었습니다.';
      }
    }

    this.candidate = candidate;
    this.onStateChange(this.candidate);

    if (candidate.state === 'COUNTDOWN') {
      this.startCountdown();
    }

    return candidate;
  }

  public startCountdown() {
    this.clearTimer();
    if (!this.candidate || this.candidate.state !== 'COUNTDOWN') return;

    const interval = 100;
    this.timer = setInterval(async () => {
      if (!this.candidate || this.candidate.state !== 'COUNTDOWN') {
        this.clearTimer();
        return;
      }

      this.candidate.countdownMs = Math.max(0, this.candidate.countdownMs - interval);
      this.onStateChange({ ...this.candidate });

      if (this.candidate.countdownMs <= 0) {
        this.clearTimer();
        this.candidate.state = 'SAVING';
        this.onStateChange({ ...this.candidate });
        try {
          await this.onCommit(this.candidate);
          if (this.candidate) {
            this.candidate.state = 'SAVED';
            this.onStateChange({ ...this.candidate });
          }
        } catch (err: any) {
          if (this.candidate) {
            this.candidate.state = 'ERROR';
            this.candidate.error = err.message || '저장 중 오류가 발생했습니다.';
            this.onStateChange({ ...this.candidate });
          }
        }
      }
    }, interval);
  }

  public pauseEditing() {
    this.clearTimer();
    if (this.candidate) {
      this.candidate.state = 'EDITING';
      this.onStateChange({ ...this.candidate });
    }
  }

  public resumeCountdown() {
    if (this.candidate && this.candidate.state === 'EDITING') {
      this.candidate.state = 'COUNTDOWN';
      this.candidate.countdownMs = this.defaultPreviewMs;
      this.onStateChange({ ...this.candidate });
      this.startCountdown();
    }
  }

  public cancel() {
    this.clearTimer();
    if (this.candidate) {
      this.candidate.state = 'CANCELLED';
      this.onStateChange({ ...this.candidate });
      this.candidate = null;
      this.onStateChange(null);
    }
  }

  private clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
