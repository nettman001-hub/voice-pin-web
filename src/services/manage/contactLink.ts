import { normalizeNickname } from '../nicknameMatcher.ts';
import {
  findNicknameInMessages, needsNicknameConfirmation, type SmsNicknameMatchKind,
} from '../smsNicknameLink.ts';

/**
 * 관리 1단계 "연락처 연결" 계산 (순수 함수).
 *
 * 판매자는 구매자에게 먼저 연락할 수 없다. 구매자가 문자·카톡으로 틱톡 닉네임과 연락처를 보내야
 * 청구할 수 있으므로, 회차×구매자마다 이 단계가 청구보다 먼저 온다.
 *
 * 규칙
 * - 예전 연결: 판매자가 확인한 번호↔구매자 연결(buyer_contacts, 구매자 키 기준)이 있으면 그대로 쓴다.
 * - 새 문자: smsNicknameLink 규칙을 그대로 쓴다. EXACT/SPACING/INTRO 는 연결, SHORT/SIMILAR 는 "확인 필요".
 * - 판매자가 해제한(blocked) 번호는 같은 닉네임에 다시 붙이지 않는다.
 * - 한 번호는 한 구매자에게만. 이미 다른 구매자에 연결된 번호는 새로 제안하지 않는다.
 * - 같은 구매자에 확실한 번호가 둘 이상이면 자동 연결하지 않고 "확인 필요".
 * - 비슷한 닉네임으로 구매자를 합치지 않는다 (구매자 키는 buyer:<id> 또는 nickname:<정규화>).
 */

export interface ContactLinkRecord {
  phone: string;
  /** buyer:<id> 또는 nickname:<정규화> (buyer_contacts.buyer_key) */
  buyerKey: string;
  nickname: string;
  linkedAt: string;
  blocked?: boolean;
}

export interface ContactMessage {
  phone: string;
  direction: string;
  body?: string | null;
  receivedAt?: string;
  channel?: 'SMS' | 'KAKAO';
}

export interface ContactBuyer {
  buyerKey: string;
  nickname: string;
}

export type ContactState = 'LINKED' | 'NEEDS_CONFIRM' | 'NONE';

export interface ContactCandidate {
  phone: string;
  matchKind: SmsNicknameMatchKind;
}

export interface ContactResolution {
  buyerKey: string;
  nickname: string;
  state: ContactState;
  phone?: string;
  source?: 'PREVIOUS' | 'MESSAGE';
  matchKind?: SmsNicknameMatchKind;
  /** 판매자에게 보여 줄 한 줄 이유 */
  reason: string;
  /** 확인 필요일 때 고를 번호들 */
  candidates: ContactCandidate[];
  /** 새 문자로 확실히 연결됐으니 서버에 연결을 저장해도 되는지 */
  shouldSave: boolean;
}

export interface ContactBook {
  byBuyer: Map<string, ContactResolution>;
  /** 받은 문자는 있지만 어느 구매자인지 모르는 번호 (문자·입금 화면에서 직접 지정) */
  unassignedPhones: string[];
  /** 연락처가 없어 방송에서 불러 줄 명단 */
  callList: ContactBuyer[];
}

