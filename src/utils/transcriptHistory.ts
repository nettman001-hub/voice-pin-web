import { SellerTranscriptRecord, SttTranscriptLog } from '../types/live';

function recordedAt(record: SttTranscriptLog): string | null {
  for (const value of [record.recognizedAt, record.timestamp]) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value))) {
      return new Date(value).toISOString();
    }
  }
  // Older logs have only a localized clock (e.g. "오후 11:02:10"). Their
  // generated IDs preserve the actual creation date, including midnight.
  const legacyTime = typeof record.id === 'string' ? record.id.match(/^log-(\d{13})-/u) : null;
  return legacyTime ? new Date(Number(legacyTime[1])).toISOString() : null;
}

export function mergeTranscriptHistory(...sources: SellerTranscriptRecord[][]): SellerTranscriptRecord[] {
  const records = new Map<string, SellerTranscriptRecord>();
  for (const source of sources) {
    for (const record of source) {
      if (!record || !record.sessionId || record.isFinal !== true || typeof record.text !== 'string'
        || !record.text.trim()) continue;
      const timestamp = recordedAt(record);
      if (!timestamp) continue;
      const identity = record.id || `${record.timestamp}:${record.text}`;
      records.set(JSON.stringify([record.sessionId, identity]), { ...record, timestamp });
    }
  }
  return [...records.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export function filterTranscriptHistory(records: SellerTranscriptRecord[], filters: {
  sessionId: string;
  fromDate: string;
  toDate: string;
  searchText: string;
}): SellerTranscriptRecord[] {
  const from = filters.fromDate ? new Date(`${filters.fromDate}T00:00:00`).getTime() : null;
  const to = filters.toDate ? new Date(`${filters.toDate}T23:59:59.999`).getTime() : null;
  const query = filters.searchText.trim().toLowerCase();
  return records.filter((record) => {
    const timestamp = Date.parse(record.timestamp);
    return (filters.sessionId === 'ALL' || record.sessionId === filters.sessionId)
      && (from === null || timestamp >= from)
      && (to === null || timestamp <= to)
      && (!query || record.text.toLowerCase().includes(query));
  });
}

export function transcriptActionLabel(action: SttTranscriptLog['actionTriggered']): string {
  const labels: Partial<Record<NonNullable<SttTranscriptLog['actionTriggered']>, string>> = {
    SALE_SAVED: '판매 저장', SCREEN_CAPTURED: '화면 캡처',
    VOICE_EDIT_START: '수정 시작', VOICE_EDIT_DONE: '수정 완료',
    CORRECTION_APPLIED: '정정 적용', CORRECTION_IGNORED: '정정 무시',
    CORRECTION_CANCELLED: '판매 취소', CORRECTION_RESTORED: '판매 복원',
    CORRECTION_CONFLICT: '정정 충돌', CORRECTION_INCOMPLETE: '정정 미완료',
    CORRECTION_PENDING: '정정 보류', CORRECTION_UNMATCHED: '정정 대상 없음',
  };
  return action ? labels[action] || '' : '';
}

const csvCell = (value: string) => {
  // Spoken text is untrusted input, including spreadsheet formula prefixes.
  const safeValue = /^[\s]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
};

export function buildTranscriptCsv(records: SellerTranscriptRecord[], sessionLabel: (sessionId: string) => string): string {
  const headers = ['인식 시각', '방송 회차', '판매자 멘트', '정확도', '감지 단어', '실행 결과'];
  const rows = records.map((record) => [
    record.timestamp, sessionLabel(record.sessionId), record.text,
    Number.isFinite(record.confidence) ? `${(record.confidence * 100).toFixed(1)}%` : '',
    (record.matchedKeywords || []).join('; '), transcriptActionLabel(record.actionTriggered),
  ].map(csvCell).join(','));
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}

export function buildTranscriptTxt(records: SellerTranscriptRecord[], sessionLabel: (sessionId: string) => string): string {
  return records.map((record) => {
    const action = transcriptActionLabel(record.actionTriggered);
    return `[${record.timestamp}] [${sessionLabel(record.sessionId)}] 판매자: ${record.text}${action ? ` [${action}]` : ''}`;
  }).join('\r\n');
}
