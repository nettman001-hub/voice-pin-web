import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeBuyerPhoneLinks,
  buyerPhoneLinkService,
  type BuyerPhoneLinkMap,
} from '../services/buyerPhoneLinkService';
import { compactText, type SmsNicknameMatch } from '../services/smsNicknameLink';

export interface AutoLinkCandidate {
  phoneKey: string;
  /** 이미 다른 기록(주문서·정산서·배송·수동 연결·저장된 연결)으로 알려진 닉네임 */
  knownNickname: string | null;
  match: SmsNicknameMatch | null;
}

/** 저장해도 될 만큼 확실한 연결인지: 3글자 이상 닉네임이 띄어쓰기까지만 다르게 들어 있거나, 짧은 닉네임이 자기소개 맥락으로 쓰임 */
const isSaveableMatch = (match: SmsNicknameMatch | null): match is SmsNicknameMatch =>
  Boolean(match && (match.kind === 'EXACT' || match.kind === 'SPACING' || match.kind === 'INTRO'));

/**
 * 문자로 확인된 전화번호 ↔ 구매자 닉네임 연결을 불러오고,
 * 새로 확인된 연결은 다음 회차에도 쓰도록 저장한다.
 */
export function useBuyerPhoneLinks(workspaceId?: string | null) {
  const [links, setLinks] = useState<BuyerPhoneLinkMap>(() => buyerPhoneLinkService.load(workspaceId));
  const pendingRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    setLinks(buyerPhoneLinkService.load(workspaceId));
    buyerPhoneLinkService.sync(workspaceId).then((merged) => {
      if (active) setLinks(merged);
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const phoneToNickname = useMemo(() => activeBuyerPhoneLinks(links), [links]);

  /** 화면에서 찾은 확실한 연결 중 아직 저장되지 않은 것만 저장한다 */
  const rememberLinks = useCallback((candidates: AutoLinkCandidate[], sessionId?: string | null) => {
    const entries: BuyerPhoneLinkMap = {};
    const now = new Date().toISOString();
    candidates.forEach(({ phoneKey, knownNickname, match }) => {
      if (!phoneKey || knownNickname || !isSaveableMatch(match)) return;
      const existing = links[phoneKey];
      if (existing && (existing.blocked || compactText(existing.nickname) === compactText(match.nickname))) return;
      const pendingKey = `${phoneKey}:${match.nickname}`;
      if (pendingRef.current.has(pendingKey)) return;
      pendingRef.current.add(pendingKey);
      entries[phoneKey] = { nickname: match.nickname, sessionId: sessionId || null, linkedAt: now };
    });
    if (Object.keys(entries).length === 0) return;
    buyerPhoneLinkService.upsert(entries, workspaceId).then(setLinks);
  }, [links, workspaceId]);

  /** 판매자가 번호를 직접 연결/해제했을 때 저장된 자동 연결도 맞춘다 */
  const setLink = useCallback((phoneKey: string, nickname: string | null, sessionId?: string | null) => {
    const existing = links[phoneKey];
    const entry = nickname
      ? { nickname, sessionId: sessionId || null, linkedAt: new Date().toISOString() }
      : existing
        ? { ...existing, blocked: true, linkedAt: new Date().toISOString() }
        : null;
    if (!entry) return;
    buyerPhoneLinkService.upsert({ [phoneKey]: entry }, workspaceId).then(setLinks);
  }, [links, workspaceId]);

  return { links, phoneToNickname, rememberLinks, setLink };
}
