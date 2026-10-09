/**
 * 문자 메시지 본문 및 MMS 제목 인코딩 복구 / 불필요한 제목 제거 유틸리티
 */

const cp1252Map: Record<string, number> = {
  '\u20AC': 0x80, '\u201A': 0x82, '\u0192': 0x83, '\u201E': 0x84, '\u2026': 0x85,
  '\u2020': 0x86, '\u2021': 0x87, '\u02C6': 0x88, '\u2030': 0x89, '\u0160': 0x8A,
  '\u2039': 0x8B, '\u0152': 0x8C, '\u017D': 0x8E, '\u2018': 0x91, '\u2019': 0x92,
  '\u201C': 0x93, '\u201D': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
  '\u02DC': 0x98, '\u2122': 0x99, '\u0161': 0x9A, '\u203A': 0x9B, '\u0153': 0x9C,
  '\u017E': 0x9E, '\u0178': 0x9F
};

/**
 * 안드로이드 MMS 제목이 ISO-8859-1 / Windows-1252로 잘못 해석되어 저장된 깨진 문자열 복구
 */
export function decodeMojibakeText(str?: string | null): string {
  if (!str) return '';
  
  // 1. 한국 MMS 기본 제목인 '제목없음' 깨짐 패턴 직접 정규화
  let s = str.replace(/ì[\s\u00a0\u009d\u0020]?œëª©ì—†ì[\s\u00a0\u009d\u0020]?Œ/g, '제목없음');
  s = s.replace(/ì[\s\u00a0\u009d\u0020]?œëª©/g, '제목');

  // 2. UTF-8이 ISO-8859-1 / CP1252로 깨진 일반적인 한글 바이트 복구 시도 (ì, ë 등이 다수 포함된 경우)
  if (/[ìë]/.test(s)) {
    try {
      const bytes: number[] = [];
      let canDecode = true;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        const code = ch.charCodeAt(0);
        if (cp1252Map[ch] !== undefined) {
          bytes.push(cp1252Map[ch]);
        } else if (code <= 0xFF) {
          bytes.push(code);
        } else {
          canDecode = false;
          break;
        }
      }
      if (canDecode && bytes.length > 0) {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const decoded = decoder.decode(new Uint8Array(bytes));
        if (/[\uac00-\ud7a3]/.test(decoded) && !decoded.includes('\ufffd')) {
          s = decoded;
        }
      }
    } catch {
      // 복구 실패 시 기존 문자열 유지
    }
  }

  return s;
}

/**
 * 메시지 본문에서 깨진 글자 복구 및 안드로이드 MMS 자동 생성 제목("제목없음", "no subject") 제거
 */
export function cleanMessageBody(body?: string | null): string {
  if (!body) return '';
  let text = decodeMojibakeText(body.trim());

  // 앞부분의 제목없음 또는 no subject 제거
  text = text.replace(/^[<(\[]?\s*제목없음\s*[>)\]]?[\r\n\s]*/g, '');
  text = text.replace(/^[<(\[]?\s*no\s*subject\s*[>)\]]?[\r\n\s]*/gi, '');

  return text.trim();
}