/** 전화번호를 숫자만 남기고 +82 는 0 으로 */
export function normalizePhone(value?: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('82') && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

const blockKey = (phone: string, nickname: string) => `${phone}|${normalizeNickname(nickname)}`;

export function buildContactBook(
  buyers: readonly ContactBuyer[],
  links: readonly ContactLinkRecord[],
  messages: readonly ContactMessage[],
): ContactBook {
  const uniqueBuyers = new Map<string, ContactBuyer>();
  for (const buyer of buyers) if (buyer.buyerKey && !uniqueBuyers.has(buyer.buyerKey)) uniqueBuyers.set(buyer.buyerKey, buyer);

  const blocked = new Set<string>();
  const activeLinks: ContactLinkRecord[] = [];
  for (const link of links) {
    const phone = normalizePhone(link.phone);
    if (!phone || !link.nickname) continue;
    if (link.blocked) blocked.add(blockKey(phone, link.nickname));
    else activeLinks.push({ ...link, phone });
  }
  // 같은 번호의 기록이 여러 개면 가장 최근 것만
  const latestByPhone = new Map<string, ContactLinkRecord>();
  for (const link of activeLinks) {
    const previous = latestByPhone.get(link.phone);
    if (!previous || Date.parse(link.linkedAt) > Date.parse(previous.linkedAt)) latestByPhone.set(link.phone, link);
  }
  for (const [phone, link] of latestByPhone) {
    if (blocked.has(blockKey(phone, link.nickname))) latestByPhone.delete(phone);
  }

  const byBuyer = new Map<string, ContactResolution>();
  const linkedPhones = new Set(latestByPhone.keys());

  // 1) 예전 연결 (구매자 키가 같을 때만)
  const previousByBuyer = new Map<string, ContactLinkRecord>();
  for (const link of latestByPhone.values()) {
    const owner = link.buyerKey;
    if (!owner || !uniqueBuyers.has(owner)) continue;
    const previous = previousByBuyer.get(owner);
    if (!previous || Date.parse(link.linkedAt) > Date.parse(previous.linkedAt)) previousByBuyer.set(owner, link);
  }
  for (const [buyerKey, link] of previousByBuyer) {
    const buyer = uniqueBuyers.get(buyerKey)!;
    byBuyer.set(buyerKey, {
      buyerKey, nickname: buyer.nickname, state: 'LINKED', phone: link.phone, source: 'PREVIOUS',
      reason: '예전에 연결한 번호', candidates: [], shouldSave: false,
    });
  }

  // 2) 아직 연결되지 않은 번호의 받은 문자
  const waiting = [...uniqueBuyers.values()].filter((buyer) => !byBuyer.has(buyer.buyerKey));
  const messagesByPhone = new Map<string, ContactMessage[]>();
  for (const message of messages) {
    const phone = normalizePhone(message.phone);
    if (!phone || message.direction !== 'INCOMING') continue;
    messagesByPhone.set(phone, [...(messagesByPhone.get(phone) || []), message]);
  }

  const candidatesByBuyer = new Map<string, ContactCandidate[]>();
  const ambiguousNicknameBuyers = new Set<string>();
  const unassignedPhones: string[] = [];
  const waitingNicknames = waiting.map((buyer) => buyer.nickname);
  for (const [phone, phoneMessages] of messagesByPhone) {
    if (linkedPhones.has(phone)) continue;
    const allowed = waitingNicknames.filter((nickname) => !blocked.has(blockKey(phone, nickname)));
    const match = allowed.length ? findNicknameInMessages(phoneMessages, allowed) : null;
    if (!match) { unassignedPhones.push(phone); continue; }
    const owners = waiting.filter((buyer) => normalizeNickname(buyer.nickname) === normalizeNickname(match.nickname));
    for (const owner of owners) {
      if (owners.length > 1) ambiguousNicknameBuyers.add(owner.buyerKey);
      candidatesByBuyer.set(owner.buyerKey, [...(candidatesByBuyer.get(owner.buyerKey) || []), { phone, matchKind: match.kind }]);
    }
  }

  for (const buyer of waiting) {
    const candidates = candidatesByBuyer.get(buyer.buyerKey) || [];
    const confirmed = candidates.filter((candidate) => !needsNicknameConfirmation({ nickname: buyer.nickname, kind: candidate.matchKind }));
    if (!candidates.length) {
      byBuyer.set(buyer.buyerKey, {
        buyerKey: buyer.buyerKey, nickname: buyer.nickname, state: 'NONE',
        reason: '닉네임과 연락처를 보낸 문자가 아직 없음', candidates: [], shouldSave: false,
      });
    } else if (confirmed.length === 1 && candidates.length === 1 && !ambiguousNicknameBuyers.has(buyer.buyerKey)) {
      byBuyer.set(buyer.buyerKey, {
        buyerKey: buyer.buyerKey, nickname: buyer.nickname, state: 'LINKED', phone: confirmed[0].phone,
        source: 'MESSAGE', matchKind: confirmed[0].matchKind, reason: '문자에 닉네임이 있음', candidates, shouldSave: true,
      });
    } else {
      const reason = ambiguousNicknameBuyers.has(buyer.buyerKey) ? '같은 닉네임 구매자가 여럿'
        : candidates.length > 1 ? '이 닉네임을 보낸 번호가 여럿'
          : candidates[0].matchKind === 'SHORT' ? '짧은 닉네임이라 확인 필요' : '비슷한 닉네임이라 확인 필요';
      byBuyer.set(buyer.buyerKey, {
        buyerKey: buyer.buyerKey, nickname: buyer.nickname, state: 'NEEDS_CONFIRM', reason, candidates, shouldSave: false,
      });
    }
  }

  const callList = [...uniqueBuyers.values()].filter((buyer) => byBuyer.get(buyer.buyerKey)?.state === 'NONE');
  return { byBuyer, unassignedPhones, callList };
}
