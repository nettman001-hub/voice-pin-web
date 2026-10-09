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
 * 단일 문자열 청크가 ISO-8859-1 / CP1252로 깨진 한글 UTF-8 바이트인지 검사하고 디코딩
 */
function tryDecodeMojibakeChunk(chunk: string): string {
  if (!chunk || !/[êëìíã]/.test(chunk)) return chunk;

  try {
    const bytes: number[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      const code = ch.charCodeAt(0);
      if (cp1252Map[ch] !== undefined) {
        bytes.push(cp1252Map[ch]);
      } else if (code <= 0xFF) {
        bytes.push(code);
      } else {
        // 한글이나 다른 유니코드가 섞인 경우 이 청크는 순수 라틴1이 아님
        return chunk;
      }
    }

    if (bytes.length === 0) return chunk;

    const decoder = new TextDecoder('utf-8', { fatal: false });
    // 1차 시도: 전체 바이트 디코딩
    let decoded = decoder.decode(new Uint8Array(bytes));
    if (/[\uac00-\ud7a3]/.test(decoded) && !decoded.includes('\ufffd')) {
      return decoded;
    }

    // 2차 시도: MMS 제목 바이트 제한으로 마지막 한글(3바이트)이 잘린 경우 말단 1~3바이트 제거 후 복구
    let validBytes = bytes.slice();
    while (validBytes.length > 0 && validBytes.length >= bytes.length - 4) {
      validBytes.pop();
      decoded = decoder.decode(new Uint8Array(validBytes));
      if (/[\uac00-\ud7a3]/.test(decoded) && !decoded.includes('\ufffd')) {
        return decoded;
      }
    }
  } catch {
    // 디코딩 실패 시 기존 문자열 유지
  }

  return chunk;
}

/**
 * 안드로이드 MMS 제목이 ISO-8859-1 / Windows-1252로 잘못 해석되어 저장된 깨진 문자열 복구
 */
export function decodeMojibakeText(str?: string | null): string {
  if (!str) return '';

  let s = str;

  // 1. 한국 MMS 기본 제목인 '제목없음' 깨짐 패턴 직접 정규화
  s = s.replace(/ì[\s\u00a0\u009d\u0020]?œëª©ì—†ì[\s\u00a0\u009d\u0020]?Œ/g, '제목없음');
  s = s.replace(/ì[\s\u00a0\u009d\u0020]?œëª©/g, '제목');

  // 2. 전체가 단일 mojibake인 경우
  const decodedWhole = tryDecodeMojibakeChunk(s);
  if (decodedWhole !== s) return decodedWhole;

  // 3. 줄 단위 및 라틴1 블록 단위로 복구 (본문과 섞여 있는 경우)
  const lines = s.split('\n').map((line) => {
    const trimmed = line.trim();
    const decLine = tryDecodeMojibakeChunk(trimmed);
    if (decLine !== trimmed) return decLine;

    // 줄 내부에 라틴1 깨진 블록이 부분적으로 섞여 있는 경우
    return line.replace(/[\x00-\xFF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]+/g, (match) => {
      if (match.length >= 2 && /[êëìíã]/.test(match)) {
        return tryDecodeMojibakeChunk(match);
      }
      return match;
    });
  });

  return lines.join('\n');
}

/**
 * 메시지 본문에서 깨진 글자 복구 및 안드로이드 MMS 자동 생성 제목("제목없음", "no subject", 본문 중복 제목) 제거
 */
export function cleanMessageBody(body?: string | null): string {
  if (!body) return '';
  let text = decodeMojibakeText(body.trim());

  // 줄 분리
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rawLines.length > 1) {
    const firstLine = rawLines[0];
    const secondLine = rawLines[1];

    // 첫 줄이 '제목없음' 또는 'no subject'인 경우 제거
    if (/^[<(\[]?\s*(제목없음|no\s*subject)\s*[>)\]]?$/i.test(firstLine)) {
      rawLines.shift();
    } else {
      // MMS 발신 시 본문 앞부분이 자동으로 제목으로 복제된 경우 중복 제거
      const clean1 = firstLine.replace(/^[<(\[]|[>)\]]$/g, '').replace(/[^\w\s가-힣]/g, '').trim();
      const clean2 = secondLine.replace(/[^\w\s가-힣]/g, '').trim();
      if (clean1 && clean2 && (clean2.startsWith(clean1) || clean1 === clean2)) {
        rawLines.shift();
      }
    }
    text = rawLines.join('\n');
  } else {
    text = text.replace(/^[<(\[]?\s*제목없음\s*[>)\]]?[\r\n\s]*/g, '');
    text = text.replace(/^[<(\[]?\s*no\s*subject\s*[>)\]]?[\r\n\s]*/gi, '');
  }

  return text.trim();
}
