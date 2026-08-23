import { SaleRecord } from '../types/live';

export function exportSalesToCsv(records: SaleRecord[], filename: string = '판매내역_정산목록.csv'): boolean {
  if (!records || records.length === 0) {
    return false;
  }

  // 1. CSV 헤더 (요구사항: 구매자 닉네임, 금액, 인식 시각, 원본 문장, 상태)
  const headers = ['구매자 닉네임', '금액(원)', '인식 시각', '원본 전사 문장', '상태', '방송 회차'];

  // 2. CSV 행 데이터 구성 (이스케이프 처리)
  const rows = records.map((r) => {
    const nickname = `"${(r.buyerNickname || '').replace(/"/g, '""')}"`;
    const amount = r.amount || 0;
    const time = `"${(r.recognizedAt ? new Date(r.recognizedAt).toLocaleString('ko-KR') : '').replace(/"/g, '""')}"`;
    const transcript = `"${(r.rawTranscript || '').replace(/"/g, '""')}"`;
    const status = `"${(r.status || '').replace(/"/g, '""')}"`;
    const session = `"${(r.sessionId || '').replace(/"/g, '""')}"`;

    return [nickname, amount, time, transcript, status, session].join(',');
  });

  // 3. UTF-8 with BOM (\uFEFF) 추가하여 엑셀에서 한글 깨짐 방지
  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');

  // 4. Blob 생성 및 브라우저 다운로드 트리거
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return true;
}
