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

// 시스템 메시지(팔로우/참여/입장)와 상단 공지는 댓글에서 제외한다.
const SYSTEM_KEYWORDS = ['팔로우했습니다', '팔로우 했습니다', '참여함', '입장했습니다', '호스트를'];
const NOTICE_KEYWORDS = [
  '라이브에 오신',
  '환영합니다',
  '가이드라인',
  '크리에이터',
  '커뮤니티',
  '실시간으로 소통',
  '18세',
  '19세',
  '선물을 보내려면',
  '진행하려면'
];

/**
 * 닉네임 줄에 섞인 배지 토큰을 제거한다.
 * 예: "12 댓글자 동수맘 3위" -> "동수맘"
 */
const cleanBadgeTokens = (line: string): string =>
  normalize(
    line
      .replace(/^\s*\d{1,3}\s+/, '')   // 레벨 배지 숫자 (△12 등)
      .replace(/댓글자/g, '')           // 댓글자 배지
      .replace(/\s*\d{1,2}위\s*$/g, '') // 하트 랭킹 (❤3위)
      .replace(/[△▲]/g, '')
  );

const isSkippableLine = (line: string): boolean =>
  SYSTEM_KEYWORDS.some((k) => line.includes(k)) || NOTICE_KEYWORDS.some((k) => line.includes(k));

/**
 * 틱톡 라이브 댓글의 닉네임 줄은 공백 없는 짧은 문자열이다.
 * 내용("9900", "1" 등 숫자만)과 구분하기 위해 문자 포함 + 숫자 전용 제외 조건을 둔다.
 */
const looksLikeNickname = (line: string): boolean => {
  if (line.length < 1 || line.length > 20) return false;
  if (/\s/.test(line)) return false;              // 닉네임 줄은 공백이 없다
  if (!/[가-힣a-zA-Z]/.test(line)) return false;  // 숫자/기호만 있는 줄 제외
  if (isSkippableLine(line)) return false;
  return true;
};

/**
 * OCR 원문을 댓글 목록(닉네임 + 내용)으로 파싱한다.
 *
 * 틱톡 라이브 채팅은 2줄 구조다:
 *   [배지줄] 12 댓글자 동수맘 3위   <- 닉네임 (배지 토큰 포함)
 *   [내용줄] 9900                  <- 내용
 * 시스템 메시지("호스트를 팔로우했습니다", "참여함")와 상단 공지는 제외한다.
 */
export const parseCommentsFromOcr = (rawText: string): Array<{ nickname: string; content: string }> => {
  const results: Array<{ nickname: string; content: string }> = [];

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => cleanBadgeTokens(line))
    .filter((line) => line.length >= 1);

  let pendingNickname: string | null = null;

  for (const line of lines) {
    if (isSkippableLine(line)) continue;

    // 직전 줄이 닉네임이었다면 이 줄은 무조건 내용이다.
    if (pendingNickname !== null) {
      results.push({ nickname: pendingNickname, content: line });
      pendingNickname = null;
      continue;
    }

    // 닉네임과 내용이 한 줄로 붙어 나온 경우 ("동수맘 9900")
    const inline = line.match(/^([^\s]{2,15})\s+([가-힣a-zA-Z].{1,})$/);
    if (inline && looksLikeNickname(inline[1])) {
      results.push({ nickname: inline[1], content: normalize(inline[2]) });
      continue;
    }

    if (looksLikeNickname(line)) {
      pendingNickname = line;
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
