import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { useAuth } from '../../context/AuthContext';
import { CustomerPurchaseClaim, SmsAttachment, SmsMessage } from '../../types/commerce';
import { SaleRecord } from '../../types/live';
import { cleanMessageBody } from '../../utils/textCleaner';
import { resolvePrivateImageUrl } from '../../services/remoteWorkspaceService';
import { ImageViewerModal } from '../../components/common/ImageViewerModal';
import { requireSupabase, isSupabaseConfigured } from '../../services/supabaseClient';
import {
  MessageSquare,
  ShoppingBag,
  Search,
  RefreshCw,
  Send,
  Sparkles,
  UserCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  Filter,
  Smartphone,
  ChevronRight,
  User,
  Inbox,
  AlertCircle,
  ZoomIn,
  Image as ImageIcon,
  X
} from 'lucide-react';

const formatPhone = (raw: string): string => {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('82')) {
    const local = '0' + digits.slice(2);
    return formatPhone(local);
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
};

const normalizePhone = (raw: string): string => {
  if (!raw) return '';
  let compact = raw.replace(/[^0-9+]/g, '');
  if (compact.startsWith('+82')) compact = '0' + compact.slice(3);
  if (compact.startsWith('82') && compact.length >= 11) compact = '0' + compact.slice(2);
  return compact.replace(/\D/g, '');
};

// 날짜 + 시각 포맷 (예: "2026.10.10 오후 10:14")
const formatDateTime = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const time = d.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${year}.${month}.${day} ${time}`;
};

// 날짜 + 시각 + 초 포맷 (예: "2026.10.10 오후 10:14:24")
const formatDateTimeWithSeconds = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const time = d.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${year}.${month}.${day} ${time}`;
};

// 일자 구분선 포맷 (예: "2026년 10월 10일 토요일")
const formatDateDivider = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
};

const MANUAL_NICKNAME_KEY = 'voicecap_manual_phone_nicknames';

const loadManualNicknames = (workspaceId?: string | null): Map<string, string> => {
  try {
    const key = workspaceId ? `${MANUAL_NICKNAME_KEY}_${workspaceId}` : MANUAL_NICKNAME_KEY;
    const raw = localStorage.getItem(key);
    if (raw) {
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    }
  } catch {}
  return new Map();
};

const saveManualNicknames = (map: Map<string, string>, workspaceId?: string | null) => {
  try {
    const key = workspaceId ? `${MANUAL_NICKNAME_KEY}_${workspaceId}` : MANUAL_NICKNAME_KEY;
    const obj = Object.fromEntries(map.entries());
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {}
};

interface ThreadInfo {
  phoneKey: string;
  displayPhone: string;
  messages: SmsMessage[];
  lastMessage: SmsMessage;
  existingNickname: string | null; // 과거 거래 내역이 있는 번호의 닉네임
  newMatchedNickname: string | null; // 현재 문자 중 닉네임이 포함되어 새로 매칭된 닉네임
  isNew: boolean; // "신규" 아이콘/배지 대상 여부
}

const AttachmentItem: React.FC<{
  attachment: SmsAttachment;
  onOpenViewer: (url: string) => void;
}> = ({ attachment, onOpenViewer }) => {
  const [resolvedUrl, setResolvedUrl] = useState<string>(
    attachment.dataUrl || (attachment.path?.startsWith('http') ? attachment.path : '')
  );
  const [loading, setLoading] = useState<boolean>(!resolvedUrl && Boolean(attachment.path));
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (resolvedUrl) return;
    if (!attachment.path) return;
    let active = true;
    setLoading(true);
    resolvePrivateImageUrl(attachment.path)
      .then((url) => {
        if (active) {
          if (url) {
            setResolvedUrl(url);
          } else {
            setError(true);
          }
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attachment.path, resolvedUrl]);

  if (loading) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-100 animate-pulse text-slate-400 text-xs">
        <span className="text-[11px]">사진 불러오는 중...</span>
      </div>
    );
  }

  if (error || !resolvedUrl) {
    return (
      <div className="flex h-28 w-full flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-500 text-xs p-2 text-center">
        <AlertCircle className="w-5 h-5 mb-1 text-rose-400" />
        <span className="text-[10px] truncate max-w-full font-medium">{attachment.fileName || '사진'}</span>
        <span className="text-[9px] text-rose-400">불러올 수 없음</span>
      </div>
    );
  }

  return (
    <div
      onClick={() => onOpenViewer(resolvedUrl)}
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-black/5 hover:border-brand-500 hover:shadow-md transition-all"
      title="클릭하여 원본 크기로 보기"
    >
      <img
        src={resolvedUrl}
        alt={attachment.fileName || '첨부 사진'}
        className="h-28 w-full object-cover transition-transform duration-200 group-hover:scale-105"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-slate-950/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <span className="bg-slate-900/80 text-white text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 shadow-md">
          <ZoomIn className="w-3.5 h-3.5" /> 크게 보기
        </span>
      </div>
    </div>
  );
};

