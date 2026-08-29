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
  WalletCards
} from 'lucide-react';
import { useCommerce } from '../../context/CommerceContext';
import { CustomerPurchaseClaim, MatchStatus } from '../../types/commerce';
import { SaleRecord } from '../../types/live';

interface BuyerReconciliationPanelProps {
  buyerNickname: string;
  records: SaleRecord[];
  captureImageUrls: string[];
}

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

export const BuyerStatusBadges: React.FC<{ saleIds: string[] }> = ({ saleIds }) => {
  const { getClaimForSales, getMessagesForSales, isPaid, isVerified } = useCommerce();
  const claim = getClaimForSales(saleIds);
  const messages = getMessagesForSales(saleIds);
  const outgoing = messages.filter((message) => message.direction === 'OUTGOING');
  const match = matchLabels[claim?.matchStatus || 'NOT_RECEIVED'];

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
        label={isPaid(saleIds) ? '입금완료' : '미입금'}
        className={isPaid(saleIds)
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-slate-50 text-slate-500 border-slate-200'}
      />
    </span>
  );
};

const ImageGallery: React.FC<{ urls: string[]; altPrefix: string; emptyText: string }> = ({ urls, altPrefix, emptyText }) => (
  urls.length > 0 ? (
    <div className={`grid gap-2 ${urls.length > 1 ? 'grid-cols-2' : 'mx-auto max-w-md'}`}>
      {urls.map((url, index) => (
        <figure key={`${altPrefix}-${index}`} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
          <div className="flex min-h-32 items-center justify-center p-2">
            <img
              src={url}
              alt={`${altPrefix} ${index + 1}`}
              loading="lazy"
              className="block h-auto max-h-64 w-auto max-w-full rounded-lg object-contain"
            />
          </div>
          {urls.length > 1 && (
            <figcaption className="border-t border-slate-200 bg-white px-2 py-1 text-center text-[10px] text-slate-500">
              이미지 {index + 1}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  ) : (
    <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-400">
      {emptyText}
    </div>
  )
);

export const BuyerReconciliationPanel: React.FC<BuyerReconciliationPanelProps> = ({
  buyerNickname,
  records,
  captureImageUrls
}) => {
  const {
    bridgeStatus,
    getClaimForSales,
    getMessagesForSales,
    isPaid,
    isVerified,
    setVerified,
    updateClaim,
    sendSms
  } = useCommerce();
  const saleIds = useMemo(() => records.map((record) => record.id), [records]);
  const claim = getClaimForSales(saleIds);
  const messages = getMessagesForSales(saleIds);
  const totalAmount = records.reduce((sum, record) => sum + (record.amount || 0), 0);
  const productNames = Array.from(new Set(records.map((record) => record.productName).filter(Boolean)));
  const [draft, setDraft] = useState<CustomerPurchaseClaim | null>(claim || null);
  const [questionPhone, setQuestionPhone] = useState(claim?.phoneNumber || '');
  const [question, setQuestion] = useState('구매정보를 다시 확인해 주세요. 닉네임, 상품명, 금액, 배송주소를 회신 부탁드립니다.');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setDraft(claim ? { ...claim } : null);
    setQuestionPhone(claim?.phoneNumber || '');
  }, [claim]);

  const handleClaimSave = () => {
    if (!draft) return;
    updateClaim(draft);
    setFeedback('고객 문자 구매정보를 수정하고 다시 대조했습니다.');
  };

  const handleQuestionSend = async () => {
    if (!questionPhone.trim() || !question.trim()) {
      setFeedback('고객 전화번호와 질문 내용을 입력해 주세요.');
      return;
    }
    const result = await sendSms(questionPhone.trim(), question.trim(), 'QUESTION', saleIds);
    setFeedback(result.status === 'FAILED' ? `발송 요청 실패: ${result.error || '연동 상태를 확인해 주세요.'}` : 'voicecapSMS 앱에 문자 발송을 요청했습니다.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900">판매·구매정보 대조</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">자동 판매정보와 고객이 보낸 문자를 나란히 확인합니다.</p>
        </div>
        <BuyerStatusBadges saleIds={saleIds} />
      </div>

      {feedback && (
        <div role="status" className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
            <dt className="text-slate-500">방송회차</dt><dd className="font-mono text-slate-700">{Array.from(new Set(records.map((record) => record.sessionId))).join(', ')}</dd>
          </dl>
          <ImageGallery urls={captureImageUrls} altPrefix={`${buyerNickname} 자동 판매 캡처`} emptyText="자동 판매정보에 연결된 캡처 이미지가 없습니다." />
        </section>

        <section className={`rounded-2xl border p-3 sm:p-4 ${claim?.matchStatus === 'MISMATCH' ? 'border-rose-200 bg-rose-50/40' : 'border-cyan-200 bg-cyan-50/40'}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-1.5 text-xs font-bold text-cyan-900">
              <Smartphone className="h-4 w-4" /> 고객 문자 구매정보
            </h4>
            <span className={`h-2 w-2 rounded-full ${bridgeStatus === 'ONLINE' ? 'bg-emerald-500' : 'bg-slate-300'}`} title="voicecapSMS 연동 상태" />
          </div>

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
              <button onClick={handleClaimSave} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-cyan-700 px-3 py-2.5 text-xs font-bold text-white hover:bg-cyan-600">
                <Save className="h-3.5 w-3.5" /> 수정정보 저장 후 재대조
              </button>
            </div>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-cyan-200 bg-white/70 p-4 text-center">
              <MessageSquare className="mb-2 h-6 w-6 text-cyan-500" />
              <p className="text-xs font-bold text-slate-700">아직 고객 구매문자가 수신되지 않았습니다.</p>
              <p className="mt-1 text-[10px] text-slate-500">voicecapSMS 앱에서 문자를 전달하면 자동으로 비교합니다.</p>
            </div>
          )}
        </section>
      </div>

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

      <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800">
          <MessageCircleQuestion className="h-4 w-4 text-purple-600" /> 고객에게 문자로 질문
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_1fr_auto]">
          <input value={questionPhone} onChange={(event) => setQuestionPhone(event.target.value)} placeholder="010-0000-0000" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs" />
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} className="resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs" />
          <button onClick={handleQuestionSend} className="flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-500">
            <Send className="h-3.5 w-3.5" /> 질문 발송
          </button>
        </div>
      </section>

      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1 font-bold text-slate-700"><MessageSquare className="h-4 w-4 text-cyan-600" /> 문자 {messages.length}건</span>
          <span className={`flex items-center gap-1 font-bold ${isPaid(saleIds) ? 'text-emerald-700' : 'text-slate-500'}`}><WalletCards className="h-4 w-4" /> {isPaid(saleIds) ? '입금완료' : '미입금'}</span>
        </div>
        <button
          onClick={() => setVerified(saleIds, !isVerified(saleIds))}
          className={`rounded-xl border px-4 py-2 text-xs font-bold ${isVerified(saleIds) ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-slate-900 text-white'}`}
        >
          {isVerified(saleIds) ? '확인완료 취소' : '판매자 확인완료'}
        </button>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
        <h4 className="mb-3 text-xs font-bold text-slate-800">문자 수발신 내역 ({messages.length}건)</h4>
        {messages.length === 0 ? (
          <p className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-400">연결된 문자 내역이 없습니다.</p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.direction === 'OUTGOING' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs ${message.direction === 'OUTGOING' ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-slate-50 text-slate-700'}`}>
                  <div className="mb-1 flex items-center gap-2 text-[10px] opacity-75">
                    <span>{message.direction === 'OUTGOING' ? '발신' : '수신'} · {message.phoneNumber}</span>
                    <span>{message.status === 'FAILED' ? '실패' : message.status === 'SENT' ? '발송완료' : message.status === 'QUEUED' ? '발송대기' : '수신완료'}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <time className="mt-1 block text-[9px] opacity-60">{new Date(message.createdAt).toLocaleString('ko-KR')}</time>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

