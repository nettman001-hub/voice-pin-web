import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { useAuth } from '../../context/AuthContext';
import { CustomerPurchaseClaim, SmsAttachment, SmsMessage, PaymentReceipt } from '../../types/commerce';
import { SaleRecord } from '../../types/live';
import { cleanMessageBody } from '../../utils/textCleaner';
import { resolvePrivateImageUrl, remoteWorkspaceService } from '../../services/remoteWorkspaceService';
import { normalizePayerName } from '../../services/paymentMatching';
import { ImageViewerModal } from '../../components/common/ImageViewerModal';
import { requireSupabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { formatSessionDisplay, SessionInfoLike } from '../../utils/sessionFormatter';
import { productSalesApi } from '../../services/productSalesApi';
import { shippingService } from '../../services/shippingService';
import { groupSalesByBuyer, BuyerSaleGroup } from '../../services/buyerSaleGrouping';
import { formatMultiSaleAmount } from '../../services/salesExtractor';
import { CustomerStatsBadge } from '../../components/sales/CustomerStatsBadge';
import { findNicknameInMessages, messageMentionsNickname, type SmsNicknameMatch } from '../../services/smsNicknameLink';
import { useBuyerPhoneLinks } from '../../hooks/useBuyerPhoneLinks';
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
  X,
  CreditCard,
  Building2,
  CheckCheck,
  Link2,
  Unlink,
  Check,
  Pencil,
  Cloud
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

const MANUAL_PAYMENT_LINKS_KEY = 'voicecap_manual_payment_buyer_links';

const loadManualPaymentLinks = (workspaceId?: string | null): Map<string, string> => {
  try {
    const key = workspaceId ? `${MANUAL_PAYMENT_LINKS_KEY}_${workspaceId}` : MANUAL_PAYMENT_LINKS_KEY;
    const raw = localStorage.getItem(key);
    if (raw) {
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    }
  } catch {}
  return new Map();
};

const saveManualPaymentLinks = (map: Map<string, string>, workspaceId?: string | null) => {
  try {
    const key = workspaceId ? `${MANUAL_PAYMENT_LINKS_KEY}_${workspaceId}` : MANUAL_PAYMENT_LINKS_KEY;
    const obj = Object.fromEntries(map.entries());
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {}
};

const getBankBadgeStyle = (bank?: string | null): string => {
  if (!bank) return 'bg-slate-100 text-slate-700 border-slate-200';
  if (bank.includes('국민') || bank.includes('KB')) return 'bg-amber-50 text-amber-800 border-amber-200';
  if (bank.includes('농협') || bank.includes('NH')) return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (bank.includes('신한')) return 'bg-blue-50 text-blue-800 border-blue-200';
  if (bank.includes('우리')) return 'bg-sky-50 text-sky-800 border-sky-200';
  if (bank.includes('카카오')) return 'bg-yellow-50 text-yellow-800 border-yellow-200';
  if (bank.includes('토스')) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (bank.includes('기업') || bank.includes('IBK')) return 'bg-indigo-50 text-indigo-800 border-indigo-200';
  return 'bg-cyan-50 text-cyan-800 border-cyan-200';
};

interface ThreadInfo {
  phoneKey: string;
  displayPhone: string;
  messages: SmsMessage[];
  lastMessage: SmsMessage;
  existingNickname: string | null; // 과거 거래 내역이 있는 번호의 닉네임
  newMatchedNickname: string | null; // 현재 문자 중 닉네임이 포함되어 새로 매칭된 닉네임
  nicknameMatch: SmsNicknameMatch | null;
  isNew: boolean; // "신규" 아이콘/배지 대상 여부
  needsNicknameCheck: boolean; // 닉네임이 비슷하기만 해서 판매자 확인이 필요한 연결
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
    payments,
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

  // 수동 입금 연결 상태 (paymentId -> buyerNickname)
  const [manualPaymentLinks, setManualPaymentLinks] = useState<Map<string, string>>(() =>
    loadManualPaymentLinks(workspaceId)
  );

  useEffect(() => {
    setManualNicknames(loadManualNicknames(workspaceId));
    const localLinks = loadManualPaymentLinks(workspaceId);
    setManualPaymentLinks(localLinks);

    // Supabase 클라우드(depositor_aliases)와 자동 동기화하여 기기간 공유 지원
    if (isRemoteAuth && workspaceId && isSupabaseConfigured) {
      let active = true;
      remoteWorkspaceService.loadDepositorAliases(workspaceId)
        .then((cloudAliases) => {
          if (!active || cloudAliases.size === 0) return;
          setManualPaymentLinks((prev) => {
            const next = new Map(prev);
            let updated = false;
            payments.forEach((p) => {
              if (p.payerName) {
                const norm = normalizePayerName(p.payerName);
                const aliasNick = cloudAliases.get(norm);
                if (aliasNick && !next.has(p.id)) {
                  next.set(p.id, aliasNick);
                  updated = true;
                }
              }
            });
            if (updated) {
              saveManualPaymentLinks(next, workspaceId);
            }
            return updated ? next : prev;
          });
        })
        .catch((err) => console.warn('[CustomerMessages] 클라우드 별칭 동기화 실패:', err));

      return () => {
        active = false;
      };
    }
  }, [workspaceId, isRemoteAuth, payments]);

  // 우측 인박스 탭 상태 ('MESSAGES': 고객 문자함, 'PAYMENTS': 실시간 은행 입금함)
  const [inboxTab, setInboxTab] = useState<'MESSAGES' | 'PAYMENTS'>('MESSAGES');

  // 검색 및 필터 상태
  const [salesSearch, setSalesSearch] = useState('');
  const [messagesSearch, setMessagesSearch] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('ALL');
  const [selectedPhoneKey, setSelectedPhoneKey] = useState<string | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [selectedBuyerKey, setSelectedBuyerKey] = useState<string | null>(null);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'ALL' | 'UNMATCHED' | 'MATCHED'>('ALL');
  const [paymentLinkInputs, setPaymentLinkInputs] = useState<Record<string, string>>({});
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editPaymentNickInput, setEditPaymentNickInput] = useState<string>('');

  // 선택된 판매 정보
  const selectedSale = useMemo(() => {
    if (!selectedSaleId) return null;
    return sales.find((s) => s.id === selectedSaleId) || null;
  }, [sales, selectedSaleId]);

  // 이미지 크게보기 뷰어 상태
  const [viewingImages, setViewingImages] = useState<{ urls: string[]; index: number } | null>(null);

  // 답장 입력 상태
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cloudSessions, setCloudSessions] = useState<SessionInfoLike[]>([]);
  const shippingConfig = useMemo(() => shippingService.getConfig(workspaceId), [workspaceId]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 클라우드 방송 회차 목록 로드
  useEffect(() => {
    productSalesApi.listSessions()
      .then((data) => setCloudSessions(data.sessions))
      .catch((err) => console.warn('[CustomerMessages] 세션 목록 로드 실패:', err));
  }, []);

  // 1. 고유 방송 회차(세션) 목록 (사람이 알아보기 쉬운 명칭으로 매핑)
  const availableSessions = useMemo(() => {
    const sessionsById = new Map<string, { id: string; displayCode: string; startedAt?: string }>();

    // 1) 클라우드 등록 세션 우선 매핑
    cloudSessions.forEach((s) => {
      sessionsById.set(s.id, {
        id: s.id,
        displayCode: s.displayCode || formatSessionDisplay(s.id, { recognizedAt: s.startedAt }),
        startedAt: s.startedAt || undefined,
      });
    });

    // 2) 판매 내역에 존재하는 세션 ID 보완
    sales.forEach((sale) => {
      if (sale.sessionId && !sessionsById.has(sale.sessionId)) {
        sessionsById.set(sale.sessionId, {
          id: sale.sessionId,
          displayCode: formatSessionDisplay(sale.sessionId, {
            sessions: cloudSessions,
            recognizedAt: sale.recognizedAt,
          }),
          startedAt: sale.recognizedAt,
        });
      }
    });

    return Array.from(sessionsById.values()).sort((left, right) => {
      const tLeft = left.startedAt ? new Date(left.startedAt).getTime() : 0;
      const tRight = right.startedAt ? new Date(right.startedAt).getTime() : 0;
      return tRight - tLeft;
    });
  }, [cloudSessions, sales]);

  // 2. 웹앱 전체 구매자 닉네임 목록 (신규 매칭 및 연결에 사용)
  const allBuyerNicknames = useMemo(() => {
    const list = sales.map((s) => s.buyerNickname?.trim()).filter(Boolean) as string[];
    // 긴 닉네임부터 우선 매칭되도록 정렬
    return Array.from(new Set(list)).sort((a, b) => b.length - a.length);
  }, [sales]);

  // 지난 회차 문자로 확인돼 저장된 전화번호 → 닉네임 연결
  const { phoneToNickname: savedPhoneLinks, rememberLinks, setLink: setSavedPhoneLink } = useBuyerPhoneLinks(workspaceId);

  // 3. 과거 거래 내역 및 수동 연결된 전화번호 -> 닉네임 맵 생성
  const pastTransactionPhoneMap = useMemo(() => {
    const map = new Map<string, string>(savedPhoneLinks);

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
  }, [claims, invoices, shipments, manualNicknames, savedPhoneLinks]);

  // 4. 문자 메시지들을 전화번호별 스레드(Thread)로 그룹핑 & 요구사항 로직 적용
  // 선택한 회차(selectedSessionId !== 'ALL')의 시작 시각(startedAt) 이전 문자는 완전히 제외
  const currentSessionStartTime = useMemo(() => {
    if (selectedSessionId === 'ALL') return null;
    const session = availableSessions.find((s) => s.id === selectedSessionId);
    if (!session?.startedAt) return null;
    const t = new Date(session.startedAt).getTime();
    return isNaN(t) ? null : t;
  }, [availableSessions, selectedSessionId]);

  const sessionFilteredMessages = useMemo(() => {
    if (!currentSessionStartTime) return messages;
    return messages.filter((msg) => {
      const timeStr = msg.receivedAt || msg.createdAt;
      const msgTime = new Date(timeStr).getTime();
      if (isNaN(msgTime)) return true;
      return msgTime >= currentSessionStartTime;
    });
  }, [messages, currentSessionStartTime]);

  const threads = useMemo<ThreadInfo[]>(() => {
    const groupMap = new Map<string, SmsMessage[]>();

    sessionFilteredMessages.forEach((msg) => {
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

      // B. 현재 문자들 중에 웹앱 구매자 닉네임이 포함되어 있는지 검사 (띄어쓰기 무시, 비슷한 닉네임은 확인필요)
      const nicknameMatch = findNicknameInMessages(msgList, allBuyerNicknames);
      const matchedNick = nicknameMatch?.nickname || null;

      // C. 신규 판정:
      // 과거 거래 내역이 없거나, 이번 문자에 웹앱 구매자 닉네임이 명시되어 새로 식별된 경우 "신규" 아이콘 부여
      // 비슷하기만 한 닉네임은 "신규" 대신 "닉네임 확인필요"로 표시
      const isNew = Boolean(matchedNick && !existingNick && nicknameMatch?.kind !== 'SIMILAR');

      threadList.push({
        phoneKey: norm,
        displayPhone: formatPhone(norm),
        messages: msgList,
        lastMessage: lastMsg,
        existingNickname: existingNick,
        newMatchedNickname: matchedNick,
        nicknameMatch,
        isNew,
        needsNicknameCheck: Boolean(nicknameMatch?.kind === 'SIMILAR' && !existingNick),
      });
    });

    // 최신 메시지 수신순으로 정렬
    return threadList.sort(
      (a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
    );
  }, [sessionFilteredMessages, pastTransactionPhoneMap, allBuyerNicknames]);

  // 이번에 문자로 확실히 확인된 번호는 다음 회차에도 자동 연결되도록 저장
  useEffect(() => {
    rememberLinks(
      threads.map((t) => ({ phoneKey: t.phoneKey, knownNickname: t.existingNickname, match: t.nicknameMatch })),
      selectedSessionId === 'ALL' ? null : selectedSessionId
    );
  }, [threads, rememberLinks, selectedSessionId]);

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
        if (t.messages.some((m) => m.direction === 'INCOMING' && messageMentionsNickname(m.body, nick))) {
          if (!map.has(nick.toLowerCase())) {
            map.set(nick.toLowerCase(), t);
          }
        }
      });
    });
    return map;
  }, [threads, allBuyerNicknames]);

  // 선택한 회차(selectedSessionId !== 'ALL')의 시작 시각(startedAt) 이전 입금 내역은 완전히 제외
  const sessionFilteredPayments = useMemo(() => {
    if (!currentSessionStartTime) return payments;
    return payments.filter((payment) => {
      const timeStr = payment.paidAt || payment.createdAt;
      const paymentTime = new Date(timeStr).getTime();
      if (isNaN(paymentTime)) return true;
      return paymentTime >= currentSessionStartTime;
    });
  }, [payments, currentSessionStartTime]);

  // 4-2. 은행 입금 내역 매핑 및 구매자별 결제 내역 분석
  const { buyerPaymentsMap, unmatchedPayments } = useMemo(() => {
    const map = new Map<string, PaymentReceipt[]>();
    const unmatched: PaymentReceipt[] = [];

    // saleId -> buyerNickname 매핑 사전 준비
    const saleIdToBuyerMap = new Map<string, string>();
    sales.forEach((s) => {
      if (s.id && s.buyerNickname?.trim()) {
        saleIdToBuyerMap.set(s.id, s.buyerNickname.trim());
      }
    });

    // invoiceId -> customerNickname 매핑 사전 준비
    const invoiceIdToBuyerMap = new Map<string, string>();
    invoices.forEach((inv) => {
      if (inv.id && inv.customerNickname?.trim()) {
        invoiceIdToBuyerMap.set(inv.id, inv.customerNickname.trim());
      }
    });

    sessionFilteredPayments.forEach((payment) => {
      // 1) 수동 연결된 닉네임 우선 확인
      const manualNick = manualPaymentLinks.get(payment.id);
      if (manualNick) {
        const key = manualNick.trim().toLowerCase();
        const list = map.get(key) || [];
        list.push(payment);
        map.set(key, list);
        return;
      }

      // 2) payment.saleIds 에 의한 매칭 확인
      let matchedBuyer: string | null = null;
      if (payment.saleIds && payment.saleIds.length > 0) {
        for (const sid of payment.saleIds) {
          const found = saleIdToBuyerMap.get(sid);
          if (found) {
            matchedBuyer = found;
            break;
          }
        }
      }

      // 3) invoiceId 에 의한 매칭 확인
      if (!matchedBuyer && payment.invoiceId) {
        matchedBuyer = invoiceIdToBuyerMap.get(payment.invoiceId) || null;
      }

      // 4) 입금자명(payerName) 과 allBuyerNicknames 매칭 확인
      if (!matchedBuyer && payment.payerName) {
        const cleanPayer = payment.payerName.replace(/[\s\-_]/g, '').toLowerCase();
        for (const nick of allBuyerNicknames) {
          const cleanNick = nick.replace(/[\s\-_]/g, '').toLowerCase();
          if (cleanNick.length >= 2 && (cleanPayer === cleanNick || cleanPayer.includes(cleanNick))) {
            matchedBuyer = nick;
            break;
          }
        }
      }

      if (matchedBuyer) {
        const key = matchedBuyer.trim().toLowerCase();
        const list = map.get(key) || [];
        list.push(payment);
        map.set(key, list);
      } else {
        unmatched.push(payment);
      }
    });

    return { buyerPaymentsMap: map, unmatchedPayments: unmatched };
  }, [sessionFilteredPayments, sales, invoices, manualPaymentLinks, allBuyerNicknames]);

  // 구매자별 입금 합계 및 상태 계산 헬퍼
  const getBuyerPaymentSummary = useMemo(() => {
    return (buyerNickname?: string | null, requiredAmount?: number) => {
      if (!buyerNickname?.trim()) {
        return {
          totalPaid: 0,
          paymentList: [] as PaymentReceipt[],
          status: 'UNPAID' as const,
          diff: 0,
        };
      }

      const key = buyerNickname.trim().toLowerCase();
      const list = buyerPaymentsMap.get(key) || [];
      const totalPaid = list.reduce((sum, p) => sum + (p.amount || 0), 0);
      const req = requiredAmount || 0;
      const diff = totalPaid - req;

      let status: 'PAID' | 'PARTIAL' | 'OVERPAID' | 'UNPAID' = 'UNPAID';
      if (totalPaid === 0) {
        status = 'UNPAID';
      } else if (req > 0) {
        if (totalPaid === req) status = 'PAID';
        else if (totalPaid > req) status = 'OVERPAID';
        else status = 'PARTIAL';
      } else {
        status = 'PAID';
      }

      return { totalPaid, paymentList: list, status, diff };
    };
  }, [buyerPaymentsMap]);

  // 특정 입금건의 매칭된 고객 닉네임 조회 헬퍼
  const getMatchedNicknameForPayment = (paymentId: string): string | null => {
    const manualNick = manualPaymentLinks.get(paymentId);
    if (manualNick) return manualNick;
    for (const [nick, pList] of buyerPaymentsMap.entries()) {
      if (pList.some((item) => item.id === paymentId)) {
        return nick;
      }
    }
    return null;
  };

  // 판매 목록 문자 수신 필터 ('ALL' | 'RECEIVED' | 'UNRECEIVED')
  const [salesMessageFilter, setSalesMessageFilter] = useState<'ALL' | 'RECEIVED' | 'UNRECEIVED'>('ALL');
  // 판매 목록 입금 상태 필터 ('ALL' | 'PAID' | 'UNPAID')
  const [salesPaymentFilter, setSalesPaymentFilter] = useState<'ALL' | 'PAID' | 'UNPAID'>('ALL');
  // 은행 입금함 검색어
  const [paymentsSearch, setPaymentsSearch] = useState('');

  // 4-3. 필터링된 은행 입금 목록
  const filteredPayments = useMemo(() => {
    return sessionFilteredPayments
      .filter((p) => {
        const matchedNick = getMatchedNicknameForPayment(p.id);
        const isMatched = Boolean(matchedNick);

        if (paymentStatusFilter === 'UNMATCHED' && isMatched) return false;
        if (paymentStatusFilter === 'MATCHED' && !isMatched) return false;

        if (paymentsSearch.trim()) {
          const q = paymentsSearch.trim().toLowerCase();
          const matchPayer = p.payerName?.toLowerCase().includes(q);
          const matchBank = p.bank?.toLowerCase().includes(q);
          const matchAmount = p.amount?.toString().includes(q);
          const matchNick = matchedNick ? matchedNick.toLowerCase().includes(q) : false;
          if (!matchPayer && !matchBank && !matchAmount && !matchNick) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.paidAt || b.createdAt).getTime() - new Date(a.paidAt || a.createdAt).getTime());
  }, [sessionFilteredPayments, manualPaymentLinks, buyerPaymentsMap, paymentStatusFilter, paymentsSearch]);

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

  // 6. 현재 세션에 해당하는 전체 판매 건을 구매자별로 그룹화
  const allSessionBuyerGroups = useMemo<BuyerSaleGroup[]>(() => {
    const sessionSales = sales.filter((sale) => {
      if (selectedSessionId !== 'ALL' && sale.sessionId !== selectedSessionId) return false;
      return true;
    });
    return groupSalesByBuyer(sessionSales);
  }, [sales, selectedSessionId]);

  // 필터링된 구매자 목록 (좌측 표시용: 하나의 구매자는 하나의 카드/리스트)
  const filteredBuyers = useMemo<BuyerSaleGroup[]>(() => {
    return allSessionBuyerGroups.filter((buyer) => {
      const buyerNick = buyer.nickname?.trim().toLowerCase();

      // 검색어 필터 (구매자 닉네임 또는 주문 상품명)
      if (salesSearch.trim()) {
        const q = salesSearch.trim().toLowerCase();
        const matchBuyer = buyer.nickname.toLowerCase().includes(q);
        const matchProduct = buyer.records.some((r) => r.productName?.toLowerCase().includes(q));
        if (!matchBuyer && !matchProduct) return false;
      }

      // 문자 수신 필터
      const hasMessage = buyerNick ? buyerToThreadMap.has(buyerNick) : false;
      if (salesMessageFilter === 'RECEIVED' && !hasMessage) return false;
      if (salesMessageFilter === 'UNRECEIVED' && hasMessage) return false;

      // 입금 상태 필터 (구매자의 총 구매금액 기준)
      if (salesPaymentFilter !== 'ALL') {
        const totalAmount = buyer.records.reduce((sum, r) => sum + (r.amount || 0), 0);
        const pSummary = getBuyerPaymentSummary(buyer.nickname, totalAmount);
        const isPaid = pSummary.status === 'PAID' || pSummary.status === 'OVERPAID';
        if (salesPaymentFilter === 'PAID' && !isPaid) return false;
        if (salesPaymentFilter === 'UNPAID' && isPaid) return false;
      }

      return true;
    });
  }, [allSessionBuyerGroups, salesSearch, salesMessageFilter, salesPaymentFilter, buyerToThreadMap, getBuyerPaymentSummary]);

  // 호환성용 alias
  const filteredSales = useMemo(() => filteredBuyers.flatMap((b) => b.records), [filteredBuyers]);
  const salesByBuyer = filteredBuyers;

  // 문자 수신 및 입금 건수 집계 (구매자 기준)
  const { receivedSalesCount, unreceivedSalesCount, paidSalesCount, unpaidSalesCount } = useMemo(() => {
    let received = 0;
    let unreceived = 0;
    let paid = 0;
    let unpaid = 0;

    allSessionBuyerGroups.forEach((buyer) => {
      const nick = buyer.nickname?.trim().toLowerCase();
      if (nick && buyerToThreadMap.has(nick)) {
        received++;
      } else {
        unreceived++;
      }

      const totalAmount = buyer.records.reduce((sum, r) => sum + (r.amount || 0), 0);
      const pSummary = getBuyerPaymentSummary(buyer.nickname, totalAmount);
      if (pSummary.status === 'PAID' || pSummary.status === 'OVERPAID') {
        paid++;
      } else {
        unpaid++;
      }
    });

    return {
      receivedSalesCount: received,
      unreceivedSalesCount: unreceived,
      paidSalesCount: paid,
      unpaidSalesCount: unpaid,
    };
  }, [allSessionBuyerGroups, buyerToThreadMap, getBuyerPaymentSummary]);

  // 7. 선택된 스레드 (명시적으로 선택된 번호가 있을 때만 반환)
  const activeThread = useMemo(() => {
    if (selectedPhoneKey) {
      const match = filteredThreads.find((t) => t.phoneKey === selectedPhoneKey);
      if (match) return match;
      // 검색어가 없을 때만 전체 스레드에서 매칭 허용 (검색어가 있을 때 엉뚱한 이전 대화가 남는 버그 방지)
      if (!messagesSearch.trim()) {
        const globalMatch = threads.find((t) => t.phoneKey === selectedPhoneKey);
        if (globalMatch) return globalMatch;
      }
    }
    // 선택된 번호가 없으면(또는 미수신 고객 클릭 시) 어떤 스레드도 자동 선택하지 않음
    return null;
  }, [filteredThreads, threads, selectedPhoneKey, messagesSearch]);

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

  // 좌측 구매자 카드 클릭 시 해당 구매자의 대화방 활성화 또는 매칭 안내
  const handleSelectBuyer = (buyer: BuyerSaleGroup) => {
    if (selectedBuyerKey === buyer.key) {
      setSelectedBuyerKey(null);
      setSelectedSaleId(null);
      setSelectedPhoneKey(null);
      setMessagesSearch('');
      return;
    }

    setSelectedBuyerKey(buyer.key);
    setSelectedSaleId(buyer.records[0]?.id || null);

    const nick = buyer.nickname?.trim();
    if (!nick) {
      setSelectedPhoneKey(null);
      return;
    }

    // 닉네임과 일치하는 스레드가 있으면 해당 대화방을 바로 활성화
    const found = threads.find(
      (t) =>
        t.existingNickname?.toLowerCase() === nick.toLowerCase() ||
        t.newMatchedNickname?.toLowerCase() === nick.toLowerCase() ||
        t.messages.some((m) => m.body && m.body.toLowerCase().includes(nick.toLowerCase()))
    );

    if (found) {
      setSelectedPhoneKey(found.phoneKey);
    } else {
      // 문자가 없는 경우 이전 선택 번호를 null로 초기화하여 우측 대화창에 판매 정보 안내 카드 표시
      setSelectedPhoneKey(null);
    }
  };

  // 기존 호환용 단건 판매 선택 핸들러
  const handleSelectBuyerFromSales = (sale: SaleRecord) => {
    setSelectedSaleId(sale.id);
    const nick = sale.buyerNickname?.trim();

    if (!nick) {
      setSelectedPhoneKey(null);
      return;
    }

    const found = threads.find(
      (t) =>
        t.existingNickname?.toLowerCase() === nick.toLowerCase() ||
        t.newMatchedNickname?.toLowerCase() === nick.toLowerCase() ||
        t.messages.some((m) => m.body && m.body.toLowerCase().includes(nick.toLowerCase()))
    );

    if (found) {
      setSelectedPhoneKey(found.phoneKey);
    } else {
      setSelectedPhoneKey(null);
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
    setSavedPhoneLink(phoneKey, nick, selectedSessionId === 'ALL' ? null : selectedSessionId);
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
    const prevNick = nextMap.get(phoneKey) || savedPhoneLinks.get(phoneKey);
    nextMap.delete(phoneKey);
    setManualNicknames(nextMap);
    saveManualNicknames(nextMap, workspaceId);
    setSavedPhoneLink(phoneKey, null);

    setFeedback(`'${prevNick || ''}' 번호(${formatPhone(phoneKey)}) 연결이 해제되었습니다.`);
    setTimeout(() => setFeedback(null), 3000);
  };

  // 입금 내역 수동 연결 함수 (paymentId -> buyerNickname, 클라우드 동기화)
  const handleLinkPaymentToBuyer = async (paymentId: string, rawNickname: string) => {
    const nick = rawNickname.trim();
    if (!nick) return;
    const nextMap = new Map(manualPaymentLinks);
    nextMap.set(paymentId, nick);
    setManualPaymentLinks(nextMap);
    saveManualPaymentLinks(nextMap, workspaceId);

    // Supabase 클라우드 depositor_aliases 에 저장하여 다른 PC/기기와 공유
    const targetPayment = payments.find((p) => p.id === paymentId);
    if (isRemoteAuth && workspaceId && targetPayment?.payerName && isSupabaseConfigured) {
      try {
        await remoteWorkspaceService.saveDepositorAlias(workspaceId, targetPayment.payerName, nick);
      } catch (err) {
        console.warn('[CustomerMessages] 클라우드 별칭 저장 실패:', err);
      }
    }

    setFeedback(`입금 내역이 '${nick}' 고객과 연결되었습니다. (클라우드 동기화 ☁️)`);
    setTimeout(() => setFeedback(null), 3000);
  };

  // 입금 내역 수동 연결 해제 함수 (클라우드 동기화)
  const handleUnlinkPayment = async (paymentId: string) => {
    const nextMap = new Map(manualPaymentLinks);
    const prevNick = nextMap.get(paymentId);
    nextMap.delete(paymentId);
    setManualPaymentLinks(nextMap);
    saveManualPaymentLinks(nextMap, workspaceId);

    // Supabase 클라우드 depositor_aliases 에서도 제거
    const targetPayment = payments.find((p) => p.id === paymentId);
    if (isRemoteAuth && workspaceId && targetPayment?.payerName && isSupabaseConfigured) {
      try {
        await remoteWorkspaceService.deleteDepositorAlias(workspaceId, targetPayment.payerName);
      } catch (err) {
        console.warn('[CustomerMessages] 클라우드 별칭 삭제 실패:', err);
      }
    }

    setFeedback(`'${prevNick || ''}' 고객과의 입금 연결이 해제되었습니다.`);
    setTimeout(() => setFeedback(null), 3000);
  };

  // 입금 내역 닉네임 수정 모드 시작
  const handleStartEditPayment = (paymentId: string, currentNick: string | null, payerName?: string) => {
    setEditingPaymentId(paymentId);
    setEditPaymentNickInput(currentNick || payerName || '');
  };

  // 입금 내역 닉네임 수정 저장
  const handleSavePaymentNick = (paymentId: string) => {
    const trimmed = editPaymentNickInput.trim();
    if (!trimmed) {
      setFeedback('고객 닉네임을 입력해 주세요.');
      setTimeout(() => setFeedback(null), 3000);
      return;
    }
    handleLinkPaymentToBuyer(paymentId, trimmed);
    setEditingPaymentId(null);
    setEditPaymentNickInput('');
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
              판매내역/문자비교
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
                판매 내역 목록 ({salesByBuyer.length}명 · {filteredSales.length}건)
              </span>

              {/* 회차 필터 */}
              {availableSessions.length > 0 && (
                <div className="flex items-center gap-1">
                  <Filter className="w-3 h-3 text-slate-400" />
                  <select
                    value={selectedSessionId}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                    className="text-[11px] font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-700 outline-none max-w-[180px] sm:max-w-[220px] truncate"
                  >
                    <option value="ALL">전체 방송회차</option>
                    {availableSessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.displayCode}
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

            {/* 문자 수신 및 입금 필터 탭 */}
            <div className="flex items-center gap-1 pt-1 text-[11px] font-bold overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setSalesMessageFilter('ALL')}
                className={`px-2 py-1 rounded-lg transition-colors whitespace-nowrap ${
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
                className={`px-2 py-1 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap ${
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
                className={`px-2 py-1 rounded-lg transition-colors whitespace-nowrap ${
                  salesMessageFilter === 'UNRECEIVED'
                    ? 'bg-slate-600 text-white shadow-2xs'
                    : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                미수신 ({unreceivedSalesCount})
              </button>

              <div className="h-3 w-px bg-slate-300 mx-0.5" />

              <button
                type="button"
                onClick={() => setSalesPaymentFilter(salesPaymentFilter === 'PAID' ? 'ALL' : 'PAID')}
                className={`px-2 py-1 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap ${
                  salesPaymentFilter === 'PAID'
                    ? 'bg-cyan-700 text-white shadow-2xs'
                    : 'bg-white text-cyan-700 hover:bg-cyan-50 border border-cyan-200'
                }`}
                title="입금 완료된 판매 건만 필터"
              >
                <CreditCard className="w-3 h-3" />
                입금완료 ({paidSalesCount})
              </button>
              <button
                type="button"
                onClick={() => setSalesPaymentFilter(salesPaymentFilter === 'UNPAID' ? 'ALL' : 'UNPAID')}
                className={`px-2 py-1 rounded-lg transition-colors whitespace-nowrap ${
                  salesPaymentFilter === 'UNPAID'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
                }`}
                title="입금 대기 판매 건만 필터"
              >
                입금대기 ({unpaidSalesCount})
              </button>
            </div>
          </div>

          {/* 판매 리스트 카드 뷰 (구매자 단위 단일 리스트) */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 bg-slate-50/50">
            {filteredBuyers.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                {allSessionBuyerGroups.length === 0
                  ? '해당 방송 회차에 등록된 판매 내역이 없습니다.'
                  : '검색 또는 필터 조건에 일치하는 구매자가 없습니다.'}
              </div>
            ) : (
              filteredBuyers.map((buyer) => {
                const isSelected = selectedBuyerKey === buyer.key;
                const totalAmount = buyer.records.reduce((sum, r) => sum + (r.amount || 0), 0);
                const multi = formatMultiSaleAmount(buyer.records.map((r) => r.amount));
                const hasPending = buyer.records.some((r) => r.status === '보류');
                const hasManualEdit = buyer.records.some((r) => r.status === '수동수정');
                const mainStatus = hasPending ? '보류' : hasManualEdit ? '수동수정' : '확정';

                const hasVoice = buyer.records.some((r) => r.source === 'WEB_VOICE');
                const hasApp = buyer.records.some((r) => r.source === 'ANDROID_COMMENTS');
                const hasManual = buyer.records.some((r) => r.source === 'MANUAL');
                const sourceLabel = hasVoice ? '음성' : hasApp ? '앱' : hasManual ? '수동' : '기타';

                const productImage = buyer.records.find((r) => r.productImageUrl || r.captureImageUrls?.[0])?.productImageUrl
                  || buyer.records.find((r) => r.captureImageUrls?.[0])?.captureImageUrls?.[0];

                return (
                  <div
                    key={buyer.key}
                    onClick={() => handleSelectBuyer(buyer)}
                    className={`group p-2.5 sm:p-3 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-50/70 border-cyan-500 shadow-sm ring-2 ring-cyan-400/40'
                        : hasPending
                        ? 'bg-amber-50/40 border-amber-300 hover:border-amber-400 hover:shadow-xs'
                        : 'bg-white border-slate-200 hover:border-brand-400 hover:shadow-xs'
                    }`}
                    title={
                      isSelected
                        ? '클릭 시 선택 해제하고 전체 문자를 표시합니다'
                        : `'${buyer.nickname}' 클릭 시 우측 문자함 및 입금 내역을 대조합니다`
                    }
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3">
                      {/* 좌측: 상품 이미지 또는 쇼핑백 아이콘 */}
                      <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center flex-shrink-0 text-sky-600 overflow-hidden shadow-2xs">
                        {productImage ? (
                          <img
                            src={productImage}
                            alt={`${buyer.nickname} 상품`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <ShoppingBag className="w-5 h-5 text-sky-600" />
                        )}
                      </div>

                      {/* 우측: 닉네임, 통계 배지, 금액, 상태 태그 */}
                      <div className="min-w-0 flex-1">
                        {multi.isMulti ? (
                          // 다건인 경우
                          <div>
                            {/* 1행: 닉네임 + 다건 뱃지 + 고객 통계 알약 */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-sm sm:text-base text-slate-900 group-hover:text-brand-600 transition-colors">
                                {buyer.nickname}
                              </span>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 whitespace-nowrap">
                                ★ 다건 {buyer.records.length}건
                              </span>
                              <CustomerStatsBadge
                                nickname={buyer.nickname}
                                buyerId={buyer.records[0]?.buyerId}
                                variant="pill"
                                currentSessionId={selectedSessionId !== 'ALL' ? selectedSessionId : undefined}
                              />
                            </div>

                            {/* 2행: 0.5 + 1.5 = 20,000원 */}
                            <div className="text-base sm:text-lg font-black text-blue-600 font-mono mt-0.5 tracking-tight">
                              {multi.displayFull}
                            </div>

                            {/* 3행: 출처/상태 태그 */}
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                sourceLabel === '음성'
                                  ? 'bg-pink-50 text-pink-600 border border-pink-100'
                                  : sourceLabel === '앱'
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}>
                                {sourceLabel}
                              </span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                mainStatus === '보류'
                                  ? 'bg-amber-400 text-slate-950'
                                  : mainStatus === '수동수정'
                                    ? 'bg-purple-100 text-purple-700'
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}>
                                {mainStatus}
                              </span>
                            </div>
                          </div>
                        ) : (
                          // 단건인 경우
                          <div>
                            {/* 1행: 닉네임 + 고객 통계 알약 + 우측 끝 금액 */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span className="font-bold text-sm sm:text-base text-slate-900 group-hover:text-brand-600 transition-colors">
                                  {buyer.nickname}
                                </span>
                                <CustomerStatsBadge
                                  nickname={buyer.nickname}
                                  buyerId={buyer.records[0]?.buyerId}
                                  variant="pill"
                                  currentSessionId={selectedSessionId !== 'ALL' ? selectedSessionId : undefined}
                                />
                              </div>
                              <div className="text-base sm:text-lg font-black text-blue-600 whitespace-nowrap ml-auto">
                                {totalAmount > 0 ? `${totalAmount.toLocaleString()}원` : '0원'}
                              </div>
                            </div>

                            {/* 2행: 출처/상태 태그 */}
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                sourceLabel === '음성'
                                  ? 'bg-pink-50 text-pink-600 border border-pink-100'
                                  : sourceLabel === '앱'
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}>
                                {sourceLabel}
                              </span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                mainStatus === '보류'
                                  ? 'bg-amber-400 text-slate-950'
                                  : mainStatus === '수동수정'
                                    ? 'bg-purple-100 text-purple-700'
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}>
                                {mainStatus}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ===================== [우측: 고객 문자 및 은행 입금 인박스] ===================== */}
        <section className="flex-1 flex flex-col min-h-0 bg-slate-50">
          {/* 상단 서브 탭 바: 고객 문자함 ↔ 실시간 은행 입금함 */}
          <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-3 shadow-2xs z-10">
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setInboxTab('MESSAGES')}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  inboxTab === 'MESSAGES'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Inbox className="w-3.5 h-3.5 text-cyan-600" />
                고객 문자 인박스 ({filteredThreads.length})
              </button>
              <button
                type="button"
                onClick={() => setInboxTab('PAYMENTS')}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 relative ${
                  inboxTab === 'PAYMENTS'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5 text-brand-600" />
                실시간 은행 입금 ({sessionFilteredPayments.length})
                {unmatchedPayments.length > 0 && (
                  <span className="bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-2xs">
                    {unmatchedPayments.length}건 미확인
                  </span>
                )}
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-2 text-xs">
              {inboxTab === 'MESSAGES' ? (
                <span className="text-slate-500">
                  총 수신 문자 <strong className="text-slate-900 font-bold">{sessionFilteredMessages.length}</strong>건
                </span>
              ) : (
                <span className="text-slate-500">
                  총 입금액 <strong className="text-brand-700 font-black">{sessionFilteredPayments.reduce((sum, p) => sum + (p.amount || 0), 0).toLocaleString()}</strong>원
                </span>
              )}
            </div>
          </div>

          {inboxTab === 'MESSAGES' ? (
            <div className="flex-1 flex flex-col md:flex-row min-h-0 bg-slate-50 overflow-hidden">
              {/* [우측-1: 전화번호별 대화목록 스레드] */}
              <div className="w-full md:w-72 lg:w-80 flex flex-col border-r border-slate-200 bg-white">
            <div className="p-3 border-b border-slate-100 bg-slate-50/70 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <Inbox className="w-3.5 h-3.5 text-cyan-600" />
                  고객 문자 인박스 ({filteredThreads.length})
                </span>
                {messagesSearch.trim() ? (
                  <button
                    type="button"
                    onClick={() => setMessagesSearch('')}
                    className="text-[11px] font-bold text-cyan-700 bg-cyan-100 hover:bg-cyan-200 border border-cyan-300 px-2.5 py-0.5 rounded-lg transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-95 flex items-center gap-1"
                    title="전체 수발신 문자 목록 보기"
                  >
                    전체 수발신
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400 font-medium">전체 수발신</span>
                )}
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
                  {sessionFilteredMessages.length === 0
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
                          {thread.needsNicknameCheck && (
                            <span
                              className="text-[10px] font-black text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded border border-rose-200 whitespace-nowrap"
                              title="문자 속 닉네임이 비슷하지만 똑같지는 않습니다. 맞으면 닉네임을 직접 연결해 주세요."
                            >
                              닉네임 확인필요
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
                        ) : thread.needsNicknameCheck ? (
                          <span className="text-rose-600 font-bold">비슷한 닉네임 감지</span>
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
                          const isManuallyLinked = manualNicknames.has(activeThread.phoneKey)
                            || savedPhoneLinks.has(activeThread.phoneKey);

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
                                {activeThread.needsNicknameCheck && (
                                  <span
                                    className="text-[10px] font-black text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-full border border-rose-200"
                                    title="문자 속 닉네임이 비슷하지만 똑같지는 않습니다. 맞으면 닉네임을 직접 연결해 주세요."
                                  >
                                    닉네임 확인필요
                                  </span>
                                )}
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

                {/* 실시간 은행 입금 대조 배너 */}
                {(() => {
                  const connectedNickname =
                    activeThread.existingNickname ||
                    activeThread.newMatchedNickname ||
                    manualNicknames.get(activeThread.phoneKey) ||
                    null;

                  const matchingSales = connectedNickname
                    ? sales.filter(
                        (s) => s.buyerNickname?.trim().toLowerCase() === connectedNickname.trim().toLowerCase()
                      )
                    : [];
                  const requiredTotal = matchingSales.reduce((sum, s) => sum + (s.amount || 0), 0);
                  const pSummary = getBuyerPaymentSummary(connectedNickname, requiredTotal);

                  if (connectedNickname) {
                    if (pSummary.paymentList.length > 0) {
                      return (
                        <div
                          className={`px-3.5 py-2.5 border-b text-xs flex flex-wrap items-center justify-between gap-2 shadow-2xs ${
                            pSummary.status === 'PAID'
                              ? 'bg-cyan-50/80 border-cyan-200 text-cyan-900'
                              : pSummary.status === 'OVERPAID'
                              ? 'bg-purple-50/80 border-purple-200 text-purple-900'
                              : 'bg-amber-50/80 border-amber-200 text-amber-900'
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <CreditCard className="w-4 h-4 flex-shrink-0" />
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-extrabold text-sm">
                                은행 입금: {pSummary.totalPaid.toLocaleString()}원
                              </span>
                              {pSummary.status === 'PAID' && (
                                <span className="bg-cyan-600 text-white text-[10px] font-black px-1.5 py-0.2 rounded-md">
                                  주문 전액 완납 ({requiredTotal.toLocaleString()}원)
                                </span>
                              )}
                              {pSummary.status === 'OVERPAID' && (
                                <span className="bg-purple-600 text-white text-[10px] font-black px-1.5 py-0.2 rounded-md">
                                  +{pSummary.diff.toLocaleString()}원 초과입금
                                </span>
                              )}
                              {pSummary.status === 'PARTIAL' && (
                                <span className="bg-amber-600 text-white text-[10px] font-black px-1.5 py-0.2 rounded-md">
                                  주문 {requiredTotal.toLocaleString()}원 중 미납 {(requiredTotal - pSummary.totalPaid).toLocaleString()}원
                                </span>
                              )}
                            </div>

                            {/* 입금 상세 배지 목록 */}
                            <div className="flex items-center gap-1 flex-wrap">
                              {pSummary.paymentList.map((p) => (
                                <span
                                  key={p.id}
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getBankBadgeStyle(p.bank)}`}
                                  title={`입금일시: ${formatDateTime(p.paidAt)}`}
                                >
                                  {p.bank || '은행'} · {p.payerName} ({p.amount.toLocaleString()}원)
                                </span>
                              ))}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setInboxTab('PAYMENTS');
                              setPaymentsSearch(connectedNickname);
                            }}
                            className="text-[11px] font-bold underline hover:opacity-80 transition-opacity ml-auto"
                          >
                            입금함에서 상세 보기
                          </button>
                        </div>
                      );
                    }

                    // 닉네임은 있지만 입금 내역이 아직 없는 경우
                    return (
                      <div className="px-3.5 py-2 bg-slate-100/90 border-b border-slate-200 text-xs flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-slate-700 font-semibold">
                            은행 입금 확인 대기 중
                            {requiredTotal > 0 && ` (주문 금액: ${requiredTotal.toLocaleString()}원)`}
                          </span>
                        </div>
                        {unmatchedPayments.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setInboxTab('PAYMENTS');
                            }}
                            className="text-[11px] font-bold text-cyan-700 hover:text-cyan-800 bg-white border border-cyan-300 px-2 py-0.5 rounded-lg shadow-2xs hover:shadow-xs transition-all flex items-center gap-1"
                          >
                            <Link2 className="w-3 h-3 text-cyan-600" />
                            미확인 입금({unmatchedPayments.length}건)에서 연결하기
                          </button>
                        )}
                      </div>
                    );
                  }

                  // 닉네임이 아직 없는 번호인 경우
                  return (
                    <div className="px-3.5 py-1.5 bg-amber-50/50 border-b border-amber-200 text-[11px] text-amber-800 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span>위 상단에서 고객 닉네임을 연결하시면 실시간 은행 입금 내역과 자동 대조됩니다.</span>
                    </div>
                  );
                })()}

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
              /* 문자 미수신 고객이거나 대화방 미선택 시: 대화내역 빈칸 */
              <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50/40" />
            )}
          </div>
        </div>
      ) : (
        /* ===================== [우측: 은행 입금함 전용 뷰] ===================== */
        <div className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden">
          {/* 상단 통계 및 필터/검색 바 */}
          <div className="p-3 border-b border-slate-200 bg-slate-50/70 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-cyan-600" />
                  실시간 은행 입금 내역 ({filteredPayments.length}건)
                </span>

                {/* 통계 배지 */}
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  매칭 완료 {sessionFilteredPayments.length - unmatchedPayments.length}건
                </span>
                {unmatchedPayments.length > 0 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-600" />
                    확인 필요 {unmatchedPayments.length}건
                  </span>
                )}
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 flex items-center gap-1 shadow-2xs" title="입금자 매칭 정보가 클라우드에 자동 동기화되어 모든 기기에서 공유됩니다">
                  <Cloud className="w-3 h-3 text-cyan-500" />
                  클라우드 동기화
                </span>
              </div>

              <span className="text-xs font-black text-slate-700">
                입금 합계: <span className="text-brand-700 font-black">{filteredPayments.reduce((s, p) => s + (p.amount || 0), 0).toLocaleString()}원</span>
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {/* 검색창 */}
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="입금자명, 은행명, 금액, 매칭된 닉네임 검색..."
                  value={paymentsSearch}
                  onChange={(e) => setPaymentsSearch(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:border-cyan-500 focus:outline-none"
                />
                {paymentsSearch && (
                  <button
                    onClick={() => setPaymentsSearch('')}
                    className="absolute right-2 top-2 p-0.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                    title="검색어 지우기"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* 필터 버튼들 */}
              <div className="flex items-center gap-1 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setPaymentStatusFilter('ALL')}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                    paymentStatusFilter === 'ALL'
                      ? 'bg-slate-800 text-white shadow-2xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  전체 ({sessionFilteredPayments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentStatusFilter('UNMATCHED')}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap ${
                    paymentStatusFilter === 'UNMATCHED'
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
                  }`}
                >
                  <AlertCircle className="w-3 h-3" />
                  확인 필요 ({unmatchedPayments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentStatusFilter('MATCHED')}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap ${
                    paymentStatusFilter === 'MATCHED'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  매칭 완료 ({sessionFilteredPayments.length - unmatchedPayments.length})
                </button>
              </div>
            </div>
          </div>

          {/* 입금 리스트 피드 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50/50">
            {filteredPayments.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                {sessionFilteredPayments.length === 0
                  ? '해당 방송 회차에 수신된 은행 입금 알림이 없습니다.'
                  : '검색 또는 필터 조건에 일치하는 입금 내역이 없습니다.'}
              </div>
            ) : (
              filteredPayments.map((payment) => {
                const matchedNick = getMatchedNicknameForPayment(payment.id);
                const isManual = manualPaymentLinks.has(payment.id);
                const selectedCandidateNick =
                  selectedSale?.buyerNickname ||
                  activeThread?.existingNickname ||
                  activeThread?.newMatchedNickname ||
                  null;
                const isEditing = editingPaymentId === payment.id;

                return (
                  <div
                    key={payment.id}
                    className={`p-3.5 rounded-2xl border transition-all bg-white shadow-xs ${
                      isEditing
                        ? 'border-brand-500 ring-2 ring-brand-500/20 shadow-md'
                        : matchedNick
                        ? 'border-slate-200 hover:border-cyan-400'
                        : 'border-amber-200 bg-amber-50/30 hover:border-amber-400'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs font-black px-2 py-0.5 rounded-lg border ${getBankBadgeStyle(payment.bank)}`}
                        >
                          {payment.bank || '은행'}
                        </span>
                        <span className="text-sm font-black text-slate-900">
                          {payment.payerName || '입금자 미지정'}
                        </span>
                        <span className="text-xs text-slate-400 font-medium">
                          {formatDateTime(payment.paidAt || payment.createdAt)}
                        </span>
                      </div>

                      <span className="text-base font-black text-brand-700">
                        {payment.amount.toLocaleString()}원
                      </span>
                    </div>

                    {payment.memo && (
                      <div className="mt-1.5 text-xs text-slate-500 bg-slate-100/70 px-2 py-1 rounded-md inline-block">
                        적요/메모: {payment.memo}
                      </div>
                    )}

                    {isEditing ? (
                      /* 수정/입력 모드 */
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 bg-slate-50/90 -mx-3.5 -mb-3.5 p-3 rounded-b-2xl">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                            <Pencil className="w-3.5 h-3.5 text-brand-600" />
                            고객 매칭 닉네임 입력/수정
                          </span>
                          <span className="text-[11px] text-slate-400">
                            입금자명: <strong>{payment.payerName || '미지정'}</strong>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <div className="relative flex-1 min-w-[150px]">
                            <input
                              type="text"
                              list={`buyer-datalist-${payment.id}`}
                              placeholder="고객 닉네임 검색 또는 직접 입력"
                              value={editPaymentNickInput}
                              onChange={(e) => setEditPaymentNickInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSavePaymentNick(payment.id);
                                } else if (e.key === 'Escape') {
                                  setEditingPaymentId(null);
                                }
                              }}
                              autoFocus
                              className="w-full text-xs px-2.5 py-1.5 bg-white border border-brand-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 font-bold text-slate-800"
                            />
                            <datalist id={`buyer-datalist-${payment.id}`}>
                              {allBuyerNicknames.map((nick) => (
                                <option key={nick} value={nick} />
                              ))}
                            </datalist>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleSavePaymentNick(payment.id)}
                            disabled={!editPaymentNickInput.trim()}
                            className="px-3 py-1.5 text-xs font-black bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-lg transition-colors flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            매칭 저장
                          </button>

                          {matchedNick && (
                            <button
                              type="button"
                              onClick={() => {
                                handleUnlinkPayment(payment.id);
                                setEditingPaymentId(null);
                              }}
                              className="px-2.5 py-1.5 text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg border border-rose-200 transition-colors flex items-center gap-1 cursor-pointer"
                              title="기존 매칭 해제"
                            >
                              <Unlink className="w-3.5 h-3.5" />
                              연결 해제
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setEditingPaymentId(null);
                              setEditPaymentNickInput('');
                            }}
                            className="px-2.5 py-1.5 text-xs font-bold bg-white hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-200 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            취소
                          </button>
                        </div>

                        {allBuyerNicknames.length > 0 && (
                          <div className="mt-2 flex items-center gap-1 flex-wrap">
                            <span className="text-[10px] text-slate-400 font-medium">추천 선택:</span>
                            {selectedCandidateNick && (
                              <button
                                type="button"
                                onClick={() => setEditPaymentNickInput(selectedCandidateNick)}
                                className="text-[10px] px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded font-bold border border-amber-300 transition-colors cursor-pointer"
                              >
                                {selectedCandidateNick} (현재 선택 고객)
                              </button>
                            )}
                            {allBuyerNicknames.slice(0, 5).map((nick) => {
                              if (nick === selectedCandidateNick) return null;
                              return (
                                <button
                                  key={nick}
                                  type="button"
                                  onClick={() => setEditPaymentNickInput(nick)}
                                  className="text-[10px] px-1.5 py-0.5 bg-slate-200/80 hover:bg-slate-200 text-slate-700 rounded font-medium transition-colors cursor-pointer"
                                >
                                  {nick}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* 일반 조회 모드 */
                      <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        {/* 매칭 상태 표시 */}
                        <div className="flex items-center gap-1.5">
                          {matchedNick ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-cyan-800 bg-cyan-50 px-2.5 py-0.5 rounded-full border border-cyan-200 flex items-center gap-1">
                                <UserCheck className="w-3.5 h-3.5 text-cyan-600" />
                                고객 매칭: <strong>{matchedNick}</strong>
                              </span>
                              {isManual && (
                                <button
                                  type="button"
                                  onClick={() => handleUnlinkPayment(payment.id)}
                                  className="text-slate-400 hover:text-red-500 p-0.5 transition-colors cursor-pointer"
                                  title="입금 연결 해제"
                                >
                                  <Unlink className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs font-bold text-amber-700 bg-amber-100/80 px-2.5 py-0.5 rounded-full border border-amber-300 flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                              확인 필요 (고객 미매칭)
                            </span>
                          )}
                        </div>

                        {/* 액션 버튼 영역 */}
                        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                          {/* 수정 버튼 */}
                          <button
                            type="button"
                            onClick={() => handleStartEditPayment(payment.id, matchedNick, payment.payerName)}
                            className="px-2.5 py-1 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition-colors flex items-center gap-1 shadow-2xs cursor-pointer"
                            title="고객 매칭 닉네임 수정 및 입력"
                          >
                            <Pencil className="w-3 h-3 text-slate-600" />
                            수정
                          </button>

                          {matchedNick ? (
                            <button
                              type="button"
                              onClick={() => {
                                setInboxTab('MESSAGES');
                                setMessagesSearch(matchedNick);
                                handleSelectBuyerFromSales({ buyerNickname: matchedNick } as any);
                              }}
                              className="px-2.5 py-1 text-xs font-bold bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded-lg border border-cyan-200 transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <MessageSquare className="w-3 h-3" />
                              문자 대화 보기
                            </button>
                          ) : (
                            selectedCandidateNick && (
                              <button
                                type="button"
                                onClick={() => handleLinkPaymentToBuyer(payment.id, selectedCandidateNick)}
                                className="px-2.5 py-1 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
                                title={`현재 선택된 '${selectedCandidateNick}' 고객과 즉시 연결합니다`}
                              >
                                <Link2 className="w-3 h-3" />
                                '{selectedCandidateNick}'에 즉시 연결
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
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
