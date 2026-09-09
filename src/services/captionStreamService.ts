/**
 * 실시간 자막 스트림 2줄 제한 및 순차 시간표시 분할 서비스
 * - 한국어 라이브 방송 자막 표준: 한 줄당 18~20자, 2줄 기준 36~42자 내외
 * - 한 번에 최대 2줄까지만 표시하고, 초과분은 문장부호/어절 경계에서 끊어서 다음 시간표시로 분할
 */

export interface CaptionFlowItem {
  id: string;
  text: string;
  timestamp: string;
}

export const DEFAULT_MAX_CHARS_PER_SUBTITLE = 40;

/**
 * 텍스트를 최대 2줄 분량(약 40자 내외)의 청크들로 분할합니다.
 * 줄바꿈(\n), 마침표/느낌표/물음표(. ! ?), 쉼표(,), 공백(어절) 순으로 자연스러운 분할 지점을 탐색합니다.
 */
export function splitTranscriptIntoTwoLineChunks(
  text: string,
  maxChars: number = DEFAULT_MAX_CHARS_PER_SUBTITLE
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // 줄바꿈이 있는 경우 줄 단위로 우선 분리
  const rawLines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rawLines.length > 1) {
    const chunks: string[] = [];
    let currentLines: string[] = [];
    let currentLen = 0;

    for (const line of rawLines) {
      const subChunks = line.length > maxChars ? splitLongLine(line, maxChars) : [line];

      for (const sub of subChunks) {
        if (
          currentLines.length === 2 ||
          (currentLines.length > 0 && currentLen + sub.length > maxChars)
        ) {
          chunks.push(currentLines.join(' '));
          currentLines = [sub];
          currentLen = sub.length;
        } else {
          currentLines.push(sub);
          currentLen += sub.length;
        }
      }
    }
    if (currentLines.length > 0) {
      chunks.push(currentLines.join(' '));
    }
    return chunks.filter(Boolean);
  }

  return splitLongLine(trimmed, maxChars);
}

function splitLongLine(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = -1;

    // 1) 문장부호(. ! ?) 기준 분할 시도 (12자 이상 ~ maxChars 이내)
    const punctRegex = /[.!?]\s+/g;
    let match: RegExpExecArray | null;
    while ((match = punctRegex.exec(remaining)) !== null) {
      const endOfPunct = match.index + match[0].length;
      if (endOfPunct >= 12 && endOfPunct <= maxChars) {
        splitIdx = endOfPunct;
      } else if (endOfPunct > maxChars) {
        break;
      }
    }

    // 2) 쉼표(,) 기준 분할 시도
    if (splitIdx === -1) {
      const commaRegex = /,\s+/g;
      while ((match = commaRegex.exec(remaining)) !== null) {
        const endOfComma = match.index + match[0].length;
        if (endOfComma >= 12 && endOfComma <= maxChars) {
          splitIdx = endOfComma;
        } else if (endOfComma > maxChars) {
          break;
        }
      }
    }

    // 3) 어절 공백 기준 분할 시도 (단어 잘림 방지)
    if (splitIdx === -1) {
      const lastSpace = remaining.lastIndexOf(' ', maxChars);
      if (lastSpace >= 12) {
        splitIdx = lastSpace + 1;
      }
    }

    // 4) 적절한 단어 경계가 없을 경우 maxChars 위치에서 강제 분할
    if (splitIdx === -1) {
      splitIdx = maxChars;
    }

    const chunk = remaining.slice(0, splitIdx).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks.filter(Boolean);
}

/**
 * 분할된 자막 텍스트 청크들에 순차 시간표시(타임스탬프)를 부여하여 CaptionFlowItem 배열을 생성합니다.
 * 각 청크는 최소 1~2초 간격의 서로 다른 타임스탬프를 부여받아 "다음 시간표시"에 순차적으로 표시됩니다.
 */
