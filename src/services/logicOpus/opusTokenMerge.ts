/**
 * 겹침 교체 토큰 병합 (순수 함수).
 *
 * 세션마다 Soniox 토큰 시각(start_ms/end_ms)은 그 세션이 받은 첫 오디오 기준이다.
 * 세션 시작 위치(offsetMs)를 더해 청취 전체 기준 시각으로 바꾼 뒤,
 * 옛 세션(A)이 끝까지 들은 단어는 A에서, 그 뒤부터는 새 세션(B)에서 가져온다.
 */

export interface GlobalToken {
  text: string;
  startMs: number;
  endMs: number;
  session: number;
}

export interface RawSonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  is_final: boolean;
}

export const ENDPOINT_TEXTS = new Set(["<end>", "<fin>"]);

export function toGlobalTokens(tokens: RawSonioxToken[], offsetMs: number, session: number): GlobalToken[] {
  return tokens
    .filter((t) => t.is_final && !ENDPOINT_TEXTS.has(t.text))
    .map((t) => {
      const start = offsetMs + (t.start_ms ?? 0);
      return { text: t.text, startMs: start, endMs: offsetMs + (t.end_ms ?? t.start_ms ?? 0), session };
    });
}

/** 경계 오차 허용치 */
export const MERGE_TOLERANCE_MS = 40;

export interface RotationMergeResult {
  keptA: GlobalToken[];
  keptB: GlobalToken[];
  droppedA: number;
  droppedB: number;
  boundaryMs: number;
}

/**
 * @param aTokens 옛 세션의 확정 토큰(병합 시점까지 받은 모든 것)
 * @param bTokens 새 세션의 확정 토큰(대기 버퍼)
 * @param cutMs  옛 세션에 마지막으로 오디오를 보낸 위치
 * @param aEmittedEndMs 옛 세션에서 이미 발화로 내보낸 마지막 단어의 끝
 */
export function mergeRotationTokens(
  aTokens: GlobalToken[],
  bTokens: GlobalToken[],
  cutMs: number,
  aEmittedEndMs = -Infinity,
): RotationMergeResult {
  // A는 cut까지만 들었다. cut에 닿아 끝난 단어는 잘렸을 수 있으므로 B의 완전한 단어를 쓴다.
  const keptA = aTokens.filter((t) => t.endMs <= cutMs - MERGE_TOLERANCE_MS);
  // 이미 발화로 내보낸 A 단어도 경계 계산에 포함한다(겹침 구간 중복 방지).
  const lastAEnd = Math.max(aEmittedEndMs, ...keptA.map((t) => t.endMs));
  // B는 A가 마지막으로 끝낸 단어 뒤부터 쓴다. cut에 걸친 단어도 B 쪽 완전한 단어로 채워진다.
  const boundaryMs = Number.isFinite(lastAEnd) ? lastAEnd : Math.min(cutMs, ...bTokens.map((t) => t.startMs));
  const keptB = bTokens.filter((t) => t.startMs >= boundaryMs - MERGE_TOLERANCE_MS);
  return {
    keptA,
    keptB,
    droppedA: aTokens.length - keptA.length,
    droppedB: bTokens.length - keptB.length,
    boundaryMs,
  };
}

export function joinTokens(tokens: GlobalToken[]): string {
  return tokens.map((t) => t.text).join("").replace(/\s+/g, " ").trim();
}
