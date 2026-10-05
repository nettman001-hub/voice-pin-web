import type { SttDebugLog } from '../../types/sellerLogic02Anti';

/**
 * 간단한 영문/숫자/기호 발음 한글 변환기 (G2P: Grapheme-to-Phoneme 보조)
 * 라이브 방송에서 자주 쓰이는 영문 닉네임이나 축약어를 한국어 발음으로 확장
 */
export function generateKoreanPronunciationHints(nickname: string): string[] {
  const hints: string[] = [nickname];
  const cleaned = nickname.replace(/[^\w\s가-힣]/gu, '').trim();

  // 주요 패턴 매핑
  const lower = nickname.toLowerCase();
  if (lower.includes('xou')) hints.push('엑소', '쏘');
  if (lower.includes('jjeong')) hints.push('쩡', '정', '제이');
  if (lower.includes('ruby')) hints.push('루비');
  if (lower.includes('llaetm')) hints.push('랫엠', '라엠');
  if (lower.includes('minmin')) hints.push('민민');
  if (lower.includes('hayul')) hints.push('하율');

  // 한글 자음/모음이 들어간 경우 일반 정제형 추가
  if (cleaned && cleaned !== nickname) {
    hints.push(cleaned);
  }

  // 중복 제거
  return Array.from(new Set(hints.filter(Boolean)));
}

export interface VocabularyUpdateEvent {
  triggerType: 'IMMEDIATE_FIRST' | 'BATCH_COOLDOWN';
  newCandidates: string[];
  activeVocabulary: string[];
  vocabularyWithPronunciations: string[];
  droppedOldNicknames: string[];
  timestamp: string;
}

export interface SttVocabularyManagerOptions {
  maxVocabularySize?: number;
  batchCooldownMs?: number;
  onUpdate?: (event: VocabularyUpdateEvent) => void;
  onDebugLog?: (log: SttDebugLog) => void;
}

/**
 * STT 핫스왑 어휘 매니저
 * - 최대 50개 단어(닉네임 + G2P 발음) 관리 (LRU 정책)
 * - 사용자 지정 핵심 규칙 (Leading-edge Throttle):
 *   1) 새로운 구매의사자가 감지되는 '첫 번째' 것은 0ms 즉시 STT 세션 교체로 전달
 *   2) '두 번째' 구매의사자부터는 5초 쿨다운(배치 윈도우) 동안 중복 제거 후 모아서 한 번에 교체
 */
export class SttVocabularyManager {
  private readonly maxVocabularySize: number;
  private readonly batchCooldownMs: number;
  private activeNicknames: string[] = []; // 최신순 닉네임 리스트 (LRU)
  private pendingQueue: Set<string> = new Set(); // 5초 대기 큐 (중복 제거 Set)
  private cooldownTimer: any = null;
  private isCooldownActive = false;
  private onUpdate?: (event: VocabularyUpdateEvent) => void;
  private onDebugLog?: (log: SttDebugLog) => void;

  constructor(options: SttVocabularyManagerOptions = {}) {
    this.maxVocabularySize = options.maxVocabularySize ?? 50;
    this.batchCooldownMs = options.batchCooldownMs ?? 5000;
    this.onUpdate = options.onUpdate;
    this.onDebugLog = options.onDebugLog;
  }

  /**
   * 현재 등록된 닉네임 목록 (최신순)
   */
  public getNicknames(): string[] {
    return [...this.activeNicknames];
  }

  /**
   * STT 세션 생성 시 전달할 어휘 목록 (최대 50개, 영문 한글발음 포함)
   */
  public getSttPayloadVocabulary(): string[] {
    const list: string[] = [];
    for (const nick of this.activeNicknames) {
      const hints = generateKoreanPronunciationHints(nick);
      for (const h of hints) {
        if (!list.includes(h)) {
          list.push(h);
        }
        if (list.length >= this.maxVocabularySize) return list;
      }
    }
    return list;
  }

  /**
   * 실시간 댓글에서 닉네임 유입 시 호출
   * @param nickname 유입된 닉네임
   * @param isPurchaseIntent 구매의사 표시 여부 (AI 판단 또는 휴리스틱)
   */
  public registerNickname(nickname: string, isPurchaseIntent = false): void {
    const cleanNick = nickname.trim();
    if (!cleanNick) return;

    // 이미 최신 단어장 상위권에 완벽히 들어있다면 위치만 갱신 (LRU 최신화)
    const existingIndex = this.activeNicknames.indexOf(cleanNick);
    if (existingIndex >= 0) {
      this.activeNicknames.splice(existingIndex, 1);
      this.activeNicknames.unshift(cleanNick);
      return;
    }

    // 새로운 닉네임이고, 구매의사자일 때의 세션 핫스왑 규칙:
    if (isPurchaseIntent) {
      if (!this.isCooldownActive) {
        // [규칙 1] 첫 번째 구매의사자는 즉시 0ms 세션 재시작 트리거!
        this.emitLog('IMMEDIATE_TRIGGER', `[즉시 전송 (0ms)] 첫 번째 신규 구매의사자 감지: '${cleanNick}' -> 즉시 STT 세션 교체 트리거`, {
          nickname: cleanNick,
          reason: 'FIRST_PURCHASE_INTENT_IMMEDIATE'
        });

        this.applyNicknames([cleanNick], 'IMMEDIATE_FIRST');

        // 첫 번째 전송 직후 5초 쿨다운 시작 (이후 유입되는 것들은 5초 대기 큐로)
        this.startCooldown();
      } else {
        // [규칙 2] 두 번째 구매의사자부터는 5초 쿨다운 큐에 적재 (중복 제거)
        this.pendingQueue.add(cleanNick);
        this.emitLog('BATCH_COOLDOWN', `[5초 쿨다운 적재] 후속 구매의사자 큐 추가: '${cleanNick}' (현재 대기 큐: ${this.pendingQueue.size}명)`, {
          nickname: cleanNick,
          queue: Array.from(this.pendingQueue)
        });
      }
    } else {
      // 일반 대화 닉네임은 세션을 끊지 않고 로컬 어휘장에만 조용히 추가
      this.applyNicknamesLocally([cleanNick]);
    }
  }