export const CustomerMessagesComparisonPage: React.FC = () => {
  const { workspaceId, isRemoteAuth } = useAuth();
  const { sales } = useSales();
  const {
    messages,
    claims,
    invoices,
    shipments,
    syncBridge,
    bridgeStatus,
    bridgeMessage,
    sendSms,
    updateClaim,
  } = useCommerce();

  // 수동 닉네임 연결 상태 (localStorage 및 실시간 상태 동기화)
  const [manualNicknames, setManualNicknames] = useState<Map<string, string>>(() =>
    loadManualNicknames(workspaceId)
  );
  const [nicknameInput, setNicknameInput] = useState('');

  useEffect(() => {
    setManualNicknames(loadManualNicknames(workspaceId));
  }, [workspaceId]);

  // 검색 및 필터 상태
  const [salesSearch, setSalesSearch] = useState('');
  const [messagesSearch, setMessagesSearch] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('ALL');
  const [selectedPhoneKey, setSelectedPhoneKey] = useState<string | null>(null);

  // 이미지 크게보기 뷰어 상태
  const [viewingImages, setViewingImages] = useState<{ urls: string[]; index: number } | null>(null);

  // 답장 입력 상태
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. 고유 세션(방송회차) 목록
  const sessionIds = useMemo(() => {
    const set = new Set<string>();
    sales.forEach((s) => {
      if (s.sessionId) set.add(s.sessionId);
    });
    return Array.from(set);
  }, [sales]);

  // 2. 웹앱 전체 구매자 닉네임 목록 (신규 매칭 및 연결에 사용)
  const allBuyerNicknames = useMemo(() => {
    const list = sales.map((s) => s.buyerNickname?.trim()).filter(Boolean) as string[];
    // 긴 닉네임부터 우선 매칭되도록 정렬
    return Array.from(new Set(list)).sort((a, b) => b.length - a.length);
  }, [sales]);

  // 3. 과거 거래 내역 및 수동 연결된 전화번호 -> 닉네임 맵 생성
  const pastTransactionPhoneMap = useMemo(() => {
    const map = new Map<string, string>();

    // purchase_claims 에서 수집
    claims.forEach((c) => {
      const norm = normalizePhone(c.phoneNumber);
      if (norm && c.nickname?.trim()) {
        map.set(norm, c.nickname.trim());
      }
    });

    // invoices 에서 수집
    invoices.forEach((inv) => {
      const norm = normalizePhone(inv.phoneNumber);
      if (norm && inv.customerNickname?.trim()) {
        map.set(norm, inv.customerNickname.trim());
      }
    });

    // shipments 에서 수집
    shipments.forEach((s) => {
      const norm = normalizePhone(s.phoneNumber);
      if (norm && s.recipientName?.trim()) {
        map.set(norm, s.recipientName.trim());
      }
    });

    // 수동으로 연결한 닉네임 매핑 수집 (최우선 반영)
    manualNicknames.forEach((nick, norm) => {
      if (norm && nick) {
        map.set(norm, nick);
      }
    });

    return map;
  }, [claims, invoices, shipments, manualNicknames]);

  // 4. 문자 메시지들을 전화번호별 스레드(Thread)로 그룹핑 & 요구사항 로직 적용
  const threads = useMemo<ThreadInfo[]>(() => {
    const groupMap = new Map<string, SmsMessage[]>();

    messages.forEach((msg) => {
      const norm = normalizePhone(msg.phoneNumber);
      if (!norm) return;
      const list = groupMap.get(norm) || [];
      list.push(msg);
      groupMap.set(norm, list);
    });

    const threadList: ThreadInfo[] = [];

    groupMap.forEach((msgList, norm) => {
      // 시간순 정렬 (오래된 순 -> 최신 순)
      msgList.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const lastMsg = msgList[msgList.length - 1];

      // A. 과거 거래 내역이 있는 번호인지 확인
      const existingNick = pastTransactionPhoneMap.get(norm) || null;

      // B. 현재 문자들 중에 웹앱 구매자 닉네임이 포함되어 있는지 검사
      let matchedNick: string | null = null;
      for (const m of msgList) {
        if (m.direction === 'INCOMING' && m.body) {
          for (const nick of allBuyerNicknames) {
            if (nick.length >= 2 && m.body.includes(nick)) {
              matchedNick = nick;
              break;
            }
          }
        }
        if (matchedNick) break;
      }

      // C. 신규 판정:
      // 과거 거래 내역이 없거나, 이번 문자에 웹앱 구매자 닉네임이 명시되어 새로 식별된 경우 "신규" 아이콘 부여
      const isNew = Boolean(matchedNick && !existingNick);

      threadList.push({
        phoneKey: norm,
        displayPhone: formatPhone(norm),
        messages: msgList,
        lastMessage: lastMsg,
        existingNickname: existingNick,
        newMatchedNickname: matchedNick,
        isNew,
      });
    });

    // 최신 메시지 수신순으로 정렬
    return threadList.sort(
      (a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
    );
  }, [messages, pastTransactionPhoneMap, allBuyerNicknames]);

  // 4-1. 구매자 닉네임 -> 일치하는 문자 스레드 매핑
  const buyerToThreadMap = useMemo(() => {
    const map = new Map<string, ThreadInfo>();
    threads.forEach((t) => {
      if (t.existingNickname) {
        map.set(t.existingNickname.trim().toLowerCase(), t);
      }
      if (t.newMatchedNickname) {
        map.set(t.newMatchedNickname.trim().toLowerCase(), t);
      }
      allBuyerNicknames.forEach((nick) => {
        if (t.messages.some((m) => m.body && m.body.toLowerCase().includes(nick.toLowerCase()))) {
          if (!map.has(nick.toLowerCase())) {
            map.set(nick.toLowerCase(), t);
          }
        }
      });
    });
    return map;
  }, [threads, allBuyerNicknames]);

  // 판매 목록 문자 수신 필터 ('ALL' | 'RECEIVED' | 'UNRECEIVED')
  const [salesMessageFilter, setSalesMessageFilter] = useState<'ALL' | 'RECEIVED' | 'UNRECEIVED'>('ALL');

  // 5. 검색 및 필터링된 스레드 목록
  const filteredThreads = useMemo(() => {
    if (!messagesSearch.trim()) return threads;
    const q = messagesSearch.trim().toLowerCase();
    return threads.filter((t) => {
      const matchPhone = t.phoneKey.includes(q) || t.displayPhone.includes(q);
      const matchExisting = t.existingNickname?.toLowerCase().includes(q);
      const matchNew = t.newMatchedNickname?.toLowerCase().includes(q);
      const matchBody = t.messages.some((m) => m.body.toLowerCase().includes(q));
      return matchPhone || matchExisting || matchNew || matchBody;
    });
  }, [threads, messagesSearch]);

  // 6. 필터링된 판매 목록 (좌측)
  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      if (selectedSessionId !== 'ALL' && sale.sessionId !== selectedSessionId) return false;
      if (salesSearch.trim()) {
        const q = salesSearch.trim().toLowerCase();
        const matchBuyer = sale.buyerNickname?.toLowerCase().includes(q);
        const matchProduct = sale.productName?.toLowerCase().includes(q);
        if (!matchBuyer && !matchProduct) return false;
      }
      const buyerNick = sale.buyerNickname?.trim().toLowerCase();
      const hasMessage = buyerNick ? buyerToThreadMap.has(buyerNick) : false;
      if (salesMessageFilter === 'RECEIVED' && !hasMessage) return false;
      if (salesMessageFilter === 'UNRECEIVED' && hasMessage) return false;
      return true;
    });
  }, [sales, selectedSessionId, salesSearch, salesMessageFilter, buyerToThreadMap]);

  // 문자 수신 여부 건수 집계
  const { receivedSalesCount, unreceivedSalesCount } = useMemo(() => {
    let received = 0;
    let unreceived = 0;
    sales.forEach((s) => {
      if (selectedSessionId !== 'ALL' && s.sessionId !== selectedSessionId) return;
      const nick = s.buyerNickname?.trim().toLowerCase();
      if (nick && buyerToThreadMap.has(nick)) {
        received++;
      } else {
        unreceived++;
      }
    });
    return { receivedSalesCount: received, unreceivedSalesCount: unreceived };
  }, [sales, selectedSessionId, buyerToThreadMap]);

  // 7. 선택된 스레드
  const activeThread = useMemo(() => {
    if (selectedPhoneKey) {
      const match = filteredThreads.find((t) => t.phoneKey === selectedPhoneKey);
      if (match) return match;
      const globalMatch = threads.find((t) => t.phoneKey === selectedPhoneKey);
      if (globalMatch) return globalMatch;
    }
    return filteredThreads.length > 0 ? filteredThreads[0] : null;
  }, [filteredThreads, threads, selectedPhoneKey]);

  // 메시지 스크롤 맨 아래로 이동
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages]);

  // 새로고침 함수
  const handleRefresh = async () => {
    setIsRefreshing(true);
    setFeedback(null);
    try {
      await syncBridge();
      setFeedback('문자 내역을 최신 상태로 동기화했습니다.');
    } catch {
      setFeedback('동기화 중 오류가 발생했습니다.');
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  // 답장 전송 함수
  const handleSendReply = async () => {
    if (!activeThread || !replyText.trim()) return;
    setIsSending(true);
    setFeedback(null);
    try {
      await sendSms(activeThread.phoneKey, replyText.trim(), 'GENERAL', []);
      setReplyText('');
      setFeedback('문자 발송을 요청했습니다.');
    } catch (e: any) {
      setFeedback(`발송 실패: ${e?.message || '네트워크 상태를 확인해 주세요.'}`);
    } finally {
      setIsSending(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  // 좌측 판매건 클릭 시 해당 구매자 닉네임으로 우측 문자함 검색창 입력 및 스레드 선택
  const handleSelectBuyerFromSales = (buyerNickname?: string) => {
    if (!buyerNickname) return;
    const nick = buyerNickname.trim();
    if (!nick) return;

    // 1) 첫 번째 목록이든 다른 목록이든 항상 검색창에 닉네임을 설정하여 필터링
    setMessagesSearch(nick);

    // 2) 닉네임과 일치하는 스레드가 있으면 해당 대화방을 바로 활성화
    const found = threads.find(
      (t) =>
        t.existingNickname?.toLowerCase() === nick.toLowerCase() ||
        t.newMatchedNickname?.toLowerCase() === nick.toLowerCase() ||
        t.messages.some((m) => m.body.toLowerCase().includes(nick.toLowerCase()))
    );
    if (found) {
      setSelectedPhoneKey(found.phoneKey);
    }
  };

  // 고객 닉네임 수동 연결 함수
  const handleLinkNickname = async (phoneKey: string, rawNickname: string) => {
    const nick = rawNickname.trim();
    if (!nick) return;

    // 1. 상태 및 로컬 스토리지 업데이트
    const nextMap = new Map(manualNicknames);
    nextMap.set(phoneKey, nick);
    setManualNicknames(nextMap);
    saveManualNicknames(nextMap, workspaceId);
    setNicknameInput('');

    // 2. 해당 구매자 닉네임을 가진 판매 건 조회
    const matchingSales = sales.filter(
      (s) => s.buyerNickname?.trim().toLowerCase() === nick.toLowerCase()
    );
    const matchingSaleIds = matchingSales.map((s) => s.id);

    // 3. activeThread 기준 claim 등록/업데이트
    const thread = threads.find((t) => t.phoneKey === phoneKey);
    const claimId = crypto.randomUUID();
    const newClaim: CustomerPurchaseClaim = {
      id: claimId,
      messageId: thread?.lastMessage?.id || '',
      phoneNumber: thread?.displayPhone || formatPhone(phoneKey),
      nickname: nick,
      address: '',
      productName: matchingSales[0]?.productName || '',
      amount: matchingSales.reduce((sum, s) => sum + (s.amount || 0), 0) || null,
      captureImageUrls: [],
      saleIds: matchingSaleIds,
      matchStatus: 'MATCHED',
      fieldMatches: { nickname: true, amount: null, capture: null },
      sellerNote: '고객 문자함에서 닉네임 수동 연결',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    updateClaim(newClaim);

    // 4. Supabase 연동 시 purchase_claims 테이블에 저장
    if (isRemoteAuth && workspaceId && isSupabaseConfigured) {
      try {
        const client = requireSupabase();
        await client.from('purchase_claims').upsert({
          id: claimId,
          workspace_id: workspaceId,
          message_id: thread?.lastMessage?.id || null,
          phone_number: thread?.displayPhone || formatPhone(phoneKey),
          nickname: nick,
          address: '',
          product_name: matchingSales[0]?.productName || '',
          amount: matchingSales.reduce((sum, s) => sum + (s.amount || 0), 0) || null,
          sale_ids: matchingSaleIds,
          match_status: 'MATCHED',
          field_matches: { nickname: true, amount: null, capture: null },
          seller_note: '고객 문자함에서 닉네임 수동 연결',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('Supabase claim upsert 오류:', err);
      }
    }

    setFeedback(`'${nick}' 닉네임이 ${formatPhone(phoneKey)} 번호와 연결되었습니다.`);
    setTimeout(() => setFeedback(null), 3000);
  };

  // 고객 닉네임 수동 연결 해제 함수
  const handleUnlinkNickname = async (phoneKey: string) => {
    const nextMap = new Map(manualNicknames);
    const prevNick = nextMap.get(phoneKey);
    nextMap.delete(phoneKey);
    setManualNicknames(nextMap);
    saveManualNicknames(nextMap, workspaceId);

    setFeedback(`'${prevNick || ''}' 번호(${formatPhone(phoneKey)}) 연결이 해제되었습니다.`);
    setTimeout(() => setFeedback(null), 3000);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4.25rem)] overflow-hidden bg-slate-100">
      {/* 최상단 제어 바 */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-brand-50 p-2 text-brand-600">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900 flex items-center gap-2">
              고객 문자함 비교
              <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                실시간 대조 모드
              </span>
            </h1>
            <p className="text-xs text-slate-500">
              라이브 판매 목록(좌측)과 스마트폰 수신 고객문자(우측)를 나란히 비교합니다.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 동기화 상태 표시 */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                bridgeStatus === 'ONLINE' ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            />
            <span className="text-slate-600 font-medium">
              {bridgeStatus === 'ONLINE' ? '연동 정상' : bridgeMessage || '연동 확인 중'}
            </span>
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? '동기화 중...' : '입금·문자 새로고침'}
          </button>
        </div>
      </header>

      {/* 피드백 안내 배너 */}
      {feedback && (
        <div className="bg-brand-50 border-b border-brand-200 px-4 py-1.5 text-xs font-bold text-brand-800 text-center animate-fade-in">
          {feedback}
        </div>
      )}

      {/* 메인 2분할 레이아웃 (좌: 판매목록 / 우: 고객문자함) */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* ===================== [좌측: 판매 목록] ===================== */}
        <section className="w-full md:w-[42%] lg:w-[38%] xl:w-[35%] flex flex-col border-r border-slate-200 bg-white">
          <div className="p-3 border-b border-slate-100 bg-slate-50/70 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5 text-brand-600" />
                판매 내역 목록 ({filteredSales.length}건)
              </span>

              {/* 회차 필터 */}
              {sessionIds.length > 0 && (
                <div className="flex items-center gap-1">
                  <Filter className="w-3 h-3 text-slate-400" />
                  <select
                    value={selectedSessionId}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                    className="text-[11px] font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-700 outline-none"
                  >
                    <option value="ALL">전체 방송회차</option>
                    {sessionIds.map((sid) => (
                      <option key={sid} value={sid}>
                        {sid}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* 판매 검색창 */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="구매자 닉네임 또는 상품명 검색..."
                value={salesSearch}
                onChange={(e) => setSalesSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:border-brand-500 focus:outline-none"
              />
            </div>

            {/* 문자 수신 필터 탭 */}
            <div className="flex items-center gap-1 pt-1 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setSalesMessageFilter('ALL')}
                className={`px-2 py-1 rounded-lg transition-colors ${
                  salesMessageFilter === 'ALL'
                    ? 'bg-slate-800 text-white shadow-2xs'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                전체 ({receivedSalesCount + unreceivedSalesCount})
              </button>
              <button
                type="button"
                onClick={() => setSalesMessageFilter('RECEIVED')}
                className={`px-2 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                  salesMessageFilter === 'RECEIVED'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
                }`}
              >
                <MessageSquare className="w-3 h-3" />
                문자 수신 ({receivedSalesCount})
              </button>
              <button
                type="button"
                onClick={() => setSalesMessageFilter('UNRECEIVED')}
                className={`px-2 py-1 rounded-lg transition-colors ${
                  salesMessageFilter === 'UNRECEIVED'
                    ? 'bg-slate-600 text-white shadow-2xs'
                    : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                미수신 ({unreceivedSalesCount})
              </button>
            </div>
          </div>

          {/* 판매 리스트 카드 뷰 */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-slate-50/50">
            {filteredSales.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                판매 내역이 없습니다.
              </div>
            ) : (
              filteredSales.map((sale) => {
                const isSelected = Boolean(
                  messagesSearch.trim() &&
                  sale.buyerNickname?.trim().toLowerCase() === messagesSearch.trim().toLowerCase()
                );

                const matchedThread = sale.buyerNickname
                  ? buyerToThreadMap.get(sale.buyerNickname.trim().toLowerCase())
                  : undefined;

                return (
                  <div
                    key={sale.id}
                    onClick={() => handleSelectBuyerFromSales(sale.buyerNickname)}
                    className={`group p-3 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-50/60 border-cyan-500 shadow-xs ring-1 ring-cyan-200'
                        : 'bg-white border-slate-200 hover:border-brand-400 hover:shadow-xs'
                    }`}
                    title="클릭 시 우측 문자함에서 해당 고객 대화를 찾습니다"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-black text-sm text-slate-900 group-hover:text-brand-600 transition-colors">
                          {sale.buyerNickname || '구매자 닉네임 없음'}
                        </span>

                        {/* 문자 수신 여부 배지 */}
                        {matchedThread ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                            <MessageSquare className="w-2.5 h-2.5 text-emerald-600" />
                            문자 수신 ({matchedThread.messages.length}건)
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200">
                            문자 미수신
                          </span>
                        )}

                        {sale.status && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                              sale.status === '확정'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {sale.status}
                          </span>
                        )}
                      </div>

                      <span className="text-xs font-black text-brand-700 whitespace-nowrap">
                        {(sale.amount || 0).toLocaleString()}원
                      </span>
                    </div>

                    <div className="mt-1.5 text-xs text-slate-600 flex items-center justify-between">
                      <span className="font-medium truncate max-w-[180px]">
                        {sale.productName || '상품명 미지정'}
                        {sale.quantity && sale.quantity > 1 ? ` (${sale.quantity}개)` : ''}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {sale.recognizedAt
                          ? new Date(sale.recognizedAt).toLocaleTimeString('ko-KR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>

                    {/* 수신된 문자가 있는 경우: 전화번호 및 최근 문자 미리보기 박스 */}
                    {matchedThread && (
                      <div className="mt-2 p-2 rounded-xl bg-emerald-50/60 border border-emerald-100 text-[11px] space-y-1">
                        <div className="flex items-center justify-between text-slate-700 font-semibold">
                          <div className="flex items-center gap-1.5">
                            <Smartphone className="w-3 h-3 text-emerald-600" />
                            <span className="text-slate-900 font-bold">{matchedThread.displayPhone}</span>
                            {matchedThread.isNew && (
                              <span className="bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.2 rounded-md shadow-2xs">
                                신규
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {formatDateTime(matchedThread.lastMessage.createdAt)}
                          </span>
                        </div>
                        <p className="text-slate-600 truncate text-[11px] leading-tight">
                          {cleanMessageBody(matchedThread.lastMessage.body) || '(내용 없음 또는 첨부파일)'}
                        </p>
                      </div>
                    )}

                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 group-hover:text-brand-600 font-semibold">
                      <span>{sale.sessionId ? `회차: ${sale.sessionId}` : '일반 판매'}</span>
                      {matchedThread ? (
                        <span className="text-emerald-700 font-bold flex items-center gap-0.5">
                          문자 대화 확인 ({matchedThread.messages.length}건) <ChevronRight className="w-3 h-3" />
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5">
                          문자 대조하기 <ChevronRight className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ===================== [우측: 고객 문자함 (인박스)] ===================== */}
        <section className="flex-1 flex flex-col md:flex-row min-h-0 bg-slate-50">
          {/* [우측-1: 전화번호별 대화목록 스레드] */}
          <div className="w-full md:w-72 lg:w-80 flex flex-col border-r border-slate-200 bg-white">
            <div className="p-3 border-b border-slate-100 bg-slate-50/70 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <Inbox className="w-3.5 h-3.5 text-cyan-600" />
                  고객 문자 인박스 ({filteredThreads.length})
                </span>
                <span className="text-[10px] text-slate-400">전체 수발신</span>
              </div>

              {/* 문자 검색창 */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="전화번호, 닉네임, 문자 내용..."
                  value={messagesSearch}
                  onChange={(e) => setMessagesSearch(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:border-cyan-500 focus:outline-none"
                />
                {messagesSearch && (
                  <button
                    onClick={() => setMessagesSearch('')}
                    className="absolute right-2 top-2 p-0.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                    title="검색어 지우기"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* 스레드 리스트 */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {filteredThreads.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs px-4">
                  {messages.length === 0
                    ? '수신된 문자가 아직 없습니다. voicecapSMS 앱 연동을 확인해 주세요.'
                    : '검색 조건에 맞는 문자가 없습니다.'}
                </div>
              ) : (
                filteredThreads.map((thread) => {
                  const isSelected = activeThread?.phoneKey === thread.phoneKey;

                  return (
                    <div
                      key={thread.phoneKey}
                      onClick={() => setSelectedPhoneKey(thread.phoneKey)}
                      className={`p-3 cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-cyan-50/70 border-l-4 border-l-cyan-600'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        {/* 전화번호 & 닉네임 표시부 */}
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span className="font-bold text-xs text-slate-900">
                            {thread.displayPhone}
                          </span>

                          {/* 1. 과거 거래 내역이 있는 번호: 닉네임 표시 */}
                          {thread.existingNickname && (
                            <span className="font-black text-xs text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded border border-brand-200">
                              ({thread.existingNickname})
                            </span>
                          )}

                          {/* 2. 현재 문자 중에 웹앱 구매자 닉네임이 있는 번호: 닉네임 + "신규" 배지 */}
                          {thread.newMatchedNickname && (
                            <span className="inline-flex items-center gap-0.5 font-black text-xs text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              ({thread.newMatchedNickname})
                              {thread.isNew && (
                                <span className="inline-flex items-center text-[10px] font-black text-white bg-emerald-600 px-1 py-0.2 rounded-full ml-0.5 animate-pulse">
                                  신규
                                </span>
                              )}
                            </span>
                          )}
                        </div>

                        {/* 날짜 및 시각 */}
                        <span className="text-[10px] text-slate-400 whitespace-nowrap font-medium">
                          {formatDateTime(thread.lastMessage.createdAt)}
                        </span>
                      </div>

                      {/* 최근 메시지 미리보기 */}
                      {(() => {
                        const cleaned = cleanMessageBody(thread.lastMessage.body);
                        const attCount = thread.lastMessage.attachments?.length || 0;
                        const preview = cleaned || (attCount > 0 ? (attCount > 1 ? `[사진 ${attCount}장]` : '[사진]') : '(내용 없음)');
                        return (
                          <p className="text-xs text-slate-600 line-clamp-1 break-all">
                            {thread.lastMessage.direction === 'OUTGOING' && (
                              <span className="text-slate-400 font-semibold mr-1">[발신]</span>
                            )}
                            {preview}
                          </p>
                        );
                      })()}

                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                        <span>총 {thread.messages.length}건</span>
                        {thread.existingNickname ? (
                          <span className="text-brand-600 font-bold flex items-center gap-0.5">
                            <UserCheck className="w-2.5 h-2.5" /> 기존 거래 고객
                          </span>
                        ) : thread.isNew ? (
                          <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" /> 신규 닉네임 감지
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* [우측-2: 선택된 대화 상세 및 답장 창] */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            {activeThread ? (
              <>
                {/* 대화방 상단 헤더 */}
                <div className="p-3 border-b border-slate-200 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-cyan-100 text-cyan-800 flex items-center justify-center font-bold text-xs">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-sm text-slate-900">
                          {activeThread.displayPhone}
                        </span>

                        {/* 연결된 닉네임이 이미 있는 경우: 닉네임 배지만 표시 (입력창 제외) */}
                        {(() => {
                          const connectedNickname =
                            activeThread.existingNickname ||
                            activeThread.newMatchedNickname ||
                            manualNicknames.get(activeThread.phoneKey) ||
                            null;
                          const isManuallyLinked = manualNicknames.has(activeThread.phoneKey);

                          if (connectedNickname) {
                            return (
                              <div className="flex items-center gap-1">
                                <span className="text-xs font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-200 flex items-center gap-1 shadow-2xs">
                                  <UserCheck className="w-3 h-3 text-brand-600" />
                                  {connectedNickname}
                                  {activeThread.isNew && (
                                    <span className="bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full">
                                      신규
                                    </span>
                                  )}
                                </span>
                                {isManuallyLinked && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnlinkNickname(activeThread.phoneKey)}
                                    className="text-slate-400 hover:text-red-500 transition-colors p-0.5"
                                    title="닉네임 연결 해제"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            );
                          }

                          /* 연결된 닉네임이 없는 경우: 닉네임 직접 입력 및 연결 UI */
                          return (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (nicknameInput.trim()) {
                                  handleLinkNickname(activeThread.phoneKey, nicknameInput.trim());
                                }
                              }}
                              className="flex items-center gap-1.5"
                            >
                              <div className="relative">
                                <input
                                  type="text"
                                  list="buyer-nicknames-datalist"
                                  placeholder="고객 닉네임 입력/선택"
                                  value={nicknameInput}
                                  onChange={(e) => setNicknameInput(e.target.value)}
                                  className="text-xs px-2.5 py-1 bg-amber-50/70 border border-amber-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500 w-36"
                                />
                                <datalist id="buyer-nicknames-datalist">
                                  {allBuyerNicknames.map((nick) => (
                                    <option key={nick} value={nick} />
                                  ))}
                                </datalist>
                              </div>
                              <button
                                type="submit"
                                disabled={!nicknameInput.trim()}
                                className="px-2.5 py-1 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors disabled:opacity-40 shadow-2xs whitespace-nowrap"
                              >
                                닉네임 연결
                              </button>
                            </form>
                          );
                        })()}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        총 {activeThread.messages.length}건의 대화 내역
                      </p>
                    </div>
                  </div>
                </div>

                {/* 말풍선 목록 영역 */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/70">
                  {activeThread.messages.map((msg, index) => {
                    const isOutgoing = msg.direction === 'OUTGOING';
                    const prevMsg = index > 0 ? activeThread.messages[index - 1] : null;
                    const isNewDay =
                      !prevMsg ||
                      new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

                    return (
                      <React.Fragment key={msg.id}>
                        {isNewDay && (
                          <div className="flex items-center justify-center my-2">
                            <div className="bg-slate-200/90 text-slate-600 text-[11px] font-bold px-3 py-0.5 rounded-full shadow-2xs">
                              {formatDateDivider(msg.createdAt)}
                            </div>
                          </div>
                        )}

                        <div
                          className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs shadow-xs ${
                              isOutgoing
                                ? 'bg-brand-600 text-white rounded-br-none'
                                : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'
                            }`}
                          >
                            <div
                              className={`mb-1 flex items-center gap-1.5 text-[10px] ${
                                isOutgoing ? 'text-brand-100' : 'text-slate-400'
                              }`}
                            >
                              <span className="font-semibold">{isOutgoing ? '발신 (판매자)' : '수신 (고객)'}</span>
                              <span>·</span>
                              <span>{formatDateTimeWithSeconds(msg.createdAt)}</span>
                            </div>

                            {(() => {
                              const cleaned = cleanMessageBody(msg.body);
                              return cleaned ? (
                                <p className="whitespace-pre-wrap break-words leading-relaxed text-sm">
                                  {cleaned}
                                </p>
                              ) : null;
                            })()}

                            {/* 첨부 이미지 목록 */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className={`grid gap-1.5 ${msg.attachments.length === 1 ? 'grid-cols-1 max-w-[240px]' : 'grid-cols-2'} ${cleanMessageBody(msg.body) ? 'mt-2' : ''}`}>
                                {msg.attachments.map((att) => (
                                  <AttachmentItem
                                    key={att.id}
                                    attachment={att}
                                    onOpenViewer={(clickedUrl) => {
                                      const allUrls = (msg.attachments || [])
                                        .map((a) => a.dataUrl || (a.path?.startsWith('http') ? a.path : ''))
                                        .filter(Boolean);
                                      if (!allUrls.includes(clickedUrl)) {
                                        allUrls.push(clickedUrl);
                                      }
                                      const idx = Math.max(0, allUrls.indexOf(clickedUrl));
                                      setViewingImages({ urls: allUrls, index: idx });
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* 하단 답장 입력창 */}
                <div className="p-3 border-t border-slate-200 bg-white">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder={`${activeThread.displayPhone} 번호로 답장 문자 입력...`}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendReply();
                        }
                      }}
                      className="flex-1 px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-brand-500 focus:bg-white focus:outline-none"
                    />
                    <button
                      onClick={handleSendReply}
                      disabled={isSending || !replyText.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {isSending ? '전송 중' : '발송'}
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    * 전송 시 연결된 스마트폰(voicecapSMS 앱)을 통해 실제 SMS로 발송됩니다.
                  </p>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <MessageSquare className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-sm font-bold text-slate-700">대화방을 선택하세요</p>
                <p className="text-xs text-slate-400 mt-1">
                  왼쪽 목록에서 고객 전화번호를 선택하거나, 판매 목록에서 대조할 고객을 클릭하세요.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {viewingImages && (
        <ImageViewerModal
          isOpen={Boolean(viewingImages)}
          onClose={() => setViewingImages(null)}
          images={viewingImages.urls}
          initialIndex={viewingImages.index}
          titlePrefix={activeThread?.displayPhone || '문자 첨부 사진'}
        />
      )}
    </div>
  );
};
export default CustomerMessagesComparisonPage;
