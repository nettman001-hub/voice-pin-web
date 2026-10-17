import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Edit3,
  MessageCircleQuestion,
  MessageSquare,
  Save,
  Send,
  Smartphone,
  WalletCards,
  ZoomIn,
  Plus,
  Trash2,
  Settings2,
  Sparkles,
  Clock,
  X,
  RotateCcw,
  Check
} from 'lucide-react';
import { useCommerce } from '../../context/CommerceContext';
import { useSales } from '../../context/SalesContext';
import { CustomerPurchaseClaim, MatchStatus } from '../../types/commerce';
import { SaleRecord } from '../../types/live';
import { productSalesApi } from '../../services/productSalesApi';
import { formatSessionDisplay, SessionInfoLike } from '../../utils/sessionFormatter';
import { cleanMessageBody } from '../../utils/textCleaner';
import { ImageViewerModal } from '../common/ImageViewerModal';
import { BuyerShippingCard } from '../shipping/BuyerShippingCard';
import { calculateBillableAmount } from '../../services/billableSales';
import { ConfirmedBuyerCard } from './ConfirmedBuyerCard';

interface BuyerReconciliationPanelProps {
  buyerNickname: string;
  records: SaleRecord[];
  captureImageUrls: string[];
  availableSessions?: SessionInfoLike[];
  sessionStartTime?: number | null;
  sessionId?: string;
}

export interface QuickSmsTemplate {
  id: string;
  title: string;
  content: string;
}

const QUICK_TEMPLATES_STORAGE_KEY = 'voicecap_quick_sms_templates';

const DEFAULT_QUICK_TEMPLATES: QuickSmsTemplate[] = [
  {
    id: 'tmpl-account',
    title: '계좌 및 입금 안내',
    content: '안녕하세요 {고객명}님! 주문해주신 {상품명} ({금액}원) 입금 계좌 안내드립니다.\n[은행명 000-0000-0000 예금주: OOO]\n입금 후 답장 문자 부탁드립니다. 감사합니다!'
  },
  {
    id: 'tmpl-paid',
    title: '입금 확인 완료',
    content: '{고객명}님, 입금 {금액}원 정상 확인되었습니다!\n상품 정성껏 포장하여 빠른 발송 도와드리겠습니다. 좋은 하루 보내세요!'
  },
  {
    id: 'tmpl-address',
    title: '배송지 주소 요청',
    content: '안녕하세요 {고객명}님! 안전하고 정확한 배송을 위해 받으실 분 성함, 연락처, 도로명 주소를 문자로 남겨주세요. 감사합니다.'
  },
  {
    id: 'tmpl-shipping',
    title: '발송 및 송장 안내',
    content: '{고객명}님, 주문하신 {상품명} 상품이 오늘 발송되었습니다.\n택배사: [택배사명] / 송장번호: [송장번호]\n이용해 주셔서 감사합니다!'
  }
];