  /**
   * 여러 개의 닉네임을 일괄 초기 등록할 때 사용 (방송 시작 시 최근 50명 등)
   */
  public seedInitialNicknames(nicknames: string[]): void {
    const unique = Array.from(new Set(nicknames.map(n => n.trim()).filter(Boolean)));
    this.activeNicknames = unique.slice(0, this.maxVocabularySize);

    this.emitLog('VOCAB_UPDATE', `초기 닉네임 ${this.activeNicknames.length}개로 STT 어휘장 시드 완료`, {
      count: this.activeNicknames.length,
      sample: this.activeNicknames.slice(0, 5)
    });
  }

  private startCooldown(): void {
    this.isCooldownActive = true;
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);

    this.cooldownTimer = setTimeout(() => {
      this.flushPendingQueue();
    }, this.batchCooldownMs);
  }

  private flushPendingQueue(): void {
    this.isCooldownActive = false;
    this.cooldownTimer = null;

    if (this.pendingQueue.size === 0) {
      return;
    }

    const batchedNicknames = Array.from(this.pendingQueue);
    this.pendingQueue.clear();

    this.emitLog('BATCH_COOLDOWN', `[5초 쿨다운 만료] 배치 윈도우 마감: 모인 ${batchedNicknames.length}명 닉네임 일괄 적용 -> STT 세션 1회 교체`, {
      count: batchedNicknames.length,
      nicknames: batchedNicknames
    });

    this.applyNicknames(batchedNicknames, 'BATCH_COOLDOWN');
  }

  private applyNicknames(newNicks: string[], triggerType: 'IMMEDIATE_FIRST' | 'BATCH_COOLDOWN'): void {
    const dropped: string[] = [];

    // 신규 닉네임들을 최상단으로 올림 (중복 제거)
    for (let i = newNicks.length - 1; i >= 0; i--) {
      const n = newNicks[i];
      const idx = this.activeNicknames.indexOf(n);
      if (idx >= 0) {
        this.activeNicknames.splice(idx, 1);
      }
      this.activeNicknames.unshift(n);
    }

    // 50개 초과분 제거 (LRU 제거)
    if (this.activeNicknames.length > this.maxVocabularySize) {
      const dropCount = this.activeNicknames.length - this.maxVocabularySize;
      dropped.push(...this.activeNicknames.splice(this.maxVocabularySize, dropCount));
    }

    const payloadVocab = this.getSttPayloadVocabulary();

    this.emitLog('VOCAB_UPDATE', `STT 전달 단어장 갱신 (${triggerType}): 총 ${payloadVocab.length}개 어휘 (추가: ${newNicks.join(', ')})`, {
      triggerType,
      newCandidates: newNicks,
      activeCount: this.activeNicknames.length,
      sttPayloadCount: payloadVocab.length,
      droppedCount: dropped.length
    });

    if (this.onUpdate) {
      this.onUpdate({
        triggerType,
        newCandidates: newNicks,
        activeVocabulary: [...this.activeNicknames],
        vocabularyWithPronunciations: payloadVocab,
        droppedOldNicknames: dropped,
        timestamp: new Date().toISOString()
      });
    }
  }

  private applyNicknamesLocally(newNicks: string[]): void {
    for (let i = newNicks.length - 1; i >= 0; i--) {
      const n = newNicks[i];
      const idx = this.activeNicknames.indexOf(n);
      if (idx >= 0) {
        this.activeNicknames.splice(idx, 1);
      }
      this.activeNicknames.unshift(n);
    }
    if (this.activeNicknames.length > this.maxVocabularySize) {
      this.activeNicknames.splice(this.maxVocabularySize);
    }
  }

  private emitLog(type: SttDebugLog['type'], message: string, details?: any): void {
    if (this.onDebugLog) {
      this.onDebugLog({
        id: `stt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0'),
        type,
        message,
        details
      });
    }
  }

  public destroy(): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.pendingQueue.clear();
    this.isCooldownActive = false;
  }
}
