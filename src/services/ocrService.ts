import { createWorker, PSM, type Worker } from 'tesseract.js';
import { CommentRecord } from '../types/comment';

/**
 * 브라우저에서 완전히 로컬(WASM)로 도는 오프라인 OCR 엔진.
 * 한글 인식이 가능한 Tesseract.js(kor)를 사용하며 언어 데이터는 최초 1회 내려받아 캐시된다.
 */
let workerPromise: Promise<Worker> | null = null;

const getWorker = async (): Promise<Worker> => {
  if (!workerPromise) {
    workerPromise = createWorker('kor', 1, {
      errorHandler: (e) => console.warn('[OCR] 워커 경고:', e)
    }).then(async (worker) => {
      // 라이브 채팅처럼 줄단위 텍스트에 최적화된 페이지 분할 모드
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT
      });
      return worker;
    }).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
};

/** OCR 워커 미리 워밍업 (첫 인식 지연 제거) */
export const warmUpOcr = async (): Promise<void> => {
  try {
    await getWorker();
  } catch (e) {
    console.warn('[OCR] 워밍업 실패:', e);
  }
};

export const terminateOcr = async (): Promise<void> => {
  if (workerPromise) {
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } catch {}
    workerPromise = null;
  }
};

/** 캔버스 이미지를 한글 OCR로 인식해 원문 텍스트를 반환한다 */
export const recognizeCanvas = async (canvas: HTMLCanvasElement): Promise<string> => {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  return data.text || '';
};

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * OCR 원문을 댓글 목록(닉네임 + 내용)으로 파싱한다.
 * 라이브 채팅 패턴: "닉네임: 내용" / "닉네임 : 내용" / "닉네임 내용"
 */
export const parseCommentsFromOcr = (rawText: string): Array<{ nickname: string; content: string }> => {
  const results: Array<{ nickname: string; content: string }> = [];

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => normalize(line))
    .filter((line) => line.length >= 2);

  for (const line of lines) {
    // 1. "닉네임: 내용" 구분자 패턴
    const colon = line.match(/^(.{1,20}?)\s*[:：]\s*(.+)$/);
    if (colon) {
      const nickname = normalize(colon[1]).replace(/[^가-힣a-zA-Z0-9_ ]/g, '').trim();
      const content = normalize(colon[2]);
      if (nickname && content) {
        results.push({ nickname, content });
        continue;
      }
    }

    // 2. 공백 분리 패턴 (첫 토큰을 닉네임으로 간주)
    const spaced = line.match(/^([^\s]{1,15})\s+(.{2,})$/);
    if (spaced) {
      const nickname = spaced[1];
      const content = normalize(spaced[2]);
      // 숫자/시각/퍼센트 등 노이즈 토큰은 닉네임에서 제외
      if (!/^[\d:.,%]+$/.test(nickname)) {
        results.push({ nickname, content });
      }
    }
  }

  return results;
};

export const commentDedupeKey = (nickname: string, content: string) =>
  `${normalize(nickname)}␟${normalize(content)}`;

export interface NewCommentResult {
  records: CommentRecord[];
  alertHits: CommentRecord[];
}

/**
 * OCR 결과를 기존 기록과 비교해 신규 댓글만 만들어낸다.
 * 같은 닉네임+내용 조합은 중복으로 제외한다.
 */
export const buildNewCommentRecords = (
  rawText: string,
  sessionId: string,
  seenKeys: Set<string>,
  alertWords: string[]
): NewCommentResult => {
  const nowIso = new Date().toISOString();
  const records: CommentRecord[] = [];
  const alertHits: CommentRecord[] = [];

  for (const item of parseCommentsFromOcr(rawText)) {
    const key = commentDedupeKey(item.nickname, item.content);
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    const matchedWord = alertWords.find((word) => word && item.content.includes(word));

    const record: CommentRecord = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      nickname: item.nickname,
      content: item.content,
      capturedAt: nowIso,
      ...(matchedWord ? { matchedAlertWord: matchedWord } : {})
    };

    records.push(record);
    if (matchedWord) alertHits.push(record);
  }

  return { records, alertHits };
};