const loadQuickTemplates = (): QuickSmsTemplate[] => {
  try {
    const raw = localStorage.getItem(QUICK_TEMPLATES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_QUICK_TEMPLATES;
};

const saveQuickTemplates = (templates: QuickSmsTemplate[]) => {
  try {
    localStorage.setItem(QUICK_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch {}
};

const fillTemplate = (content: string, vars: { buyerNickname: string; productName: string; amount: number }) => {
  return content
    .replace(/\{고객명\}|\[고객명\]/g, vars.buyerNickname || '고객')
    .replace(/\{상품명\}|\[상품명\]/g, vars.productName || '상품')
    .replace(/\{금액\}|\[금액\]/g, (vars.amount || 0).toLocaleString());
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

const matchLabels: Record<MatchStatus, { label: string; className: string }> = {
  NOT_RECEIVED: { label: '문자 미수신', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  MATCHED: { label: '판매·구매 일치', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  MISMATCH: { label: '불일치', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  NEEDS_REVIEW: { label: '확인 필요', className: 'bg-amber-50 text-amber-800 border-amber-200' }
};

const StatusPill: React.FC<{ label: string; className: string }> = ({ label, className }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${className}`}>
    {label}
  </span>
);

export const BuyerStatusBadges: React.FC<{
  saleIds: string[];
  buyerNickname?: string;
  sessionStartTime?: number | null;
}> = ({ saleIds, buyerNickname, sessionStartTime }) => {
  const { sales } = useSales();
  const { getClaimForSales, getMessagesForSales, isPaid, isVerified, messages: allMessages, payments: allPayments } = useCommerce();
  const claim = getClaimForSales(saleIds);

  // 세션 시작 시각 계산 (명시 prop 우선, 없으면 해당 판매건의 시작/기록 시각)
  const effectiveStartTime = useMemo(() => {
    if (sessionStartTime !== undefined) return sessionStartTime;
    if (!saleIds || saleIds.length === 0) return null;
    const relatedSales = sales.filter((s) => saleIds.includes(s.id));
    const times = relatedSales
      .map((s) => (s.recognizedAt ? new Date(s.recognizedAt).getTime() : NaN))
      .filter((t) => !isNaN(t));
    if (times.length > 0) return Math.min(...times);
    return null;
  }, [sessionStartTime, saleIds, sales]);

  const rawMessages = getMessagesForSales(saleIds);
  const messages = useMemo(() => {
    if (!effectiveStartTime) return rawMessages;
    return rawMessages.filter((m) => {
      const t = new Date(m.receivedAt || m.createdAt).getTime();
      return isNaN(t) || t >= effectiveStartTime;
    });
  }, [rawMessages, effectiveStartTime]);

  const outgoing = messages.filter((message) => message.direction === 'OUTGOING');

  const nicknameIncoming = useMemo(() => {
    if (!buyerNickname) return [];
    return allMessages.filter((m) => {
      if (m.direction !== 'INCOMING' || !m.body || !m.body.toLowerCase().includes(buyerNickname.toLowerCase())) {
        return false;
      }
      if (effectiveStartTime) {
        const t = new Date(m.receivedAt || m.createdAt).getTime();
        if (!isNaN(t) && t < effectiveStartTime) return false;
      }
      return true;
    });
  }, [allMessages, buyerNickname, effectiveStartTime]);

  const hasIncoming = messages.some((m) => m.direction === 'INCOMING') || nicknameIncoming.length > 0;

  // 회차 시작 이전의 입금 내역은 배제한 입금 완료 여부 계산
  const isPaidEffective = useMemo(() => {
    if (!saleIds || saleIds.length === 0) return false;
    return allPayments.some((p) => {
      if (p.matchStatus !== 'MATCHED') return false;
      if (!p.saleIds?.some((id) => saleIds.includes(id))) return false;
      if (effectiveStartTime) {
        const t = new Date(p.paidAt || p.createdAt).getTime();
        if (!isNaN(t) && t < effectiveStartTime) return false;
      }
      return true;
    });
  }, [allPayments, saleIds, effectiveStartTime]);

  const isPaidResult = effectiveStartTime ? isPaidEffective : isPaid(saleIds);

  let match = matchLabels[claim?.matchStatus || 'NOT_RECEIVED'];
  if (!claim && hasIncoming) {
    match = {
      label: `문자 수신 (${nicknameIncoming.length || messages.length}건)`,
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-bold'
    };
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusPill label={match.label} className={match.className} />
      {outgoing.length > 0 && (
        <StatusPill
          label={outgoing.some((message) => message.status === 'SENT') ? '문자 발송됨' : '문자 발송 요청'}
          className="bg-cyan-50 text-cyan-700 border-cyan-200"
        />
      )}
      {isVerified(saleIds) && (
        <StatusPill label="확인완료" className="bg-indigo-50 text-indigo-700 border-indigo-200" />
      )}
      <StatusPill
        label={isPaidResult ? '입금완료' : '미입금'}
        className={isPaidResult
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-slate-50 text-slate-500 border-slate-200'}
      />
    </span>
  );
};

const ImageGallery: React.FC<{ urls: string[]; altPrefix: string; emptyText: string }> = ({ urls, altPrefix, emptyText }) => {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  return (
    <>
      {urls.length > 0 ? (
        <div className={`grid gap-2 ${urls.length > 1 ? 'grid-cols-2' : 'mx-auto max-w-md'}`}>
          {urls.map((url, index) => (
            <figure
              key={`${altPrefix}-${index}`}
              onClick={() => setSelectedIdx(index)}
              className="group relative cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition-all hover:border-brand-400 hover:shadow-md"
              title="클릭하여 원본 크기로 보기"
            >
              <div className="relative flex min-h-32 items-center justify-center p-2">
                <img
                  src={url}
                  alt={`${altPrefix} ${index + 1}`}
                  loading="lazy"
                  className="block h-auto max-h-64 w-auto max-w-full rounded-lg object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                />
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/25 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100">
                  <span className="flex items-center gap-1.5 rounded-full bg-slate-900/85 px-3 py-1.5 text-xs font-bold text-white shadow-lg">
                    <ZoomIn className="h-3.5 w-3.5" /> 원본 보기
                  </span>
                </div>
              </div>
              <figcaption className="flex items-center justify-between border-t border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500 group-hover:text-brand-700">
                <span className="font-semibold">이미지 {index + 1}</span>
                <span className="flex items-center gap-1 text-[10px] text-slate-400 group-hover:text-brand-600">
                  <ZoomIn className="h-3 w-3" /> 크게 보기
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-400">
          {emptyText}
        </div>
      )}

      {selectedIdx !== null && (
        <ImageViewerModal
          isOpen={selectedIdx !== null}
          onClose={() => setSelectedIdx(null)}
          images={urls}
          initialIndex={selectedIdx}
          titlePrefix={altPrefix}
        />
      )}
    </>
  );
};

/** 자주 쓰는 문자 템플릿 관리 모달 */
const QuickTemplateManagerModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  templates: QuickSmsTemplate[];
  onSaveTemplates: (next: QuickSmsTemplate[]) => void;
}> = ({ isOpen, onClose, templates, onSaveTemplates }) => {
  const [list, setList] = useState<QuickSmsTemplate[]>(templates);
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id || '');

  useEffect(() => {
    setList(templates);
    if (!selectedId && templates.length > 0) setSelectedId(templates[0].id);
  }, [templates, selectedId]);

  if (!isOpen) return null;

  const current = list.find((t) => t.id === selectedId) || list[0];

  const handleUpdateCurrent = (field: 'title' | 'content', val: string) => {
    if (!current) return;
    setList((prev) =>
      prev.map((t) => (t.id === current.id ? { ...t, [field]: val } : t))
    );
  };

  const handleAdd = () => {
    const newTmpl: QuickSmsTemplate = {
      id: `tmpl-${Date.now()}`,
      title: '새 문자 템플릿',
      content: '안녕하세요 {고객명}님! [문자 내용을 작성해 주세요]'
    };
    const next = [...list, newTmpl];
    setList(next);
    setSelectedId(newTmpl.id);
  };

  const handleDelete = (id: string) => {
    if (list.length <= 1) {
      alert('최소 1개의 템플릿은 유지되어야 합니다.');
      return;
    }
    const next = list.filter((t) => t.id !== id);
    setList(next);
    if (selectedId === id) setSelectedId(next[0].id);
  };

  const handleResetDefaults = () => {
    if (window.confirm('기본 자주 쓰는 문자 템플릿으로 초기화하시겠습니까?')) {
      setList(DEFAULT_QUICK_TEMPLATES);
      setSelectedId(DEFAULT_QUICK_TEMPLATES[0].id);
    }
  };

  const handleSave = () => {
    onSaveTemplates(list);
    saveQuickTemplates(list);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 bg-slate-50">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-brand-600" />
            <h3 className="font-black text-slate-900 text-sm">자주 쓰는 문자(템플릿) 설정·관리</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 divide-x divide-slate-100 overflow-hidden">
          {/* 좌측 템플릿 목록 */}
          <div className="w-48 sm:w-56 flex flex-col bg-slate-50/50 p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-slate-500">템플릿 목록</span>
              <button
                type="button"
                onClick={handleAdd}
                className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100 transition flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> 추가
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {list.map((tmpl) => (
                <div
                  key={tmpl.id}
                  onClick={() => setSelectedId(tmpl.id)}
                  className={`p-2.5 rounded-xl text-xs font-bold cursor-pointer transition flex items-center justify-between gap-1 group ${
                    tmpl.id === current?.id
                      ? 'bg-brand-600 text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="truncate">{tmpl.title || '제목 없음'}</span>
                  {list.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(tmpl.id);
                      }}
                      className={`opacity-0 group-hover:opacity-100 p-1 rounded-md transition ${
                        tmpl.id === current?.id ? 'hover:bg-brand-700 text-white' : 'hover:bg-slate-200 text-slate-400 hover:text-rose-600'
                      }`}
                      title="삭제"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1 justify-center pt-2 border-t border-slate-200"
            >
              <RotateCcw className="w-3 h-3" /> 기본값 복원
            </button>
          </div>

          {/* 우측 템플릿 편집 영역 */}
          {current ? (
            <div className="flex-1 p-4 flex flex-col space-y-3 overflow-y-auto bg-white">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">템플릿 제목 (버튼에 표시)</label>
                <input
                  type="text"
                  value={current.title}
                  onChange={(e) => handleUpdateCurrent('title', e.target.value)}
                  placeholder="예: 계좌 및 입금 안내"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-600">문자 내용 본문</label>
                  <span className="text-[10px] text-slate-400">
                    치환 변수: <code className="bg-slate-100 px-1 py-0.5 rounded text-brand-700 font-mono">&#123;고객명&#125;</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-brand-700 font-mono">&#123;상품명&#125;</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-brand-700 font-mono">&#123;금액&#125;</code>
                  </span>
                </div>
                <textarea
                  value={current.content}
                  onChange={(e) => handleUpdateCurrent('content', e.target.value)}
                  placeholder="문자 발송 시 사용할 내용을 입력하세요..."
                  rows={8}
                  className="w-full flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 resize-none font-sans leading-relaxed"
                />
              </div>

              <div className="p-2.5 rounded-xl bg-amber-50/80 border border-amber-200 text-[11px] text-amber-800 space-y-1">
                <p className="font-bold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" /> 자동 치환 안내
                </p>
                <p className="text-[10px] leading-tight text-amber-700">
                  문자 발송 시 <strong>&#123;고객명&#125;</strong>은 구매자 닉네임으로, <strong>&#123;상품명&#125;</strong>은 판매 상품으로, <strong>&#123;금액&#125;</strong>은 주문 금액으로 자동 변경됩니다.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white rounded-xl shadow-sm transition flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" /> 저장하기
          </button>
        </div>
      </div>
    </div>
  );
};

export const BuyerReconciliationPanel: React.FC<BuyerReconciliationPanelProps> = ({
  buyerNickname,
  records,
  captureImageUrls,
  availableSessions,
  sessionStartTime,
  sessionId,
}) => {
  const [internalSessions, setInternalSessions] = useState<SessionInfoLike[]>([]);

  useEffect(() => {
    if (!availableSessions || availableSessions.length === 0) {
      productSalesApi.listSessions()
        .then((data) => setInternalSessions(data.sessions))
        .catch(() => {});
    }
  }, [availableSessions]);

  const effectiveSessions = (availableSessions && availableSessions.length > 0)
    ? availableSessions
    : internalSessions;

  // 세션 시작 시각 도출 (명시 전달값 -> records의 sessionId 매칭 -> records[0].recognizedAt)
  const effectiveSessionStartTime = useMemo(() => {
    if (sessionStartTime !== undefined) return sessionStartTime;
    const targetSessionId = sessionId || records[0]?.sessionId;
    if (targetSessionId && targetSessionId !== 'ALL') {
      const foundSession = effectiveSessions.find((s) => s.id === targetSessionId);
      if (foundSession?.startedAt) {
        const t = new Date(foundSession.startedAt).getTime();
        if (!isNaN(t)) return t;
      }
    }
    const recordTimes = records
      .map((r) => (r.recognizedAt ? new Date(r.recognizedAt).getTime() : NaN))
      .filter((t) => !isNaN(t));
    if (recordTimes.length > 0) {
      return Math.min(...recordTimes);
    }
    return null;
  }, [sessionStartTime, sessionId, records, effectiveSessions]);

  const {
    bridgeStatus,
    getClaimForSales,
    getMessagesForSales,
    isPaid,
    isVerified,
    setVerified,
    updateClaim,
    sendSms,
    messages: allMessages,
    claims: allClaims,
    invoices: allInvoices,
    shipments: allShipments,
  } = useCommerce();

  const saleIds = useMemo(() => records.map((record) => record.id), [records]);
  const claim = getClaimForSales(saleIds);
  const totalAmount = calculateBillableAmount(records);
  const productNames = Array.from(new Set(records.map((record) => record.productName).filter(Boolean)));
  const primaryProductName = productNames.join(', ') || records[0]?.productName || '상품';

  // 1. 다중 소스 통합: 해당 구매자와 연결된 모든 전화번호 수집
  const matchedPhoneList = useMemo(() => {
    const phones = new Set<string>();
    const addPhone = (p?: string | null) => {
      if (!p) return;
      const norm = normalizePhone(p);
      if (norm && norm.length >= 7) phones.add(norm);
    };

    if (claim?.phoneNumber) addPhone(claim.phoneNumber);

    allClaims.forEach((c) => {
      if (c.nickname?.trim().toLowerCase() === buyerNickname?.trim().toLowerCase()) {
        addPhone(c.phoneNumber);
      }
    });

    allInvoices.forEach((i) => {
      if (i.customerNickname?.trim().toLowerCase() === buyerNickname?.trim().toLowerCase()) {
        addPhone(i.phoneNumber);
      }
    });

    allShipments.forEach((s) => {
      if (s.recipientName?.trim().toLowerCase() === buyerNickname?.trim().toLowerCase()) {
        addPhone(s.phoneNumber);
      }
    });

    try {
      const raw = localStorage.getItem('voicecap_manual_phone_nicknames');
      if (raw) {
        const obj = JSON.parse(raw);
        for (const [phone, nick] of Object.entries(obj)) {
          if (String(nick).trim().toLowerCase() === buyerNickname?.trim().toLowerCase()) {
            addPhone(phone);
          }
        }
      }
    } catch {}

    if (buyerNickname && buyerNickname.length >= 2) {
      const q = buyerNickname.toLowerCase();
      allMessages.forEach((m) => {
        if (effectiveSessionStartTime) {
          const t = new Date(m.receivedAt || m.createdAt).getTime();
          if (!isNaN(t) && t < effectiveSessionStartTime) return;
        }
        if (m.body && m.body.toLowerCase().includes(q)) {
          addPhone(m.phoneNumber);
        }
      });
    }

    return Array.from(phones);
  }, [claim, allClaims, allInvoices, allShipments, allMessages, buyerNickname, effectiveSessionStartTime]);

  // 대표 전화번호 (문자 발송 기본 번호)
  const matchedPhone = useMemo(() => {
    if (claim?.phoneNumber?.trim()) return formatPhone(claim.phoneNumber.trim());
    if (matchedPhoneList.length > 0) return formatPhone(matchedPhoneList[0]);
    return '';
  }, [claim, matchedPhoneList]);

  // 2. 다중 소스 통합: 해당 구매자와 연관된 모든 수발신 문자 메시지 목록
  const relevantMessages = useMemo(() => {
    const set = new Set<string>();
    const list: typeof allMessages = [];

    const add = (m: (typeof allMessages)[0]) => {
      if (!m || set.has(m.id)) return;
      // 선택한 회차 이전에 보내온 문자는 완전히 제외
      if (effectiveSessionStartTime) {
        const t = new Date(m.receivedAt || m.createdAt).getTime();
        if (!isNaN(t) && t < effectiveSessionStartTime) return;
      }
      set.add(m.id);
      list.push(m);
    };

    // 1) saleIds 직접 연결 문자
    const saleMsgs = getMessagesForSales(saleIds);
    saleMsgs.forEach(add);

    // 2) claim.messageId 및 동일 닉네임 claim 문자
    if (claim?.messageId) {
      const m = allMessages.find((msg) => msg.id === claim.messageId);
      if (m) add(m);
    }
    allClaims.forEach((c) => {
      if (c.nickname?.trim().toLowerCase() === buyerNickname?.trim().toLowerCase() && c.messageId) {
        const m = allMessages.find((msg) => msg.id === c.messageId);
        if (m) add(m);
      }
    });

    // 3) 연결된 모든 전화번호 매칭 문자
    const phoneNormSet = new Set(matchedPhoneList);
    if (phoneNormSet.size > 0) {
      allMessages.forEach((m) => {
        if (phoneNormSet.has(normalizePhone(m.phoneNumber))) {
          add(m);
        }
      });
    }

    // 4) 닉네임 키워드가 본문에 포함된 문자
    if (buyerNickname && buyerNickname.length >= 2) {
      const q = buyerNickname.toLowerCase();
      allMessages.forEach((m) => {
        if (m.body && m.body.toLowerCase().includes(q)) {
          add(m);
        }
      });
    }

    // 최신 순 정렬
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allMessages, saleIds, getMessagesForSales, matchedPhoneList, claim, allClaims, buyerNickname, effectiveSessionStartTime]);

  // 해당 고객이 보낸 모든 수신 문자 목록 (최신순)
  const incomingMessages = useMemo(() => {
    return relevantMessages.filter((m) => m.direction === 'INCOMING');
  }, [relevantMessages]);

  const [draft, setDraft] = useState<CustomerPurchaseClaim | null>(claim || null);
  const [questionPhone, setQuestionPhone] = useState(matchedPhone || claim?.phoneNumber || '');
  const [question, setQuestion] = useState('');
  const [feedback, setFeedback] = useState('');
  const [isSending, setIsSending] = useState(false);

  // 자주 쓰는 문자 템플릿 관리 상태
  const [templates, setTemplates] = useState<QuickSmsTemplate[]>(() => loadQuickTemplates());
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  // 전화번호 자동 채우기
  useEffect(() => {
    setDraft(claim ? { ...claim } : null);
    if (matchedPhone) {
      setQuestionPhone(formatPhone(matchedPhone));
    } else if (claim?.phoneNumber) {
      setQuestionPhone(formatPhone(claim.phoneNumber));
    }
  }, [claim, matchedPhone]);

  const handleClaimSave = () => {
    if (!draft) return;
    updateClaim(draft);
    setFeedback('고객 문자 구매정보를 수정하고 다시 대조했습니다.');
    setTimeout(() => setFeedback(''), 3000);
  };

  // 자주 쓰는 템플릿 클릭 시 입력창에 치환 주입
  const handleApplyTemplate = (tmpl: QuickSmsTemplate) => {
    const filled = fillTemplate(tmpl.content, {
      buyerNickname,
      productName: primaryProductName,
      amount: totalAmount,
    });
    setQuestion(filled);
  };

  const handleQuestionSend = async () => {
    if (!questionPhone.trim() || !question.trim()) {
      setFeedback('고객 전화번호와 발송할 내용을 입력해 주세요.');
      return;
    }
    setIsSending(true);
    setFeedback('');
    try {
      const result = await sendSms(questionPhone.trim(), question.trim(), 'QUESTION', saleIds);
      if (result.status === 'FAILED') {
        setFeedback(`발송 요청 실패: ${result.error || '연동 상태를 확인해 주세요.'}`);
      } else {
        setFeedback('voicecapSMS 앱에 문자 발송을 요청했습니다.');
        setQuestion('');
      }
    } catch (e: any) {
      setFeedback(`문자 발송 오류: ${e?.message || '네트워크를 확인해 주세요.'}`);
    } finally {
      setIsSending(false);
      setTimeout(() => setFeedback(''), 4000);
    }
  };

  return (
    <div className="space-y-4">
      {records.filter((record) => record.evidenceSnapshot?.buyerResolution).map((record) => (
        <ConfirmedBuyerCard key={record.id} sale={record} />
      ))}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900">판매·구매정보 대조</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">자동 판매정보와 고객이 보낸 문자를 나란히 확인합니다.</p>
        </div>
        <BuyerStatusBadges saleIds={saleIds} buyerNickname={buyerNickname} sessionStartTime={effectiveSessionStartTime} />
      </div>

      {feedback && (
        <div role="status" className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* ===================== [좌측: 자동 생성 판매정보] ===================== */}
        <section className="rounded-2xl border border-brand-200 bg-brand-50/40 p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-1.5 text-xs font-bold text-brand-800">
              <Camera className="h-4 w-4" /> 자동 생성 판매정보
            </h4>
            {records.length === 1 && (
              <Link to={`/sales/${records[0].id}`} className="flex items-center gap-1 text-[10px] font-bold text-brand-700 hover:underline">
                <Edit3 className="h-3 w-3" /> 수정
              </Link>
            )}
          </div>
          <dl className="mb-3 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-2 text-xs">
            <dt className="text-slate-500">구매자</dt><dd className="font-bold text-slate-900">{buyerNickname}</dd>
            <dt className="text-slate-500">상품</dt><dd className="font-semibold text-slate-800">{productNames.join(', ') || '상품명 미입력'}</dd>
            <dt className="text-slate-500">판매금액</dt><dd className="font-black text-brand-700">{totalAmount.toLocaleString()}원</dd>
            <dt className="text-slate-500">방송회차</dt><dd className="font-semibold text-slate-800">{Array.from(new Set(records.map((record) => formatSessionDisplay(record.sessionId, { sessions: effectiveSessions, recognizedAt: record.recognizedAt })))).join(', ')}</dd>
          </dl>
          <ImageGallery urls={captureImageUrls} altPrefix={`${buyerNickname} 자동 판매 캡처`} emptyText="자동 판매정보에 연결된 캡처 이미지가 없습니다." />
        </section>

        {/* ===================== [우측: 고객 문자 구매정보] ===================== */}
        <section className={`rounded-2xl border p-3 sm:p-4 ${claim?.matchStatus === 'MISMATCH' ? 'border-rose-200 bg-rose-50/40' : 'border-cyan-200 bg-cyan-50/40'}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Smartphone className="h-4 w-4 text-cyan-700" />
              <h4 className="text-xs font-bold text-cyan-900">고객 문자 구매정보</h4>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/customer-messages?search=${encodeURIComponent(buyerNickname)}`}
                className="text-[10px] font-bold text-cyan-700 hover:underline"
              >
                문자함에서 보기 &gt;
              </Link>
              <span className={`h-2 w-2 rounded-full ${bridgeStatus === 'ONLINE' ? 'bg-emerald-500' : 'bg-slate-300'}`} title="voicecapSMS 연동 상태" />
            </div>
          </div>

          {/* ★ 수신된 고객 문자 원문 내용 모두 표시 */}
          {incomingMessages.length > 0 ? (
            <div className="mb-3 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-bold text-cyan-900 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-cyan-600" />
                  고객 수신 문자 원문 ({incomingMessages.length}건)
                </span>
                {incomingMessages.length > 1 && (
                  <span className="text-[10px] text-cyan-700 font-semibold bg-cyan-100/70 px-1.5 py-0.5 rounded">최신순</span>
                )}
              </div>

              <div className={`space-y-2.5 ${incomingMessages.length > 2 ? 'max-h-[380px] overflow-y-auto pr-1' : ''}`}>
                {incomingMessages.map((msg, idx) => {
                  const bodyText = cleanMessageBody(msg.body) || msg.body?.trim();
                  const attachments = msg.attachments || [];
                  return (
                    <div
                      key={msg.id || `inc-msg-${idx}`}
                      className="p-3 rounded-xl bg-white border border-cyan-200 shadow-2xs space-y-2 hover:border-cyan-300 transition"
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold border-b border-slate-100 pb-1.5">
                        <div className="flex items-center gap-1.5 text-cyan-800">
                          <span className="font-bold text-cyan-900">
                            {incomingMessages.length > 1 ? `#${idx + 1}` : '수신 문자'}
                          </span>
                          {idx === 0 && incomingMessages.length > 1 && (
                            <span className="rounded bg-cyan-100 px-1.5 py-0.2 text-[9px] font-bold text-cyan-700">
                              최신
                            </span>
                          )}
                          <span className="text-slate-600 font-semibold text-[11px]">
                            ({formatPhone(msg.phoneNumber)})
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">{formatDateTime(msg.createdAt)}</span>
                      </div>

                      {/* 본문 전체 표시 (줄바꿈 및 긴 내용 온전하게 표시) */}
                      <div className="rounded-lg bg-slate-50/80 p-2.5 text-xs font-medium text-slate-800 leading-relaxed whitespace-pre-wrap break-words border border-slate-100">
                        {bodyText || '(내용 없음 또는 첨부파일)'}
                      </div>

                      {/* 이미지 첨부파일이 있을 경우 */}
                      {attachments.length > 0 && (
                        <div className="pt-1">
                          <ImageGallery
                            urls={attachments.map((a) => a.dataUrl || a.path || '').filter(Boolean)}
                            altPrefix={`${buyerNickname} 수신 문자 이미지`}
                            emptyText=""
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {draft ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-[10px] font-bold text-slate-500">닉네임
                  <input value={draft.nickname} onChange={(event) => setDraft({ ...draft, nickname: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900" />
                </label>
                <label className="text-[10px] font-bold text-slate-500">구매금액
                  <input type="number" value={draft.amount ?? ''} onChange={(event) => setDraft({ ...draft, amount: event.target.value ? Number(event.target.value) : null })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900" />
                </label>
              </div>
              <label className="block text-[10px] font-bold text-slate-500">상품명
                <input value={draft.productName} onChange={(event) => setDraft({ ...draft, productName: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900" />
              </label>
              <label className="block text-[10px] font-bold text-slate-500">배송주소
                <input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900" />
              </label>
              <label className="block text-[10px] font-bold text-slate-500">전화번호
                <input value={draft.phoneNumber} onChange={(event) => setDraft({ ...draft, phoneNumber: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900" />
              </label>
              <ImageGallery urls={draft.captureImageUrls} altPrefix={`${buyerNickname} 고객 문자 캡처`} emptyText="고객 문자에 첨부된 이미지가 없습니다." />
              <button onClick={handleClaimSave} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-cyan-700 px-3 py-2.5 text-xs font-bold text-white hover:bg-cyan-600 transition">
                <Save className="h-3.5 w-3.5" /> 수정정보 저장 후 재대조
              </button>
            </div>
          ) : incomingMessages.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-cyan-200 bg-white/70 p-4 text-center">
              <MessageSquare className="mb-2 h-6 w-6 text-cyan-500" />
              <p className="text-xs font-bold text-slate-700">아직 고객 구매문자가 수신되지 않았습니다.</p>
              <p className="mt-1 text-[10px] text-slate-500">voicecapSMS 앱에서 문자를 전달하면 자동으로 비교합니다.</p>
            </div>
          ) : null}
        </section>
      </div>

      {/* 배송비 & 키핑(보관) 묶음 정산 카드 */}
      <BuyerShippingCard
        buyerNickname={buyerNickname}
        sessionId={records[0]?.sessionId || 'default'}
        sessionCode={records[0]?.sessionId ? formatSessionDisplay(records[0].sessionId, { sessions: effectiveSessions, recognizedAt: records[0].recognizedAt }) : undefined}
        currentSales={records}
      />

      {claim && (

        <div className="grid grid-cols-3 gap-2">
          {([
            ['닉네임', claim.fieldMatches.nickname],
            ['금액', claim.fieldMatches.amount],
            ['캡처', claim.fieldMatches.capture]
          ] as const).map(([label, matched]) => (
            <div key={label} className={`flex items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[10px] font-bold ${matched === true ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : matched === false ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
              {matched === true ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {label} {matched === true ? '일치' : matched === false ? '불일치' : '확인 필요'}
            </div>
          ))}
        </div>
      )}

      {/* ===================== [고객에게 문자 보내기 + 자주 쓰는 문자] ===================== */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <MessageCircleQuestion className="h-4 w-4 text-purple-600" />
            <h4 className="text-xs font-bold text-slate-800">고객에게 문자 보내기</h4>
            {matchedPhone && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                번호 자동 감지됨
              </span>
            )}
          </div>

          {/* 자주 쓰는 문자 관리 버튼 */}
          <button
            type="button"
            onClick={() => setIsTemplateModalOpen(true)}
            className="text-[11px] font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2.5 py-1 rounded-lg transition flex items-center gap-1 self-start sm:self-auto"
          >
            <Settings2 className="w-3.5 h-3.5" />
            자주 쓰는 문자 관리/수정
          </button>
        </div>

        {/* 자주 쓰는 문자 원클릭 버튼 칩들 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap flex items-center gap-1 mr-1">
            <Sparkles className="w-3 h-3 text-purple-500" /> 빠른 템플릿:
          </span>
          {templates.map((tmpl) => (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => handleApplyTemplate(tmpl)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200 text-slate-700 border border-slate-200 transition whitespace-nowrap"
              title="클릭 시 메시지 입력창에 자동 입력됩니다"
            >
              {tmpl.title}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr_auto]">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">
              수신 번호 {matchedPhone && <span className="text-emerald-600 font-bold">✓</span>}
            </label>
            <input
              value={questionPhone}
              onChange={(event) => setQuestionPhone(event.target.value)}
              placeholder="010-0000-0000"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">발송할 문자 내용</label>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={2}
              placeholder="예: 입금 계좌는 OO은행 000-0000-0000 예금주 OOO입니다. (위 빠른 템플릿 클릭 시 자동 입력)"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-purple-500 leading-relaxed font-sans"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleQuestionSend}
              disabled={isSending || !questionPhone.trim() || !question.trim()}
              className="w-full sm:w-auto h-9 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isSending ? '발송 중...' : '문자 발송'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* 상태 및 확인완료 버튼 */}
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1 font-bold text-slate-700">
            <MessageSquare className="h-4 w-4 text-cyan-600" /> 문자 {relevantMessages.length}건
          </span>
          <span className={`flex items-center gap-1 font-bold ${isPaid(saleIds) ? 'text-emerald-700' : 'text-slate-500'}`}>
            <WalletCards className="h-4 w-4" /> {isPaid(saleIds) ? '입금완료' : '미입금'}
          </span>
        </div>
        <button
          onClick={() => setVerified(saleIds, !isVerified(saleIds))}
          className={`rounded-xl border px-4 py-2 text-xs font-bold transition ${isVerified(saleIds) ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-slate-900 text-white'}`}
        >
          {isVerified(saleIds) ? '확인완료 취소' : '판매자 확인완료'}
        </button>
      </div>

      {/* ===================== [문자 수발신 내역] ===================== */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-slate-800">
            문자 수발신 내역 ({relevantMessages.length}건)
          </h4>
          <span className="text-[10px] text-slate-400">
            고객과 주고받은 모든 SMS/MMS 내역입니다
          </span>
        </div>

        {relevantMessages.length === 0 ? (
          <p className="rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-400">
            연결된 문자 내역이 아직 없습니다.
          </p>
        ) : (
          <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
            {relevantMessages.map((message) => {
              const isOutgoing = message.direction === 'OUTGOING';
              const cleaned = cleanMessageBody(message.body);

              return (
                <div key={message.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-2xs ${
                    isOutgoing ? 'bg-brand-600 text-white rounded-br-none' : 'border border-slate-200 bg-slate-50 text-slate-800 rounded-bl-none'
                  }`}>
                    <div className={`mb-1 flex items-center gap-2 text-[10px] ${isOutgoing ? 'text-brand-100' : 'text-slate-400'}`}>
                      <span className="font-bold">{isOutgoing ? '발신 (판매자)' : '수신 (고객)'}</span>
                      <span>·</span>
                      <span>{formatPhone(message.phoneNumber)}</span>
                      <span>·</span>
                      <span>{message.status === 'FAILED' ? '실패' : message.status === 'SENT' ? '발송완료' : message.status === 'QUEUED' ? '발송대기' : '수신완료'}</span>
                    </div>

                    <p className="whitespace-pre-wrap break-words leading-relaxed text-xs font-sans">
                      {cleaned || '(내용 없음)'}
                    </p>

                    {/* 첨부 이미지 */}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        {message.attachments.map((att) => (
                          <img
                            key={att.id}
                            src={att.dataUrl || att.path}
                            alt={att.fileName || '첨부 이미지'}
                            className="h-20 w-full object-cover rounded-lg border border-black/10"
                          />
                        ))}
                      </div>
                    )}

                    <time className={`mt-1.5 block text-[9px] ${isOutgoing ? 'text-brand-200' : 'text-slate-400'}`}>
                      {formatDateTime(message.createdAt)}
                    </time>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 자주 쓰는 문자 템플릿 관리 모달 */}
      <QuickTemplateManagerModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        templates={templates}
        onSaveTemplates={(next) => setTemplates(next)}
      />
    </div>
  );
};
