import type { CommentRecord } from '../types/comment';
import type { WorkflowTranscript } from '../types/salesWorkflow';

export interface SellerLogicEvidence {
  comments: CommentRecord[];
  transcripts: WorkflowTranscript[];
}

export function koreanCalendarDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Parse transport syntax only. Purchase, price and allocation semantics belong to AI. */
export function parseSellerLogicText(text: string, broadcastDate: string, sessionId: string): SellerLogicEvidence {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(broadcastDate)) throw new Error('방송 시작 날짜를 선택해 주세요.');
  const midnight = Date.parse(`${broadcastDate}T00:00:00+09:00`);
  if (!Number.isFinite(midnight) || koreanCalendarDate(new Date(midnight)) !== broadcastDate) {
    throw new Error('올바른 방송 시작 날짜를 선택해 주세요.');
  }
  type Row = { section: 'comment' | 'speech'; line: number; seconds: number; text: string };
  const rows: Row[] = [];
  let section: Row['section'] | null = null;
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (line === '[고객 댓글]') { section = 'comment'; continue; }
    if (line === '[판매자 멘트]') { section = 'speech'; continue; }
    if (!section || !line) continue;
    const match = line.match(/^(?:(오전|오후)\s+)?(\d{1,2}):(\d{2}):(\d{2})\s*[·•]\s*(.+)$/u);
    if (!match) throw new Error(`${index + 1}행의 시각 형식을 확인해 주세요. 예: 오후 11:58:22 · 루비: 저요`);
    const [, ampm, h, m, s, value] = match;
    let hour = Number(h);
    if (Number(m) > 59 || Number(s) > 59 || (ampm ? hour < 1 || hour > 12 : hour > 23)) {
      throw new Error(`${index + 1}행에 올바르지 않은 시각이 있습니다.`);
    }
    if (ampm) hour = hour % 12 + (ampm === '오후' ? 12 : 0);
    rows.push({ section, line: index + 1, seconds: hour * 3600 + Number(m) * 60 + Number(s), text: value });
  }
  if (!rows.length) throw new Error('[고객 댓글]과 [판매자 멘트] 아래에 시각이 있는 대화를 붙여넣어 주세요.');
  const first = (kind: Row['section']) => rows.find((r) => r.section === kind)?.seconds;
  const starts = [first('comment'), first('speech')].filter((n): n is number => n !== undefined);
  const crossesMidnight = Math.max(...starts) - Math.min(...starts) > 12 * 3600;
  const evidence: SellerLogicEvidence = { comments: [], transcripts: [] };
  for (const kind of ['comment', 'speech'] as const) {
    let previous = first(kind) ?? 0;
    let day = crossesMidnight && previous < 12 * 3600 ? 1 : 0;
    for (const row of rows.filter((r) => r.section === kind)) {
      if (previous - row.seconds > 12 * 3600) day++;
      previous = row.seconds;
      const at = new Date(midnight + (day * 86400 + row.seconds) * 1000).toISOString();
      const id = `${sessionId}:${kind}:${row.line}`;
      if (kind === 'speech') {
        evidence.transcripts.push({ id, text: row.text, recognizedAt: at, isFinal: true });
      } else {
        const separator = row.text.indexOf(':');
        const nickname = row.text.slice(0, separator).trim();
        const content = row.text.slice(separator + 1).trim();
        if (separator < 1 || !nickname || !content) throw new Error(`${row.line}행의 닉네임과 댓글 내용을 확인해 주세요.`);
        evidence.comments.push({ id, sessionId, nickname, content, capturedAt: at });
      }
    }
  }
  return evidence;
}

export const SELLER_LOGIC_EXAMPLE = `[고객 댓글]
오후 11:59:59 · xou.3z: 저여 맨투맨
오전 12:02:14 · 제갈: 나나
오전 12:02:19 · 제갈: 나줘
오전 12:06:58 · 루비: 찡박힌티 싸게 ㅈㅇ
오전 12:07:17 · 루비: 네
오전 12:07:44 · 루비: 1.8
오전 12:08:16 · 루비: 네
오전 12:11:05 · blue: 1 베이지

[판매자 멘트]
오후 11:59:57 · 그다음 언니 이거 내수 제품 맨투맨이고요. 가격 18,000원.
오전 12:00:18 · 맨투맨 드릴게요. 엑소 언니.
오전 12:02:20 · 언니 아까 기본티 찾으시는 언니 이거 11,000원.
오전 12:02:23 · 아이보리 컬러.
오전 12:02:26 · 나나. 제갈 언니 드릴게요.
오전 12:02:28 · 이거 만 원에 가져가.
오전 12:07:16 · 루비 언니 이거 말씀하시는 거야?
오전 12:07:27 · 2.0. 24,000원짜리 2.0에 드렸어. 콜?
오전 12:07:58 · 1.8? 아니 아까 전에 20,000원에 가져가는 언니 있어가지고 안 돼요 언니.
오전 12:08:11 · 20,000원. 루비 학생 20,000원에 가져갑시다.
오전 12:08:24 · 네, 감사합니다 언니.
오전 12:11:00 · 이 제품 숫자 1번입니다. 가격은 0.9. 베이지, 검정 두 가지 있어요. 구매하실 분은 1번과 색상 남겨 주세요.
오전 12:11:12 · 블루 언니 1번 베이지 드릴게요. 9,000원.`;
