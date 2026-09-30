import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { useLive } from '../../context/LiveContext';
import { SaleRecord } from '../../types/live';
import { SaleAiActionButtons } from '../../components/sales/SaleAiActionButtons';
import { AiSaleBadge } from '../../components/sales/AiSaleBadge';
import {
  CheckSquare,
  AlertCircle,
  Save,
  Trash2,
  Camera,
  CheckCircle2,
  ArrowLeft,
  Sparkles
} from 'lucide-react';
import { productSalesApi } from '../../services/productSalesApi';
import { LiveSession } from '../../types/productSales';
import { formatSessionDisplay } from '../../utils/sessionFormatter';

export const SalesReviewPage: React.FC = () => {
  const { sales, confirmBatchSales, updateSale, deleteSale } = useSales();
  const { currentSessionId } = useLive();
  const navigate = useNavigate();

  const [cloudSessions, setCloudSessions] = useState<LiveSession[]>([]);
  const [sessionFilter, setSessionFilter] = useState<string>(currentSessionId);

  useEffect(() => {
    productSalesApi.listSessions()
      .then((data) => setCloudSessions(data.sessions))
      .catch((err) => console.warn('[SalesReview] 세션 목록 로드 실패 (무시):', err));
  }, []);
  const [editingRecords, setEditingRecords] = useState<{ [id: string]: { nickname: string; amount: string } }>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const availableSessions = Array.from(new Set(sales.map((s) => s.sessionId))).filter(Boolean);

  const targetSales = sessionFilter === 'ALL'
    ? sales
    : sales.filter((s) => s.sessionId === sessionFilter);

  const pendingSales = targetSales.filter((s) => s.status === '보류');
  const pendingCount = pendingSales.length;

  const handleInputChange = (id: string, field: 'nickname' | 'amount', value: string) => {
    setEditingRecords((prev) => ({
      ...prev,
      [id]: {
        nickname: field === 'nickname' ? value : (prev[id]?.nickname ?? sales.find((s) => s.id === id)?.buyerNickname ?? ''),
        amount: field === 'amount' ? value : (prev[id]?.amount ?? sales.find((s) => s.id === id)?.amount.toString() ?? '0')
      }
    }));
  };

  const handleSaveRow = (sale: SaleRecord) => {
    if (sale.syncStatus === 'PENDING') {
      setToastMsg('서버 저장 확인 후 수정할 수 있습니다.');
      return;
    }
    const edit = editingRecords[sale.id];
    if (!edit) return;

    updateSale({
      ...sale,
      buyerNickname: edit.nickname || sale.buyerNickname,
      amount: parseInt(edit.amount, 10) || sale.amount,
      status: '수동수정'
    });

    setToastMsg(`'${edit.nickname || sale.buyerNickname}'님의 주문이 수정 및 확정되었습니다.`);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handleBulkConfirm = () => {
    const pendingIds = pendingSales.map((s) => s.id);
    const result = confirmBatchSales(pendingIds);
    if (result.skippedCount > 0) {
      setToastMsg(`총 ${result.confirmedCount}건 일괄 확정 완료! (미확인 정보 잔여 ${result.skippedCount}건은 안전을 위해 보류 유지)`);
    } else {
      setToastMsg(`보류 ${result.confirmedCount}건이 모두 검증 통과하여 일괄 확정되었습니다! 🎉`);
    }
    setTimeout(() => setToastMsg(null), 3500);
  };

  return (
    <div className="p-2.5 sm:p-4 max-w-7xl mx-auto space-y-2.5 sm:space-y-3">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-sm sm:text-base font-black text-slate-900 tracking-tight">방송 후 일괄 확인</h1>
            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
              보류 {pendingCount}건
            </span>
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">
            방송 중 닉네임이나 금액이 불분명했던 '보류' 건을 확인하고 인라인으로 즉시 수정/일괄 확정합니다.
          </p>
        </div>

        <div className="w-full sm:w-auto">
          <button
            onClick={handleBulkConfirm}
            disabled={pendingCount === 0}
            className="w-full sm:w-auto h-8 px-3 rounded-lg bg-gradient-to-r from-brand-600 to-emerald-600 hover:from-brand-500 hover:to-emerald-500 disabled:opacity-40 text-white text-xs font-bold shadow-xs flex items-center justify-center space-x-1 transition active:scale-95"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>남은 보류 건 일괄 확정</span>
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className="p-2.5 sm:p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 회차 선택 탭 (모바일 가로 스크롤) */}
      <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-0.5 text-xs">
        <span className="text-slate-500 font-bold px-1 flex-shrink-0 text-[11px]">방송 회차:</span>
        <button
          onClick={() => setSessionFilter('ALL')}
          className={`px-2.5 py-1 rounded-lg font-bold transition flex-shrink-0 text-xs ${
            sessionFilter === 'ALL'
              ? 'bg-brand-600 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
          }`}
        >
          전체 회차
        </button>
        {availableSessions.map((s) => {
          const firstSale = sales.find((x) => x.sessionId === s);
          const label = formatSessionDisplay(s, {
            sessions: cloudSessions,
            recognizedAt: firstSale?.recognizedAt
          });
          return (
            <button
              key={s}
              onClick={() => setSessionFilter(s)}
              className={`px-2.5 py-1 rounded-lg font-bold transition flex-shrink-0 text-xs ${
                sessionFilter === s
                  ? 'bg-brand-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
              }`}
              title={`회차 ID: ${s}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* 테이블 형태의 일괄 검토 뷰 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm space-y-2">
        {targetSales.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400">
            해당 회차에 검토할 판매 내역이 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {targetSales.map((sale) => {
              const edit = editingRecords[sale.id];
              const curNickname = edit?.nickname ?? sale.buyerNickname;
              const curAmount = edit?.amount ?? sale.amount.toString();
              const isPending = sale.status === '보류';

              return (
                <div
                  key={sale.id}
                  className={`p-3.5 sm:p-4 rounded-2xl border transition flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 sm:gap-4 ${
                    isPending
                      ? 'bg-amber-50/70 border-amber-300 shadow-sm'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex-1 space-y-1.5 w-full">
                    <div className="flex items-center space-x-2 flex-wrap gap-1">
                      <span
                        className={`text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isPending ? 'bg-amber-400 text-slate-950 font-black' : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {sale.status}
                      </span>
                      <AiSaleBadge sale={sale} />
                      <span className="text-[11px] sm:text-xs text-slate-400 font-mono">
                        {new Date(sale.recognizedAt).toLocaleTimeString('ko-KR')}
                      </span>
                      <span className="text-[10px] text-slate-700 font-bold bg-white px-2 py-0.5 rounded-full border border-slate-200" title={`회차 ID: ${sale.sessionId}`}>
                        {formatSessionDisplay(sale.sessionId, { sessions: cloudSessions, recognizedAt: sale.recognizedAt })}
                      </span>
                    </div>

                    <p className="text-xs text-slate-800 font-medium break-words">
                      "{sale.rawTranscript}"
                    </p>

                    {/* 구조화된 보류 사유 배지 */}
                    {isPending && sale.pendingReasons && sale.pendingReasons.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {sale.pendingReasons.map((r, idx) => (
                          <span
                            key={idx}
                            className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${
                              r.resolved
                                ? 'bg-emerald-100 text-emerald-800 line-through opacity-60'
                                : 'bg-rose-100 text-rose-800 border border-rose-200'
                            }`}
                            title={r.message}
                          >
                            {r.code === 'MISSING_NICKNAME' && '👤 닉네임 미확인'}
                            {r.code === 'TRAILING_DIGITS_ONLY' && '🔢 끝번호만 인식'}
                            {r.code === 'MISSING_AMOUNT' && '💰 금액 누락'}
                            {r.code === 'SPLIT_UTTERANCE' && '✂️ 분리 발화'}
                            {r.code === 'DELAYED_COMMENT' && '⏳ 댓글 대기'}
                            {r.code === 'MULTIPLE_CANDIDATES_CONFLICT' && '⚠️ 복수 후보 충돌'}
                            {r.resolved && ' (해결됨)'}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* AI 작업 이력 배지, Diff 및 근거보기/후보적용/되돌리기 액션 */}
                    <div className="pt-2">
                      <SaleAiActionButtons sale={sale} />
                    </div>
                  </div>

                  {/* 인라인 수정 인풋들 (모바일 반응형 flex) */}
                  <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto border-t lg:border-t-0 border-slate-200/60 pt-2 lg:pt-0">
                    <input
                      type="text"
                      value={curNickname}
                      onChange={(e) => handleInputChange(sale.id, 'nickname', e.target.value)}
                      placeholder="닉네임"
                      className="flex-1 sm:w-28 min-w-[100px] px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-bold"
                    />

                    <div className="relative flex-1 sm:w-28 min-w-[100px]">
                      <input
                        type="number"
                        value={curAmount}
                        onChange={(e) => handleInputChange(sale.id, 'amount', e.target.value)}
                        placeholder="금액"
                        className="w-full pl-3 pr-6 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-bold"
                      />
                      <span className="text-[10px] text-slate-400 absolute right-2 top-2.5">원</span>
                    </div>

                    {sale.captureImageUrls && sale.captureImageUrls.length > 0 && (
                      <Link
                        to={`/sales/${sale.id}/capture`}
                        className="p-2 rounded-xl bg-white border border-slate-200 text-cyan-600 hover:bg-slate-50 active:scale-95"
                        title="캡처 이미지 보기"
                      >
                        <Camera className="w-4 h-4" />
                      </Link>
                    )}

                    <button
                      onClick={() => handleSaveRow(sale)}
                      className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-sm flex items-center space-x-1 active:scale-95"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>저장</span>
                    </button>

                    <button
                      onClick={() => deleteSale(sale.id)}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:scale-95"
                      title="삭제"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
