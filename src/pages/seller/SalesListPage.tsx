import { useWorkspaceRuntime, useRuntimeAuth as useAuth } from '../../context/WorkspaceRuntimeContext';
import React, { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';

import { LiveSession } from '../../types/productSales';
import { SaleRecord } from '../../types/live';
import { BuyerReconciliationPanel, BuyerStatusBadges } from '../../components/sales/BuyerReconciliationPanel';
import { AiSaleBadge } from '../../components/sales/AiSaleBadge';
import { cleanMessageBody } from '../../utils/textCleaner';
import {
  ShoppingBag,
  Search,
  Users,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Download,
  Layers,
  ArrowRight,
  Clock,
  ZoomIn,
  MessageSquare,
  CreditCard,
  CheckCircle2,
  Smartphone,
  ChevronRight,
  ExternalLink,
  Truck,
  Trash2,
  RotateCcw
} from 'lucide-react';

import { ShippingConfigModal } from '../../components/shipping/ShippingConfigModal';
import { shippingService } from '../../services/shippingService';
import { KeepingBadge } from '../../components/shipping/KeepingBadge';
import { customerKeepingService } from '../../services/customerKeepingService';
import { formatAmountAsDecimal, formatMultiSaleAmount } from '../../services/salesExtractor';
import { getSalePurchaseHistory } from '../../services/saleRowHistory';
import { formatSessionDisplay } from '../../utils/sessionFormatter';
import { ImageViewerModal } from '../../components/common/ImageViewerModal';
import { getPromiseDefault, promiseDefaultBuyerKey, summarizePromiseDefaults } from '../../services/promiseDefaultService';
import { calculateSalesListRevenue } from '../../services/salesListRevenue';
import { isBillableSale } from '../../services/billableSales';
import { needsServerReview } from '../../services/serverRejectedSale';
import { findNicknameInMessages, messageMentionsNickname, needsNicknameConfirmation } from '../../services/smsNicknameLink';
import { useBuyerPhoneLinks } from '../../hooks/useBuyerPhoneLinks';
import {
  AppRowActions,
  AppSaleMenuSheet,
  AppTotalsBar,
  appRowPress,
  type AppMenuTarget,
} from '../../components/sales/AppSaleMenu';

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

const normalizePhone = (raw: string): string => {
  if (!raw) return '';
  let compact = raw.replace(/[^0-9+]/g, '');
  if (compact.startsWith('+82')) compact = '0' + compact.slice(3);
  if (compact.startsWith('82') && compact.length >= 11) compact = '0' + compact.slice(2);
  return compact.replace(/\D/g, '');
};

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

interface BuyerGroupedSale {
  groupKey: string;
  buyerNickname: string;
  totalAmount: number;
  orderCount: number;
  records: SaleRecord[];
  hasPending: boolean;
  hasManualEdited: boolean;
  latestRecognizedAt: string;
  productImageUrls: string[];
  captureImageUrls: string[];
  sessionIds: string[];
}

export const SalesListPage: React.FC = () => {
  const runtime = useWorkspaceRuntime();
  const { productSalesApi } = runtime;
  const { workspaceId } = useAuth();
  const { sales, promiseDefaults, setPromiseDefault, exportCsv, refreshSales, deleteSale, restoreSales } = useSales();
  const { messages, payments, claims, invoices, shipments } = useCommerce();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchTerm, setSearchTerm] = useState('');
  const [isShippingModalOpen, setIsShippingModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'BUYER_GROUPED' | 'INDIVIDUAL'>('BUYER_GROUPED');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<'AMOUNT_DESC' | 'COUNT_DESC' | 'LATEST' | 'OLDEST'>('AMOUNT_DESC');
  const [expandedBuyers, setExpandedBuyers] = useState<string[]>([]);
  const [promiseDefaultBusy, setPromiseDefaultBusy] = useState<string | null>(null);
  const [promiseDefaultError, setPromiseDefaultError] = useState<{ key: string; message: string } | null>(null);
  const [cloudSessions, setCloudSessions] = useState<LiveSession[]>([]);
  const [shippingConfig, setShippingConfig] = useState(() => shippingService.getConfig(workspaceId));
  const [actionToast, setActionToast] = useState<string | null>(null);
  // 판매 앱에서 카드의 ⋯ 버튼·길게 누르기로 여는 메뉴
  const [appMenu, setAppMenu] = useState<AppMenuTarget | null>(null);

  // 최근 삭제 내역 (실행 취소 / Undo 지원)
  const [deletedHistory, setDeletedHistory] = useState<{
    sales: SaleRecord[];
    label: string;
    expiresAt: number;
    /** 같이 지운 댓글터치 판매(되돌릴 수 없음) 안내. */
    note?: string;
  } | null>(null);
  const [undoCountdown, setUndoCountdown] = useState<number>(5);

  const showToast = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 3000);
  };

  // 실행 취소 타이머 처리
  useEffect(() => {
    if (!deletedHistory) return;
    setUndoCountdown(5);
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deletedHistory.expiresAt - Date.now()) / 1000));
      setUndoCountdown(remaining);
      if (remaining <= 0) {
        setDeletedHistory(null);
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [deletedHistory]);

  const triggerUndoableDelete = (salesToSave: SaleRecord[], label: string, note?: string) => {
    setDeletedHistory({
      sales: salesToSave,
      label,
      expiresAt: Date.now() + 5000,
      note,
    });
  };

  const handleUndoDelete = () => {
    if (!deletedHistory || deletedHistory.sales.length === 0) return;
    const count = deletedHistory.sales.length;
    restoreSales(deletedHistory.sales);
    setDeletedHistory(null);
    showToast(`삭제를 취소하고 판매 내역 ${count}건을 정상 복구했습니다.`);
  };

  // 댓글터치 판매의 삭제는 서버에 "취소"로 저장되고 서버는 취소된 판매를 되살리지 않는다.
  // 그래서 터치 판매는 실행 취소를 띄우지 않는다(띄우면 화면에만 되살아나고 서버는 그대로 취소).
  const undoNote = (records: SaleRecord[]) =>
    records.some((r) => r.touchSale)
      ? '댓글터치 판매는 취소로 저장되며 되돌릴 수 없습니다.'
      : '삭제 후 5초 동안 화면 하단에서 실행 취소할 수 있습니다.';
  const finishDelete = (records: SaleRecord[], label: string) => {
    const undoable = records.filter((r) => !r.touchSale);
    const touchCount = records.length - undoable.length;
    // 섞여 있으면 실행 취소 막대 하나에 두 결과를 같이 적는다(막대가 떠 있는 동안 토스트는 가려진다).
    if (undoable.length > 0) {
      triggerUndoableDelete(
        undoable,
        touchCount === 0 ? label : `${label} 중 ${undoable.length}건`,
        touchCount > 0 ? `댓글터치 ${touchCount}건은 취소로 저장(되돌릴 수 없음)` : undefined,
      );
    } else if (touchCount > 0) {
      showToast(`${label}: 댓글터치 판매 ${touchCount}건을 취소로 저장했습니다.`);
    }
  };

  // 구매자별 내역 전체 삭제 핸들러
  const handleDeleteBuyer = (buyer: BuyerGroupedSale, e?: React.MouseEvent, alreadyConfirmed = false) => {
    e?.stopPropagation();
    const count = buyer.records.length;
    if (count === 0) {
      alert('삭제할 판매 내역이 없습니다.');
      return;
    }
    const confirmed = alreadyConfirmed || window.confirm(
      `'${buyer.buyerNickname}' 님의 판매 내역 전체 (${count}건)를 삭제하시겠습니까?\n(${undoNote(buyer.records)})`
    );
    if (!confirmed) return;

    const recordsToBackup = [...buyer.records];
    buyer.records.forEach((rec) => {
      deleteSale(rec.id);
    });

    setExpandedBuyers((prev) => prev.filter((k) => k !== buyer.groupKey));
    finishDelete(recordsToBackup, `'${buyer.buyerNickname}' 님의 판매 내역 ${count}건`);
  };

  // 개별 판매 내역 단건 삭제 핸들러
  const handleDeleteSingleSale = (sale: SaleRecord, e?: React.MouseEvent, alreadyConfirmed = false) => {
    e?.preventDefault();
    e?.stopPropagation();
    const title = sale.productName || sale.productCode || (sale.amount > 0 ? `${sale.amount.toLocaleString()}원` : '해당 판매 건');
    const confirmed = alreadyConfirmed || window.confirm(
      `'${sale.buyerNickname}' 님의 [${title}] 판매 내역을 삭제하시겠습니까?\n(${undoNote([sale])})`
    );
    if (!confirmed) return;

    const recordToBackup = [sale];
    deleteSale(sale.id);
    finishDelete(recordToBackup, `'${title}' 판매 내역 1건`);
  };

  // 판매 앱 전용 메뉴(⋯ 버튼, 길게 누르기). 확인은 메뉴 안에서 하므로 window.confirm을 거치지 않는다.
  const openSaleMenu = (sale: SaleRecord) => {
    const printable = sale.status !== '보류' && sale.status !== '취소'
      && sale.recordState !== 'CANCELLED' && sale.syncStatus !== 'PENDING';
    setAppMenu({
      title: `${sale.buyerNickname}님`,
      subtitle: `${sale.amount > 0 ? `${sale.amount.toLocaleString()}원` : '금액 미확인'} · ${new Date(sale.recognizedAt).toLocaleTimeString('ko-KR')}`,
      detailHref: runtime.path(`/sales/${sale.id}${sessionQuery}`),
      reprint: printable ? sale : undefined,
      deleteLabel: '이 판매 내역 삭제',
      deleteNote: undoNote([sale]),
      onDelete: () => handleDeleteSingleSale(sale, undefined, true),
    });
  };
  const openBuyerMenu = (buyer: BuyerGroupedSale) => {
    if (buyer.records.length === 0) return;
    setAppMenu({
      title: `${buyer.buyerNickname}님`,
      subtitle: `${buyer.records.length}건 · 합계 ${buyer.totalAmount.toLocaleString()}원`,
      deleteLabel: `이 구매자의 판매 내역 ${buyer.records.length}건 전체 삭제`,
      deleteNote: undoNote(buyer.records),
      onDelete: () => handleDeleteBuyer(buyer, undefined, true),
    });
  };

  useEffect(() => {
    setShippingConfig(shippingService.getConfig(workspaceId));
  }, [workspaceId, isShippingModalOpen]);

  // 정산 화면에서 구매자별로 수동 지정한 택배비(무료 등)를 다른 기기 값까지 받아 반영
  const [, setShippingOverrideVersion] = useState(0);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    shippingService.fetchRemoteOverrides(workspaceId).then(() => {
      if (active) setShippingOverrideVersion((v) => v + 1);
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const [viewerModal, setViewerModal] = useState<{
    isOpen: boolean;
    images: string[];
    initialIndex: number;
    title: string;
  }>({
    isOpen: false,
    images: [],
    initialIndex: 0,
    title: ''
  });

  const openImageViewer = (images: string[], index = 0, title = '이미지') => {
    if (!images || images.length === 0) return;
    setViewerModal({
      isOpen: true,
      images,
      initialIndex: index,
      title
    });
  };

  useEffect(() => {
    let active = true;
    void Promise.all([refreshSales(), productSalesApi.listSessions()])
      .then(([, sessionData]) => {
        if (active) setCloudSessions(sessionData.sessions);
      })
      .catch((error) => console.error('[SalesList] 클라우드 판매 내역 조회 실패', error));
    return () => { active = false; };
  }, [refreshSales]);

  // 고유 방송 회차 세션 목록 추출
  const availableSessions = useMemo(() => {
    const sessionsById = new Map(cloudSessions.map((session) => [session.id, session]));
    // 이전 형식으로 저장된 판매 건도 클라우드 sales 테이블에서 확인할 수 있게 유지한다.
    sales.forEach((sale) => {
      if (sale.sessionId && !sessionsById.has(sale.sessionId)) {
        sessionsById.set(sale.sessionId, {
          id: sale.sessionId,
          displayCode: formatSessionDisplay(sale.sessionId, { recognizedAt: sale.recognizedAt }),
          status: 'ENDED',
          revision: 1,
          startedAt: sale.recognizedAt,
        });
      }
    });
    return Array.from(sessionsById.values()).sort((left, right) => (
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
    ));
  }, [cloudSessions, sales]);

  // 가장 최근 회차 세션 (진행 중인 세션 우선, 없으면 시작시각 기준 가장 최근 회차)
  const latestSessionId = useMemo(() => {
    if (availableSessions.length === 0) return null;
    const active = availableSessions.find((s) => s.status === 'ACTIVE');
    return active ? active.id : availableSessions[0].id;
  }, [availableSessions]);

  // URL 파라미터가 없으면 최근 회차를 기본값으로 지정
  const sessionFilter = useMemo(() => {
    const raw = searchParams.get('session');
    if (raw !== null) {
      return raw;
    }
    return latestSessionId || 'ALL';
  }, [searchParams, latestSessionId]);

  // 초기 진입 시 URL에 session 파라미터가 없으면 최근 회차로 URL 동기화 (기본값 최근회차)
  useEffect(() => {
    if (searchParams.get('session') === null && latestSessionId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('session', latestSessionId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, latestSessionId, setSearchParams]);

  const selectedSession = sessionFilter === 'ALL'
    ? null
    : availableSessions.find((session) => session.id === sessionFilter) || null;
  const sessionQuery = sessionFilter === 'ALL' ? '' : `?session=${encodeURIComponent(sessionFilter)}`;

  const handleSessionFilterChange = (nextSessionId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('session', nextSessionId);
    setSearchParams(nextParams);
  };

  // 1차 필터링
  const filteredSales = useMemo(() => {
    return sales.filter((item) => {
      if (item.aiVerification?.reviewDecision === 'NOT_SALE') return false;
      if (sessionFilter !== 'ALL' && item.sessionId !== sessionFilter) return false;
      const matchesSearch =
        item.buyerNickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.rawTranscript.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.amount.toString().includes(searchTerm) ||
        item.sessionId.includes(searchTerm);
      if (!matchesSearch) return false;
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      return true;
    });
  }, [sales, sessionFilter, searchTerm, statusFilter]);

  // 과거 거래 내역 전화번호 -> 닉네임 맵
  // 지난 회차 문자로 확인돼 저장된 전화번호 → 닉네임 연결
  const { phoneToNickname: savedPhoneLinks, rememberLinks } = useBuyerPhoneLinks(workspaceId);

  const pastTransactionPhoneMap = useMemo(() => {
    const map = new Map<string, string>(savedPhoneLinks);
    claims.forEach((c) => {
      const norm = normalizePhone(c.phoneNumber);
      if (norm && c.nickname?.trim()) map.set(norm, c.nickname.trim());
    });
    invoices.forEach((inv) => {
      const norm = normalizePhone(inv.phoneNumber);
      if (norm && inv.customerNickname?.trim()) map.set(norm, inv.customerNickname.trim());
    });
    shipments.forEach((s) => {
      const norm = normalizePhone(s.phoneNumber);
      if (norm && s.recipientName?.trim()) map.set(norm, s.recipientName.trim());
    });
    return map;
  }, [claims, invoices, shipments, savedPhoneLinks]);

  // 전체 구매자 닉네임 목록
  const allBuyerNicknames = useMemo(() => {
    const list = sales.map((s) => s.buyerNickname?.trim()).filter(Boolean) as string[];
    return Array.from(new Set(list)).sort((a, b) => b.length - a.length);
  }, [sales]);

  // 선택한 회차의 시작 시각 도출
  const sessionStartTime = useMemo(() => {
    if (!selectedSession?.startedAt) return null;
    const t = new Date(selectedSession.startedAt).getTime();
    return isNaN(t) ? null : t;
  }, [selectedSession]);

  // 선택한 회차 이전에 보내온 문자는 완전히 제외
  const sessionFilteredMessages = useMemo(() => {
    if (!sessionStartTime) return messages;
    return messages.filter((msg) => {
      const timeStr = msg.receivedAt || msg.createdAt;
      const msgTime = new Date(timeStr).getTime();
      if (isNaN(msgTime)) return true;
      return msgTime >= sessionStartTime;
    });
  }, [messages, sessionStartTime]);

  // 문자 메시지 스레드 목록
  const threads = useMemo(() => {
    const groupMap = new Map<string, any[]>();
    sessionFilteredMessages.forEach((msg) => {
      const norm = normalizePhone(msg.phoneNumber);
      if (!norm) return;
      const list = groupMap.get(norm) || [];
      list.push(msg);
      groupMap.set(norm, list);
    });

    const list: any[] = [];
    groupMap.forEach((msgList, norm) => {
      msgList.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const lastMsg = msgList[msgList.length - 1];
      const existingNick = pastTransactionPhoneMap.get(norm) || null;
      const nicknameMatch = findNicknameInMessages(msgList, allBuyerNicknames);
      const matchedNick = nicknameMatch?.nickname || null;
      list.push({
        phoneKey: norm,
        displayPhone: formatPhone(norm),
        messages: msgList,
        lastMessage: lastMsg,
        existingNickname: existingNick,
        newMatchedNickname: matchedNick,
        nicknameMatch,
        isNew: Boolean(matchedNick && !existingNick),
        // 닉네임이 비슷하기만 한 연결: 화면에는 연결하되 판매자 확인이 필요함
        needsNicknameCheck: Boolean(needsNicknameConfirmation(nicknameMatch) && !existingNick),
      });
    });
    return list;
  }, [sessionFilteredMessages, pastTransactionPhoneMap, allBuyerNicknames]);

  // 이번에 문자로 확실히 확인된 번호는 다음 회차에도 자동 연결되도록 저장
  useEffect(() => {
    rememberLinks(
      threads.map((t) => ({ phoneKey: t.phoneKey, knownNickname: t.existingNickname, match: t.nicknameMatch })),
      sessionFilter === 'ALL' ? null : sessionFilter
    );
  }, [threads, rememberLinks, sessionFilter]);

  // 구매자 닉네임 -> 일치하는 문자 스레드 매핑
  const buyerToThreadMap = useMemo(() => {
    const map = new Map<string, any>();
    threads.forEach((t) => {
      if (t.existingNickname) map.set(t.existingNickname.trim().toLowerCase(), t);
      if (t.newMatchedNickname) map.set(t.newMatchedNickname.trim().toLowerCase(), t);
      allBuyerNicknames.forEach((nick) => {
        if (t.messages.some((m: any) => m.direction === 'INCOMING' && messageMentionsNickname(m.body, nick))) {
          if (!map.has(nick.toLowerCase())) map.set(nick.toLowerCase(), t);
        }
      });
    });
    return map;
  }, [threads, allBuyerNicknames]);

  // 선택한 회차 이전에 수신된 은행 입금 알림은 완전히 제외
  const sessionFilteredPayments = useMemo(() => {
    if (!sessionStartTime) return payments;
    return payments.filter((payment) => {
      const timeStr = payment.paidAt || payment.createdAt;
      const paymentTime = new Date(timeStr).getTime();
      if (isNaN(paymentTime)) return true;
      return paymentTime >= sessionStartTime;
    });
  }, [payments, sessionStartTime]);

  // 은행 입금 내역 매핑
  const buyerPaymentsMap = useMemo(() => {
    const map = new Map<string, any[]>();
    const saleIdToBuyerMap = new Map<string, string>();
    sales.forEach((s) => {
      if (s.id && s.buyerNickname?.trim()) saleIdToBuyerMap.set(s.id, s.buyerNickname.trim());
    });
    const invoiceIdToBuyerMap = new Map<string, string>();
    invoices.forEach((inv) => {
      if (inv.id && inv.customerNickname?.trim()) invoiceIdToBuyerMap.set(inv.id, inv.customerNickname.trim());
    });

    sessionFilteredPayments.forEach((p) => {
      let matchedBuyer: string | null = null;
      if (p.saleIds && p.saleIds.length > 0) {
        for (const sid of p.saleIds) {
          const found = saleIdToBuyerMap.get(sid);
          if (found) { matchedBuyer = found; break; }
        }
      }
      if (!matchedBuyer && p.invoiceId) {
        matchedBuyer = invoiceIdToBuyerMap.get(p.invoiceId) || null;
      }
      if (!matchedBuyer && p.payerName) {
        const cleanPayer = p.payerName.replace(/[\s\-_]/g, '').toLowerCase();
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
        list.push(p);
        map.set(key, list);
      }
    });
    return map;
  }, [sessionFilteredPayments, sales, invoices, allBuyerNicknames]);

  // 구매자 입금 요약 계산 헬퍼
  const getBuyerPaymentSummary = useMemo(() => {
    return (buyerNickname?: string | null, requiredAmount?: number) => {
      if (!buyerNickname?.trim()) {
        return { totalPaid: 0, paymentList: [] as any[], status: 'UNPAID' as const, diff: 0 };
      }
      const key = buyerNickname.trim().toLowerCase();
      const list = buyerPaymentsMap.get(key) || [];
      const totalPaid = list.reduce((sum, p) => sum + (p.amount || 0), 0);
      const req = requiredAmount || 0;
      const diff = totalPaid - req;
      let status: 'PAID' | 'PARTIAL' | 'OVERPAID' | 'UNPAID' = 'UNPAID';
      if (totalPaid === 0) status = 'UNPAID';
      else if (req > 0) {
        if (totalPaid === req) status = 'PAID';
        else if (totalPaid > req) status = 'OVERPAID';
        else status = 'PARTIAL';
      } else {
        status = 'PAID';
      }
      return { totalPaid, paymentList: list, status, diff };
    };
  }, [buyerPaymentsMap]);

  // 구매자 묶음 집계
  const buyerGroupedList: BuyerGroupedSale[] = useMemo(() => {
    const map: { [nickname: string]: BuyerGroupedSale } = {};

    filteredSales.forEach((sale) => {
      const key = promiseDefaultBuyerKey(sale.buyerId, sale.buyerNickname.trim() || '미확인(보류)');
      if (!map[key]) {
        map[key] = {
          groupKey: key,
          buyerNickname: sale.buyerNickname.trim() || '미확인(보류)',
          totalAmount: 0,
          orderCount: 0,
          records: [],
          hasPending: false,
          hasManualEdited: false,
          latestRecognizedAt: sale.recognizedAt,
          productImageUrls: [],
          captureImageUrls: [],
          sessionIds: []
        };
      }

      const group = map[key];
      if (isBillableSale(sale)) {
        group.totalAmount += sale.amount || 0;
      }
      group.orderCount += 1;
      group.records.push(sale);
      if (sale.status === '보류') group.hasPending = true;
      if (sale.status === '수동수정') group.hasManualEdited = true;
      if (new Date(sale.recognizedAt).getTime() > new Date(group.latestRecognizedAt).getTime()) {
        group.latestRecognizedAt = sale.recognizedAt;
      }
      if (sale.productImageUrl && !group.productImageUrls.includes(sale.productImageUrl)) {
        group.productImageUrls.push(sale.productImageUrl);
      }
      if (sale.captureImageUrls) {
        sale.captureImageUrls.forEach((imageUrl) => {
          if (imageUrl && !group.captureImageUrls.includes(imageUrl)) {
            group.captureImageUrls.push(imageUrl);
          }
        });
      }
      if (!group.sessionIds.includes(sale.sessionId)) {
        group.sessionIds.push(sale.sessionId);
      }
    });

    // The decision survives deleting the original sale. Keep a small buyer card
    // so the seller can still find and reverse that explicit decision.
    if (statusFilter === 'ALL') for (const decision of promiseDefaults) {
      if (decision.status !== 'CONFIRMED' || (sessionFilter !== 'ALL' && decision.sessionId !== sessionFilter)
        || !decision.buyerNickname.toLowerCase().includes(searchTerm.toLowerCase())) continue;
      if (!map[decision.buyerKey]) {
        map[decision.buyerKey] = {
          groupKey: decision.buyerKey, buyerNickname: decision.buyerNickname,
          totalAmount: 0, orderCount: 0, records: [], hasPending: false,
          hasManualEdited: false, latestRecognizedAt: decision.updatedAt,
          productImageUrls: [], captureImageUrls: [], sessionIds: [decision.sessionId],
        };
      } else if (!map[decision.buyerKey].sessionIds.includes(decision.sessionId)) {
        map[decision.buyerKey].sessionIds.push(decision.sessionId);
      }
    }

    const list = Object.values(map);

    list.sort((a, b) => {
      if (sortOrder === 'AMOUNT_DESC') return b.totalAmount - a.totalAmount;
      if (sortOrder === 'COUNT_DESC') return b.orderCount - a.orderCount;
      if (sortOrder === 'LATEST') return new Date(b.latestRecognizedAt).getTime() - new Date(a.latestRecognizedAt).getTime();
      if (sortOrder === 'OLDEST') return new Date(a.latestRecognizedAt).getTime() - new Date(b.latestRecognizedAt).getTime();
      return 0;
    });

    return list;
  }, [filteredSales, promiseDefaults, searchTerm, sessionFilter, sortOrder, statusFilter]);

  const sortedIndividualSales = useMemo(() => {
    const list = [...filteredSales];
    list.sort((a, b) => {
      if (sortOrder === 'AMOUNT_DESC') return b.amount - a.amount;
      if (sortOrder === 'LATEST') return new Date(b.recognizedAt).getTime() - new Date(a.recognizedAt).getTime();
      if (sortOrder === 'OLDEST') return new Date(a.recognizedAt).getTime() - new Date(b.recognizedAt).getTime();
      return new Date(b.recognizedAt).getTime() - new Date(a.recognizedAt).getTime();
    });
    return list;
  }, [filteredSales, sortOrder]);

  const currentSessionSummary = useMemo(() => {
    const targetSales = sales.filter((s) => s.aiVerification?.reviewDecision !== 'NOT_SALE'
      && (sessionFilter === 'ALL' || s.sessionId === sessionFilter));
    const revenue = calculateSalesListRevenue(targetSales, promiseDefaults);
    const pendingCount = targetSales.filter((s) => s.status === '보류').length;

    return {
      sessionName: sessionFilter === 'ALL' ? '전체 방송 회차 합산' : `회차: ${selectedSession?.displayCode || sessionFilter}`,
      totalCount: targetSales.length,
      ...revenue,
      pendingCount
    };
  }, [sales, promiseDefaults, sessionFilter, selectedSession?.displayCode]);

  const toggleBuyerExpand = (groupKey: string) => {
    setExpandedBuyers((prev) =>
      prev.includes(groupKey) ? prev.filter((key) => key !== groupKey) : [...prev, groupKey]
    );
  };

  const handlePromiseDefault = async (buyer: BuyerGroupedSale, nextStatus: 'CONFIRMED' | 'CANCELLED') => {
    if (sessionFilter === 'ALL' || promiseDefaultBusy) return;
    setPromiseDefaultBusy(buyer.groupKey);
    setPromiseDefaultError(null);
    try {
      await setPromiseDefault(buyer.groupKey, buyer.buyerNickname, sessionFilter, nextStatus);
    } catch (error) {
      setPromiseDefaultError({ key: buyer.groupKey,
        message: error instanceof Error ? error.message : '약속 미이행 기록을 저장하지 못했습니다.' });
    } finally {
      setPromiseDefaultBusy(null);
    }
  };

  const handleExportCurrentView = () => {
    exportCsv(filteredSales, `VoiceCAP_판매내역_${sessionFilter}_${Date.now()}.csv`);
  };

  return (
    <div className="p-2.5 sm:p-4 max-w-7xl mx-auto space-y-2.5 sm:space-y-3">
      {/* 헤더 & 상단 액션 */}
      <div className="bg-white border border-slate-200 px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-sm sm:text-base font-black text-slate-900 tracking-tight">판매 내역 목록</h1>
            <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] font-bold border border-brand-200">
              회차별 묶음
            </span>
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">
            방송 회차별로 판매 내역을 확인하고, 동일 구매자의 중복 주문을 하나로 합산하여 정산합니다.
          </p>
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setIsShippingModalOpen(true)}
            className="h-8 px-2.5 sm:px-3 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 text-xs font-bold flex items-center justify-center space-x-1 transition active:scale-95 text-center flex-1 sm:flex-initial"
            title="택배비 정책 설정 (무료, 조건부 무료, 고정 배송비)"
          >
            <Truck className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />
            <span>택배비 설정</span>
          </button>
          <Link
            to={runtime.path('/sales/review')}
            className="h-8 px-2.5 sm:px-3 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold flex items-center justify-center space-x-1 transition active:scale-95 text-center flex-1 sm:flex-initial"
          >
            <CheckSquare className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
            <span>일괄 확인</span>
          </Link>
          <button
            onClick={handleExportCurrentView}
            className="h-8 px-2.5 sm:px-3 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-xs flex items-center justify-center space-x-1 transition active:scale-95 text-center flex-1 sm:flex-initial"
          >
            <Download className="w-3.5 h-3.5 flex-shrink-0" />
            <span>CSV 저장</span>
          </button>
        </div>
      </div>

      {/* 회차 선택 탭 & 회차 요약 카드 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm space-y-2">
        <div className="flex items-center gap-3 pb-1.5 border-b border-slate-100">
          <label htmlFor="sales-session-filter" className="text-xs font-bold text-slate-700 flex items-center flex-shrink-0">
            <Layers className="w-3.5 h-3.5 mr-1.5 text-brand-600" /> 회차 선택:
          </label>
          <select
            id="sales-session-filter"
            value={sessionFilter}
            onChange={(event) => handleSessionFilterChange(event.target.value)}
            className="min-w-0 flex-1 max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-brand-500"
          >
            {availableSessions.map((session) => {
              const isLatest = session.id === latestSessionId;
              return (
                <option key={session.id} value={session.id}>
                  {session.displayCode}
                  {session.status === 'ACTIVE' ? ' · 진행 중 (실시간)' : isLatest ? ' (최근 회차)' : ''}
                </option>
              );
            })}
            <option value="ALL">전체 회차 (모든 방송 합산)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 pt-0.5">
          <div className="p-2 sm:p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] text-slate-500 font-medium">선택 회차 총 매출액</span>
            <div className="text-base sm:text-lg font-black text-brand-600 mt-0.5 truncate">
              {currentSessionSummary.totalAmount.toLocaleString()}{' '}
              <span className="text-[10px] font-normal text-slate-500">원</span>
            </div>
          </div>

          <div className="p-2 sm:p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-200">
            <span className="text-[10px] text-slate-600 font-medium">선택 회차 확정매출액</span>
            <div className="text-base sm:text-lg font-black text-emerald-700 mt-0.5 truncate">
              {currentSessionSummary.confirmedAmount.toLocaleString()}{' '}
              <span className="text-[10px] font-normal text-slate-500">원</span>
            </div>
            <span className="text-[10px] text-slate-500">약속 미이행 확정분 제외</span>
          </div>

          <div className="p-2 sm:p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] text-slate-500 font-medium">고유 구매자 수</span>
            <div className="text-base sm:text-lg font-black text-purple-700 mt-0.5">
              {currentSessionSummary.uniqueBuyerCount}{' '}
              <span className="text-[10px] font-normal text-slate-500">명</span>
            </div>
          </div>

          <div className="p-2 sm:p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] text-slate-500 font-medium">총 주문 건수</span>
            <div className="text-base sm:text-lg font-black text-slate-900 mt-0.5">
              {currentSessionSummary.totalCount}{' '}
              <span className="text-[10px] font-normal text-slate-500">건</span>
            </div>
          </div>

          <div className="p-2 sm:p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] text-slate-500 font-medium">보류 건수</span>
            <div className="text-base sm:text-lg font-black text-amber-600 mt-0.5">
              {currentSessionSummary.pendingCount}{' '}
              <span className="text-[10px] font-normal text-slate-500">건</span>
            </div>
          </div>
        </div>
      </div>

      {/* 판매 앱: 합계 카드가 화면 위로 올라가면 헤더 밑에 한 줄 합계가 따라온다 */}
      <AppTotalsBar
        count={currentSessionSummary.totalCount}
        amount={currentSessionSummary.totalAmount}
        pending={currentSessionSummary.pendingCount}
      />

      {/* 필터 & 뷰 모드 전환 바 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm space-y-2">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="grid grid-cols-2 sm:flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-200">
            <button
              onClick={() => setViewMode('BUYER_GROUPED')}
              className={`px-3 py-2 sm:px-3.5 sm:py-2 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition ${
                viewMode === 'BUYER_GROUPED'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>구매자별 ({buyerGroupedList.length})</span>
            </button>
            <button
              onClick={() => setViewMode('INDIVIDUAL')}
              className={`px-3 py-2 sm:px-3.5 sm:py-2 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition ${
                viewMode === 'INDIVIDUAL'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>건별 보기 ({sortedIndividualSales.length})</span>
            </button>
          </div>

          <div className="relative flex-1 max-w-full sm:max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="구매자 닉네임, 금액, 발화 내용..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
            />
          </div>
        </div>

        {/* 상태 필터 및 정렬 (모바일 가로 스크롤 지원) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-1">
            <span className="text-slate-500 flex-shrink-0">상태:</span>
            {(['ALL', '확정', '자동저장', '수동수정', '보류'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition flex-shrink-0 ${
                  statusFilter === st
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60'
                }`}
              >
                {st === 'ALL' ? '전체' : st}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-auto">
            <span className="text-slate-500">정렬:</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className="py-1 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none"
            >
              <option value="AMOUNT_DESC">합산 금액 높은순</option>
              <option value="COUNT_DESC">구매 횟수 많은순</option>
              <option value="LATEST">최신 주문순</option>
              <option value="OLDEST">과거 주문순</option>
            </select>
          </div>
        </div>

        {/* 메인 목록 렌더링 */}
        <div className="space-y-3 pt-2">
          {viewMode === 'BUYER_GROUPED' ? (
            buyerGroupedList.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                조회 조건에 맞는 구매자 내역이 없습니다.
              </div>
            ) : (
              buyerGroupedList.map((buyer) => {
                const isExpanded = expandedBuyers.includes(buyer.groupKey);
                const billableRecords = buyer.records.filter(isBillableSale);
                const excludedOrderCount = buyer.records.length - billableRecords.length;
                const buyerSaleIds = buyer.records.map((record) => record.id);
                const promiseDefault = sessionFilter === 'ALL' ? undefined
                  : getPromiseDefault(promiseDefaults, buyer.groupKey, sessionFilter);
                const hasConfirmedPromiseDefault = sessionFilter === 'ALL'
                  ? promiseDefaults.some((decision) => decision.buyerKey === buyer.groupKey && decision.status === 'CONFIRMED')
                  : promiseDefault?.status === 'CONFIRMED';
                const promiseDefaultCount = summarizePromiseDefaults(promiseDefaults, buyer.groupKey).confirmedCount;
                const hasConfirmedSale = sessionFilter !== 'ALL' && buyer.records.some((record) =>
                  record.sessionId === sessionFilter && record.syncStatus !== 'PENDING'
                    && record.status !== '보류' && record.status !== '취소'
                    && record.recordState !== 'CANCELLED' && record.buyerNickname !== '미확인(보류)');
                const buyerThumbnail = buyer.productImageUrls[0]
                  || buyer.captureImageUrls[0]
                  || buyer.records.find((r) => r.productImageUrl)?.productImageUrl
                  || buyer.records.find((r) => r.captureImageUrls && r.captureImageUrls.length > 0)?.captureImageUrls?.[0];

                const paymentSummary = getBuyerPaymentSummary(buyer.buyerNickname, buyer.totalAmount);
                const lastPayment = paymentSummary.paymentList[paymentSummary.paymentList.length - 1];
                const matchedThread = buyer.buyerNickname
                  ? buyerToThreadMap.get(buyer.buyerNickname.trim().toLowerCase())
                  : undefined;

                return (
                  <div
                    key={buyer.groupKey}
                    className={`rounded-2xl border transition overflow-hidden ${
                      buyer.hasPending
                        ? 'bg-amber-50/70 border-amber-300'
                        : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                    }`}
                  >
                    <div
                      className="w-full p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-left hover:bg-slate-50/80 transition"
                      {...appRowPress(() => openBuyerMenu(buyer))}
                    >
                      <div
                        onClick={() => toggleBuyerExpand(buyer.groupKey)}
                        className="flex items-start space-x-3.5 min-w-0 flex-1 cursor-pointer"
                      >
                        {buyerThumbnail ? (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              const allImages = Array.from(new Set([
                                ...buyer.productImageUrls,
                                ...buyer.captureImageUrls,
                                ...buyer.records.map((r) => r.productImageUrl).filter(Boolean),
                                ...buyer.records.flatMap((r) => r.captureImageUrls || []).filter(Boolean)
                              ] as string[]));
                              openImageViewer(
                                allImages.length > 0 ? allImages : [buyerThumbnail],
                                0,
                                `${buyer.buyerNickname}님 관련 이미지`
                              );
                            }}
                            className="group/thumb relative w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex-shrink-0 shadow-sm flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-brand-500 transition mt-0.5"
                            title="클릭하여 원본 이미지 보기"
                          >
                            <img src={buyerThumbnail} alt={`${buyer.buyerNickname} 구매 상품`} className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform" />
                            <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
                              <ZoomIn className="w-4 h-4" />
                            </div>
                            {buyer.orderCount > 1 && (
                              <span className="absolute bottom-0 right-0 bg-slate-900/80 text-white text-[9px] px-1 rounded-tl font-bold z-10">
                                +{buyer.orderCount}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-brand-600 to-purple-600 text-white flex items-center justify-center font-bold text-sm shadow flex-shrink-0 mt-0.5">
                            {buyer.buyerNickname[0]}
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-base text-slate-900">{buyer.buyerNickname}</span>
                            {buyer.records.some((record) => record.evidenceSnapshot?.buyerResolution
                              && record.evidenceSnapshot.buyerResolution.status !== 'MATCHED') && (
                              <span className="text-[10px] rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-800">판매 확정 · 구매자 연결 확인</span>
                            )}
                            {(() => {
                              const keepingSummary = customerKeepingService.getBuyerSummary(
                                buyer.buyerNickname,
                                sessionFilter !== 'ALL' ? sessionFilter : undefined,
                                workspaceId
                              );
                              return keepingSummary.hasActiveKeeping ? (
                                <KeepingBadge summary={keepingSummary} />
                              ) : null;
                            })()}
                            <span className="text-xs px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 font-bold border border-brand-200">
                              {buyer.orderCount ? `총 ${buyer.orderCount}건 구매` : '원본 판매내역 없음'}
                            </span>
                            {buyer.orderCount > 1 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold border border-purple-200">
                                ★ 다건 구매자
                              </span>
                            )}

                            {/* 문자 수신 상태 배지 */}
                            {matchedThread ? (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                                <MessageSquare className="w-2.5 h-2.5 text-emerald-600" />
                                문자 확인 ({matchedThread.messages.length}건)
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200">
                                문자 미수신
                              </span>
                            )}

                            {/* 은행 입금 상태 배지 */}
                            {paymentSummary.status === 'PAID' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-cyan-50 text-cyan-700 border border-cyan-200 flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5 text-cyan-600" />
                                입금완료
                              </span>
                            )}
                            {paymentSummary.status === 'OVERPAID' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5 text-purple-600" />
                                초과입금 (+{paymentSummary.diff.toLocaleString()}원)
                              </span>
                            )}
                            {paymentSummary.status === 'PARTIAL' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5 text-amber-600" />
                                부분입금 ({paymentSummary.totalPaid.toLocaleString()}원)
                              </span>
                            )}
                            {paymentSummary.status === 'UNPAID' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200">
                                입금대기
                              </span>
                            )}

                            {buyer.hasPending && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-bold">
                                보류 포함
                              </span>
                            )}
                            {hasConfirmedPromiseDefault && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold border border-rose-200">
                                약속 미이행 확정
                              </span>
                            )}
                            {buyerSaleIds.length > 0 && (
                              <BuyerStatusBadges
                                saleIds={buyerSaleIds}
                                buyerNickname={buyer.buyerNickname}
                                sessionStartTime={sessionStartTime}
                              />
                            )}
                          </div>

                          <div className="text-[11px] text-slate-500 mt-1 flex items-center space-x-2">
                            <span>최근 주문: {new Date(buyer.latestRecognizedAt).toLocaleTimeString('ko-KR')}</span>
                            <span>•</span>
                            <span>회차: {buyer.sessionIds.map((id) => formatSessionDisplay(id, { sessions: availableSessions, recognizedAt: buyer.latestRecognizedAt })).join(', ')}</span>
                          </div>

                          {/* 입금 내역이 있는 경우: 은행/입금자 및 입금액 미리보기 박스 */}
                          {paymentSummary.paymentList.length > 0 && lastPayment && (
                            <div className="mt-2 p-2 rounded-xl bg-cyan-50/70 border border-cyan-100 text-[11px] space-y-1">
                              <div className="flex items-center justify-between text-slate-700 font-semibold">
                                <div className="flex items-center gap-1.5 truncate">
                                  <CreditCard className="w-3 h-3 text-cyan-600 flex-shrink-0" />
                                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${getBankBadgeStyle(lastPayment.bank)}`}>
                                    {lastPayment.bank || '은행'}
                                  </span>
                                  <span className="text-slate-900 font-bold truncate">{lastPayment.payerName}</span>
                                </div>
                                <span className="text-cyan-800 font-extrabold text-[11px] whitespace-nowrap ml-1">
                                  {paymentSummary.totalPaid.toLocaleString()}원 입금
                                </span>
                              </div>
                            </div>
                          )}

                          {/* 수신된 문자가 있는 경우: 전화번호 및 최근 문자 미리보기 박스 */}
                          {matchedThread && (
                            <div className="mt-2 p-2 rounded-xl bg-emerald-50/70 border border-emerald-100 text-[11px] space-y-1">
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
                        </div>
                      </div>

                      <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-between sm:justify-end flex-shrink-0">
                        <div
                          onClick={() => toggleBuyerExpand(buyer.groupKey)}
                          className="text-right cursor-pointer"
                        >
                          <span className="text-[10px] text-slate-500">총 구매 합계</span>
                          {(() => {
                            const multi = formatMultiSaleAmount(billableRecords.map((r) => r.amount));
                            const shippingCalc = shippingService.calculateShippingFee(
                              buyer.totalAmount,
                              shippingConfig,
                              shippingService.getOverrideForSales(buyer.buyerNickname, buyer.records, workspaceId)
                            );
                            const totalWithShipping = buyer.totalAmount + shippingCalc.fee;

                            if (multi.isMulti) {
                              return (
                                <div className="flex flex-col items-end">
                                  <span className="text-xs font-bold text-brand-600 font-mono">
                                    {multi.decimalExpression} =
                                  </span>
                                  <span className="text-lg font-black text-brand-700">
                                    {multi.totalFormatted}
                                  </span>
                                  <span className="text-xs font-bold text-slate-600 mt-0.5">
                                    택비포함 : {totalWithShipping.toLocaleString()}원
                                  </span>
                                </div>
                              );
                            }
                            return (
                              <div className="flex flex-col items-end">
                                <div className="text-lg font-black text-brand-600">
                                  {buyer.totalAmount.toLocaleString()}원
                                </div>
                                <span className="text-xs font-bold text-slate-600 mt-0.5">
                                  택비포함 : {totalWithShipping.toLocaleString()}원
                                </span>
                              </div>
                            );
                          })()}
                          {excludedOrderCount > 0 && (
                            <span
                              className="block text-[10px] text-slate-500 mt-0.5"
                              title="취소·보류 주문은 합계에서 제외합니다."
                            >
                              합계 제외 {excludedOrderCount}건
                            </span>
                          )}
                        </div>

                        {/* 구매자 판매 내역 전체 삭제 버튼 (판매 앱에서는 ⋯ 메뉴 안으로 들어간다) */}
                        <AppRowActions
                          onOpen={() => openBuyerMenu(buyer)}
                          fallback={
                            <button
                              type="button"
                              onClick={(e) => handleDeleteBuyer(buyer, e)}
                              className="p-2 rounded-xl bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-300 text-slate-400 hover:text-rose-600 transition cursor-pointer flex-shrink-0"
                              title={`'${buyer.buyerNickname}' 구매자 내역 전체 (${buyer.records.length}건) 삭제`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          }
                        />

                        {/* 펼치기/접기 버튼 */}
                        <button
                          type="button"
                          onClick={() => toggleBuyerExpand(buyer.groupKey)}
                          className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-500 transition cursor-pointer flex-shrink-0"
                          title={isExpanded ? '상세 내역 접기' : '상세 내역 펼치기'}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-4 border-t border-slate-100 bg-slate-50/70 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                          <div>
                            <p className="text-xs font-bold text-slate-800">{buyer.buyerNickname}님 약속 미이행</p>
                            <p className="text-[11px] font-semibold text-rose-700 mt-0.5">누적 확정 {promiseDefaultCount}회</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {sessionFilter === 'ALL' ? '방송 회차를 하나 선택하면 기록할 수 있습니다.'
                                : '이 회차의 구매가 여러 건이어도 미이행은 1회만 기록합니다. 사유 입력은 필요하지 않습니다.'}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={sessionFilter === 'ALL' || (!hasConfirmedSale && promiseDefault?.status !== 'CONFIRMED') || Boolean(promiseDefaultBusy)}
                            onClick={() => void handlePromiseDefault(buyer,
                              promiseDefault?.status === 'CONFIRMED' ? 'CANCELLED' : 'CONFIRMED')}
                            className={`rounded-lg px-3 py-2 text-xs font-bold border disabled:opacity-50 disabled:cursor-not-allowed ${
                              promiseDefault?.status === 'CONFIRMED'
                                ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                : 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700'
                            }`}
                          >
                            {promiseDefaultBusy === buyer.groupKey ? '저장 중…'
                              : promiseDefault?.status === 'CONFIRMED' ? '약속미이행취소' : '약속미이행확정'}
                          </button>
                        </div>
                        {promiseDefaultError?.key === buyer.groupKey && promiseDefaultBusy === null && (
                          <p role="alert" className="text-xs font-semibold text-rose-700">{promiseDefaultError.message}</p>
                        )}
                        {buyer.records.length > 0 ? (
                          <BuyerReconciliationPanel
                            buyerNickname={buyer.buyerNickname}
                            records={buyer.records}
                            captureImageUrls={buyer.captureImageUrls}
                            availableSessions={availableSessions}
                            sessionStartTime={sessionStartTime}
                            sessionId={sessionFilter}
                          />
                        ) : (
                          <p className="text-xs text-slate-500">원본 판매내역이 삭제되어도 확정한 미이행 기록은 보존됩니다.</p>
                        )}

                        <div className="text-[11px] font-bold text-slate-600 mb-2 flex items-center justify-between">
                          <span>{buyer.buyerNickname}님의 상세 구매 목록 ({buyer.records.length}건):</span>
                          <span className="text-slate-400">항목 클릭 시 상세 수정 가능</span>
                        </div>
                        {buyer.records.map((rec) => {
                          const recImage = rec.productImageUrl || rec.captureImageUrls?.[0];
                          return (
                          <div
                            key={rec.id}
                            className="p-3 rounded-xl bg-white border border-slate-200 hover:border-brand-400 flex items-center justify-between text-xs transition shadow-sm group"
                            {...appRowPress(() => openSaleMenu(rec))}
                          >
                            <Link
                              to={runtime.path(`/sales/${rec.id}${sessionQuery}`)}
                              className="flex items-center space-x-3 min-w-0 flex-1 mr-2 cursor-pointer"
                            >
                              <div
                                className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200/80 bg-slate-100 flex-shrink-0 flex items-center justify-center shadow-xs relative group/thumb cursor-pointer"
                                onClick={(e) => {
                                  if (recImage) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const images = rec.captureImageUrls && rec.captureImageUrls.length > 0
                                      ? rec.captureImageUrls
                                      : [recImage];
                                    openImageViewer(
                                      images,
                                      0,
                                      `${rec.buyerNickname} 상품/캡처`
                                    );
                                  }
                                }}
                                title={recImage ? '클릭하여 원본 크기로 보기' : undefined}
                              >
                                {recImage ? (
                                  <>
                                    <img src={recImage} alt={rec.productCode || rec.productName || '상품'} className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200" />
                                    <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
                                      <ZoomIn className="w-3.5 h-3.5" />
                                    </div>
                                  </>
                                ) : (
                                  <ShoppingBag className="w-4 h-4 text-brand-600/70" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                      rec.status === '보류'
                                        ? 'bg-amber-400 text-slate-950'
                                        : rec.status === '수동수정'
                                        ? 'bg-purple-100 text-purple-700'
                                        : 'bg-emerald-50 text-emerald-700'
                                    }`}
                                  >
                                    {rec.status}
                                  </span>
                                  <AiSaleBadge sale={rec} />
                                  {rec.syncStatus === 'PENDING' && (
                                    <span
                                      className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-50 text-amber-700 border border-amber-200"
                                      title="아직 서버에 저장되지 않아 이 컴퓨터에만 있는 판매입니다. 합계에는 포함됩니다."
                                    >
                                      서버 저장 대기
                                    </span>
                                  )}
                                  {needsServerReview(rec) && (
                                    <span
                                      className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-orange-50 text-orange-700 border border-orange-200"
                                      title={rec.note}
                                    >
                                      서버 확인 필요
                                    </span>
                                  )}
                                  {(rec.productCode || rec.productName) && (
                                    <span className="text-[11px] font-semibold text-slate-700">
                                      상품 {rec.productCode || ''}{rec.productName ? ` · ${rec.productName}` : ''}
                                    </span>
                                  )}
                                </div>
                                <p className="text-slate-600 italic truncate max-w-md mt-0.5">"{rec.rawTranscript}"</p>
                              </div>
                            </Link>

                            <div className="flex items-center space-x-3 flex-shrink-0">
                              <span className="font-bold text-slate-900 text-sm">
                                {rec.amount.toLocaleString()}원
                                <span className="text-xs text-brand-600 font-mono ml-1 font-semibold">({formatAmountAsDecimal(rec.amount)})</span>
                              </span>
                              <span className="text-[10px] text-slate-400">{new Date(rec.recognizedAt).toLocaleTimeString('ko-KR')}</span>
                              <AppRowActions
                                onOpen={() => openSaleMenu(rec)}
                                fallback={
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => handleDeleteSingleSale(rec, e)}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer"
                                      title="이 판매 내역 삭제"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    <Link
                                      to={runtime.path(`/sales/${rec.id}${sessionQuery}`)}
                                      className="text-slate-400 group-hover:text-brand-600 transition p-1"
                                      title="상세 보기 및 수정"
                                    >
                                      <ArrowRight className="w-3.5 h-3.5" />
                                    </Link>
                                  </>
                                }
                              />
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            sortedIndividualSales.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                조회 조건에 맞는 판매 내역이 없습니다.
              </div>
            ) : (
              sortedIndividualSales.map((sale) => {
                const buyerSales = getSalePurchaseHistory(sale, filteredSales);
                const multi = formatMultiSaleAmount(buyerSales.filter(isBillableSale).map((s) => s.amount));

                const saleImage = sale.productImageUrl || sale.captureImageUrls?.[0];

                const paymentSummary = getBuyerPaymentSummary(sale.buyerNickname, sale.amount);
                const lastPayment = paymentSummary.paymentList[paymentSummary.paymentList.length - 1];
                const matchedThread = sale.buyerNickname
                  ? buyerToThreadMap.get(sale.buyerNickname.trim().toLowerCase())
                  : undefined;

                return (
                  <Link
                    key={sale.id}
                    to={runtime.path(`/sales/${sale.id}${sessionQuery}`)}
                    className="block p-4 rounded-2xl bg-white border border-slate-200 hover:border-brand-400 transition shadow-sm group"
                    {...appRowPress(() => openSaleMenu(sale))}
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-start space-x-3.5 sm:space-x-4 min-w-0 flex-1">
                        <div
                          className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm relative group/thumb cursor-pointer mt-0.5"
                          onClick={(e) => {
                            if (saleImage) {
                              e.preventDefault();
                              e.stopPropagation();
                              const images = sale.captureImageUrls && sale.captureImageUrls.length > 0
                                ? sale.captureImageUrls
                                : [saleImage];
                              openImageViewer(
                                images,
                                0,
                                `${sale.buyerNickname} 상품/캡처`
                              );
                            }
                          }}
                          title={saleImage ? '클릭하여 원본 크기로 보기' : undefined}
                        >
                          {saleImage ? (
                            <>
                              <img
                                src={saleImage}
                                alt={sale.productName || sale.productCode || '상품'}
                                className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
                              />
                              <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
                                <ZoomIn className="w-4 h-4" />
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-col items-center justify-center text-slate-400 p-1">
                              <ShoppingBag className="w-5 h-5 text-brand-600/70" />
                              <span className="text-[9px] font-mono text-slate-500 font-semibold mt-0.5">
                                {sale.productCode || '상품'}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-2 flex-wrap gap-1.5">
                            <span className="text-base font-bold text-slate-900 group-hover:text-brand-600 transition">
                              {sale.buyerNickname}
                            </span>
                            {multi.isMulti && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold border border-purple-200">
                                ★ 다건 {buyerSales.length}건
                              </span>
                            )}

                            {/* 문자 수신 상태 배지 */}
                            {matchedThread ? (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                                <MessageSquare className="w-2.5 h-2.5 text-emerald-600" />
                                문자 확인 ({matchedThread.messages.length}건)
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200">
                                문자 미수신
                              </span>
                            )}

                            {/* 은행 입금 상태 배지 */}
                            {paymentSummary.status === 'PAID' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-cyan-50 text-cyan-700 border border-cyan-200 flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5 text-cyan-600" />
                                입금완료
                              </span>
                            )}
                            {paymentSummary.status === 'OVERPAID' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5 text-purple-600" />
                                초과입금 (+{paymentSummary.diff.toLocaleString()}원)
                              </span>
                            )}
                            {paymentSummary.status === 'PARTIAL' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5 text-amber-600" />
                                부분입금 ({paymentSummary.totalPaid.toLocaleString()}원)
                              </span>
                            )}
                            {paymentSummary.status === 'UNPAID' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200">
                                입금대기
                              </span>
                            )}

                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                sale.status === '보류'
                                  ? 'bg-amber-400 text-slate-950'
                                  : sale.status === '수동수정'
                                  ? 'bg-purple-100 text-purple-700'
                                  : sale.status === '확정'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-brand-50 text-brand-700'
                              }`}
                            >
                              {sale.status}
                            </span>
                            <AiSaleBadge sale={sale} />
                            {sale.syncStatus === 'PENDING' && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-50 text-amber-700 border border-amber-200"
                                title="아직 서버에 저장되지 않아 이 컴퓨터에만 있는 판매입니다. 합계에는 포함됩니다."
                              >
                                서버 저장 대기
                              </span>
                            )}
                            {needsServerReview(sale) && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-orange-50 text-orange-700 border border-orange-200"
                                title={sale.note}
                              >
                                서버 확인 필요
                              </span>
                            )}
                            <BuyerStatusBadges
                              saleIds={[sale.id]}
                              buyerNickname={sale.buyerNickname}
                              sessionStartTime={sessionStartTime}
                            />
                            <span className="text-[10px] text-slate-700 font-semibold bg-slate-100 px-2 py-0.5 rounded border border-slate-200" title={`방송 회차: ${sale.sessionId}`}>
                              회차: {formatSessionDisplay(sale.sessionId, { sessions: availableSessions, recognizedAt: sale.recognizedAt })}
                            </span>
                          </div>

                          {(sale.productCode || sale.productName) && (
                            <div className="text-[11px] font-semibold text-slate-600 mt-0.5">
                              상품 {sale.productCode || '번호 없음'}{sale.productName ? ` · ${sale.productName}` : ''}
                            </div>
                          )}

                          <p className="text-xs text-slate-600 mt-1 line-clamp-1">
                            "{sale.rawTranscript}"
                          </p>

                          {/* 입금 내역이 있는 경우: 은행/입금자 및 입금액 미리보기 박스 */}
                          {paymentSummary.paymentList.length > 0 && lastPayment && (
                            <div className="mt-2 p-2 rounded-xl bg-cyan-50/70 border border-cyan-100 text-[11px] space-y-1">
                              <div className="flex items-center justify-between text-slate-700 font-semibold">
                                <div className="flex items-center gap-1.5 truncate">
                                  <CreditCard className="w-3 h-3 text-cyan-600 flex-shrink-0" />
                                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${getBankBadgeStyle(lastPayment.bank)}`}>
                                    {lastPayment.bank || '은행'}
                                  </span>
                                  <span className="text-slate-900 font-bold truncate">{lastPayment.payerName}</span>
                                </div>
                                <span className="text-cyan-800 font-extrabold text-[11px] whitespace-nowrap ml-1">
                                  {paymentSummary.totalPaid.toLocaleString()}원 입금
                                </span>
                              </div>
                            </div>
                          )}

                          {/* 수신된 문자가 있는 경우: 전화번호 및 최근 문자 미리보기 박스 */}
                          {matchedThread && (
                            <div className="mt-2 p-2 rounded-xl bg-emerald-50/70 border border-emerald-100 text-[11px] space-y-1">
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
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-baseline sm:items-end justify-between w-full sm:w-auto gap-1 flex-shrink-0">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500">판매 금액</span>
                          {multi.isMulti ? (
                            <div className="flex flex-col items-start sm:items-end">
                              <span className="text-xs font-bold text-brand-600 font-mono">
                                {multi.decimalExpression} =
                              </span>
                              <span className="text-lg font-black text-brand-700">
                                {multi.totalFormatted}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                (현재건: {sale.amount > 0 ? `${sale.amount.toLocaleString()}원 (${formatAmountAsDecimal(sale.amount)})` : '금액 미확인'})
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-start sm:items-end">
                              <div className="text-lg font-black text-brand-600">
                                {sale.amount > 0 ? `${sale.amount.toLocaleString()}원` : '금액 미확인'}
                              </div>
                              {isBillableSale(sale) && sale.amount > 0 && (
                                <span className="text-xs font-bold text-slate-600 mt-0.5">
                                  택비포함 : {(sale.amount + shippingService.calculateShippingFee(
                                    sale.amount,
                                    shippingConfig,
                                    shippingService.getOverride(sale.buyerNickname, sale.sessionId, workspaceId)
                                  ).fee).toLocaleString()}원
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-[11px] text-slate-400 flex items-center space-x-1">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(sale.recognizedAt).toLocaleString('ko-KR')}</span>
                          </div>
                          <AppRowActions
                            onOpen={() => openSaleMenu(sale)}
                            fallback={
                              <button
                                type="button"
                                onClick={(e) => handleDeleteSingleSale(sale, e)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer"
                                title="이 판매 내역 삭제"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )
          )}
        </div>
      </div>

      {/* 실행 취소(Undo) 플로팅 바 */}
      {deletedHistory && (
        <div className="fixed bottom-24 right-4 sm:bottom-6 sm:right-6 z-50 p-3.5 sm:p-4 rounded-2xl bg-slate-900/95 text-white text-xs shadow-2xl border border-slate-700 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-400 flex-shrink-0 animate-pulse" />
            <div>
              <span className="font-bold text-slate-100">{deletedHistory.label}</span>
              <span className="text-slate-400 ml-1">삭제됨</span>
              {deletedHistory.note && <p className="mt-0.5 text-[11px] text-amber-300">{deletedHistory.note}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition-transform active:scale-95 shadow-md cursor-pointer ml-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>실행 취소 ({undoCountdown}초)</span>
          </button>
        </div>
      )}

      {actionToast && !deletedHistory && (
        <div className="fixed bottom-24 right-4 sm:bottom-6 sm:right-6 z-50 p-4 rounded-2xl bg-slate-900/95 text-white text-xs font-bold shadow-xl border border-slate-700 flex items-center space-x-2 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{actionToast}</span>
        </div>
      )}

      <AppSaleMenuSheet target={appMenu} onClose={() => setAppMenu(null)} />

      {viewerModal.isOpen && (
        <ImageViewerModal
          isOpen={viewerModal.isOpen}
          onClose={() => setViewerModal((prev) => ({ ...prev, isOpen: false }))}
          images={viewerModal.images}
          initialIndex={viewerModal.initialIndex}
          titlePrefix={viewerModal.title}
        />
      )}

      <ShippingConfigModal
        isOpen={isShippingModalOpen}
        onClose={() => setIsShippingModalOpen(false)}
        onSaved={() => {
          void refreshSales();
        }}
      />
    </div>

  );
};
