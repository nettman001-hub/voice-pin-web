import { normalizePhone, type ContactBook, type ContactCandidate, type ContactMessage, type ContactResolution } from './contactLink.ts';

/**
 * 연락처 연결 화면의 목록 (순수 함수).
 * - toSave: 문자에 닉네임이 확실히 있어 연결됐지만 아직 서버에 저장하지 않은 것
 * - confirm: 확인 필요 (짧은·비슷한 닉네임, 번호 여러 개, 같은 닉네임 구매자 여럿)
 * - missing: 연락처 없음 → 방송에서 불러 줄 명단
 * - unknown: 받은 문자는 있는데 누군지 모르는 번호 (기다리는 구매자에게 직접 지정)
 * - linked: 연결된 번호 (해제 가능)
 */

export interface PhoneSnippet {
  phone: string;
  lastBody: string;
  lastAt?: string;
  count: number;
}

export interface ContactWorklist {
  toSave: ContactResolution[];
  confirm: (ContactResolution & { snippets: PhoneSnippet[] })[];
  missing: ContactResolution[];
  unknown: PhoneSnippet[];
  linked: ContactResolution[];
}

export function phoneSnippets(messages: readonly ContactMessage[]): Map<string, PhoneSnippet> {
  const map = new Map<string, PhoneSnippet>();
  for (const message of messages) {
    if (message.direction !== 'INCOMING' || !message.body) continue;
    const phone = normalizePhone(message.phone);
    if (!phone) continue;
    const current = map.get(phone);
    const at = message.receivedAt || '';
    if (!current) map.set(phone, { phone, lastBody: message.body, lastAt: at || undefined, count: 1 });
    else {
      current.count += 1;
      if (at >= (current.lastAt || '')) { current.lastBody = message.body; current.lastAt = at || current.lastAt; }
    }
  }
  return map;
}

export function buildContactWorklist(book: ContactBook, messages: readonly ContactMessage[]): ContactWorklist {
  const snippets = phoneSnippets(messages);
  const all = [...book.byBuyer.values()].sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  const snippetFor = (candidate: ContactCandidate) =>
    snippets.get(candidate.phone) || { phone: candidate.phone, lastBody: '', count: 0 };
  return {
    toSave: all.filter((contact) => contact.state === 'LINKED' && contact.shouldSave),
    confirm: all.filter((contact) => contact.state === 'NEEDS_CONFIRM')
      .map((contact) => ({ ...contact, snippets: contact.candidates.map(snippetFor) })),
    missing: all.filter((contact) => contact.state === 'NONE'),
    unknown: book.unassignedPhones.map((phone) => snippets.get(phone) || { phone, lastBody: '', count: 0 })
      .sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || ''))),
    linked: all.filter((contact) => contact.state === 'LINKED' && !contact.shouldSave),
  };
}

/** 방송에서 읽어 줄 문구 */
export function callListText(missing: readonly { nickname: string }[]): string {
  if (!missing.length) return '';
  return `${missing.map((buyer) => `${buyer.nickname}님`).join(', ')} 문자로 틱톡 닉네임과 연락처 보내 주세요.`;
}

export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}