export function createCaptionFlowItems(
  text: string,
  baseDate: Date = new Date(),
  maxChars: number = DEFAULT_MAX_CHARS_PER_SUBTITLE
): CaptionFlowItem[] {
  const chunks = splitTranscriptIntoTwoLineChunks(text, maxChars);
  return chunks.map((chunk, idx) => {
    // 2초 단위 순차 타임스탬프 부여
    const itemDate = new Date(baseDate.getTime() + idx * 2000);
    const timestamp = itemDate.toLocaleTimeString('ko-KR');
    return {
      id: `flow-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
      text: chunk,
      timestamp
    };
  });
}

/**
 * 실시간 음성인식 스트리밍(interim/final) 처리기
 * - 발화가 2줄(약 40자)을 넘어가면 이미 완성된 앞부분을 타임스탬프와 함께 확정 flow 아이템으로 방출
 * - 현재 계속 말하고 있는 나머지 뒷부분만 `displayInterimText`(최대 2줄)로 유지
 * - 발화 종료(isFinal) 시 남은 부분을 2줄 이하 단위로 모두 분할하여 순차 타임스탬프 부여
 */
export class InterimStreamChunker {
  private committedPrefix = '';
  private maxChars: number;

  constructor(maxChars: number = DEFAULT_MAX_CHARS_PER_SUBTITLE) {
    this.maxChars = maxChars;
  }

  public reset(): void {
    this.committedPrefix = '';
  }

  /**
   * 실시간 중간 전사(isFinal: false)가 들어올 때 호출.
   * 2줄(maxChars)을 초과한 확정 앞부분은 CaptionFlowItem 목록으로 방출하고,
   * 현재 말하고 있는 나머지 꼬리 부분만 displayInterimText(최대 2줄)로 반환합니다.
   */
  public processInterim(text: string, now: Date = new Date()): {
    newFlowItems: CaptionFlowItem[];
    displayInterimText: string;
  } {
    const trimmed = text.trim();
    if (!trimmed) {
      return { newFlowItems: [], displayInterimText: '' };
    }

    let uncommitted = '';
    if (this.committedPrefix && trimmed.startsWith(this.committedPrefix)) {
      uncommitted = trimmed.slice(this.committedPrefix.length).trimStart();
    } else if (this.committedPrefix) {
      // 발화 도중 앞 단어가 살짝 수정되어 접두사가 완벽히 일치하지 않는 경우
      const words = this.committedPrefix.trim().split(/\s+/);
      const lastWords = words.slice(-2).join(' ');
      const matchIdx = lastWords ? trimmed.indexOf(lastWords) : -1;
      if (matchIdx >= 0) {
        uncommitted = trimmed.slice(matchIdx + lastWords.length).trimStart();
      } else {
        uncommitted = trimmed.slice(Math.min(this.committedPrefix.length, trimmed.length)).trimStart();
      }
    } else {
      uncommitted = trimmed;
    }

    // 미확정 텍스트가 2줄 분량을 초과하면 앞부분을 잘라 flow 아이템으로 방출
    if (uncommitted.length > this.maxChars) {
      const chunks = splitTranscriptIntoTwoLineChunks(uncommitted, this.maxChars);
      if (chunks.length > 1) {
        const completedChunks = chunks.slice(0, -1);
        const tailInterim = chunks[chunks.length - 1];

        // 방출된 청크만큼 committedPrefix 갱신
        const lastEmittedChunk = completedChunks[completedChunks.length - 1];
        const emittedIdx = trimmed.indexOf(lastEmittedChunk);
        if (emittedIdx >= 0) {
          this.committedPrefix = trimmed.slice(0, emittedIdx + lastEmittedChunk.length);
        } else {
          this.committedPrefix = trimmed.slice(0, trimmed.length - tailInterim.length);
        }

        const newFlowItems: CaptionFlowItem[] = completedChunks.map((chunk, idx) => {
          const itemTime = new Date(now.getTime() + idx * 2000).toLocaleTimeString('ko-KR');
          return {
            id: `flow-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
            text: chunk,
            timestamp: itemTime
          };
        });

        return {
          newFlowItems,
          displayInterimText: tailInterim
        };
      }
    }

    return {
      newFlowItems: [],
      displayInterimText: uncommitted
    };
  }

  /**
   * 최종 전사(isFinal: true)가 들어왔을 때 호출.
   * 이미 방출된 prefix를 제외한 남은 텍스트를 2줄 이하 단위로 모두 분할하여 순차 시간표시와 함께 방출합니다.
   */
  public finalize(fullText: string, now: Date = new Date()): CaptionFlowItem[] {
    const trimmed = fullText.trim();
    if (!trimmed) {
      this.reset();
      return [];
    }

    let uncommitted = '';
    if (this.committedPrefix && trimmed.startsWith(this.committedPrefix)) {
      uncommitted = trimmed.slice(this.committedPrefix.length).trimStart();
    } else if (this.committedPrefix) {
      const words = this.committedPrefix.trim().split(/\s+/);
      const lastWords = words.slice(-2).join(' ');
      const matchIdx = lastWords ? trimmed.indexOf(lastWords) : -1;
      if (matchIdx >= 0) {
        uncommitted = trimmed.slice(matchIdx + lastWords.length).trimStart();
      } else {
        uncommitted = trimmed.slice(Math.min(this.committedPrefix.length, trimmed.length)).trimStart();
      }
    } else {
      uncommitted = trimmed;
    }

    this.reset();

    if (!uncommitted) return [];

    return createCaptionFlowItems(uncommitted, now, this.maxChars);
  }
}
