import React from 'react';
import { SaleRecord } from '../../types/live';
import {
  X,
  FileText,
  Clock,
  MessageSquare,
  ShoppingBag,
  Camera,
  History,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface SaleAiEvidenceModalProps {
  sale: SaleRecord;
  onClose: () => void;
}

export const SaleAiEvidenceModal: React.FC<SaleAiEvidenceModalProps> = ({ sale, onClose }) => {
  const snapshot = sale.evidenceSnapshot;
  const history = sale.history || [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 flex flex-col max-h-[90vh]">
        {/* 모달 헤더 */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
                <span>판매 분석 근거 및 이력 기록</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono">
                  Rev #{sale.revision || 1}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                주문 ID: <span className="font-mono">{sale.id}</span> · 구매자:{' '}
                <strong>{sale.buyerNickname}</strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-200 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 모달 본문 (스크롤) */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {/* 1. 원본 발화 및 인식 시각 근거 */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-slate-500 font-bold text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-700">
                <FileText className="w-4 h-4 text-brand-600" />
                <span>🎙️ 원본 전사(STT) 발화 근거</span>
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px]">
                <Clock className="w-3.5 h-3.5" />
                {new Date(sale.recognizedAt).toLocaleString('ko-KR')}
              </span>
            </div>
            <p className="text-xs sm:text-sm font-semibold text-slate-900 bg-white p-3 rounded-xl border border-slate-200/80">
              "{sale.rawTranscript}"
            </p>
            {snapshot?.originalUtterance && snapshot.originalUtterance !== sale.rawTranscript && (
              <p className="text-[11px] text-slate-500">
                근거 스냅샷 발화: "{snapshot.originalUtterance}"
              </p>
            )}
          </div>

          {/* 2. 상품 및 가격 스냅샷 */}
          <div className="p-3.5 rounded-2xl bg-white border border-slate-200 space-y-2">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <ShoppingBag className="w-4 h-4 text-brand-600" />
              <span>판매 당시 상품 및 수량·금액 정보</span>
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[11px]">
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[10px]">상품 번호/명</span>
                <strong className="text-slate-800 truncate block">
                  {sale.productCode ? `#${sale.productCode}` : ''} {sale.productName || '상품'}
                </strong>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[10px]">단가</span>
                <strong className="text-slate-800 font-mono">
                  {(sale.unitPrice || sale.amount).toLocaleString()}원
                </strong>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[10px]">수량</span>
                <strong className="text-slate-800 font-mono">{sale.quantity || 1}개</strong>
              </div>
              <div className="p-2 rounded-xl bg-brand-50 border border-brand-200">
                <span className="text-brand-600 block text-[10px]">총 결제금액</span>
                <strong className="text-brand-700 font-mono font-black">
                  {sale.amount.toLocaleString()}원
                </strong>
              </div>
            </div>
          </div>

          {/* 3. 관련 댓글 및 구매자 정보 */}
          {snapshot?.relevantCommentIds && snapshot.relevantCommentIds.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-cyan-600" />
                <span>대조된 실시간 댓글 ID 목록</span>
              </span>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {snapshot.relevantCommentIds.map((cid, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-mono text-[10px]"
                  >
                    #{cid}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 4. 연결된 화면 캡처 이미지 */}
          {sale.captureImageUrls && sale.captureImageUrls.length > 0 && (
            <div className="space-y-2">
              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-cyan-600" />
                <span>연결된 방송/댓글창 화면 캡처 ({sale.captureImageUrls.length}장)</span>
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {sale.captureImageUrls.map((url, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-video"
                  >
                    <img
                      src={url}
                      alt={`캡처 근거 ${idx + 1}`}
                      className="w-full h-full object-cover hover:scale-105 transition-transform"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. 변경 이력 타임라인 (Revision Diff History) */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <History className="w-4 h-4 text-brand-600" />
              <span>변경 및 정정 이력 타임라인 ({history.length}건)</span>
            </span>

            {history.length === 0 ? (
              <p className="text-slate-400 text-[11px] italic py-2">
                초기 등록 이후 추가 변경 이력이 없습니다.
              </p>
            ) : (
              <div className="space-y-2">
                {history.map((h, index) => {
                  const isCorrection = h.changeType === 'VOICE_CORRECTION';
                  const isRollback = h.changeType === 'CORRECTION_ROLLBACK';
                  const isAi = h.changeType === 'AI_RESOLVE';

                  return (
                    <div
                      key={index}
                      className={`p-3 rounded-2xl border text-[11px] ${
                        isCorrection
                          ? 'bg-purple-50/70 border-purple-200'
                          : isRollback
                          ? 'bg-amber-50/70 border-amber-200'
                          : isAi
                          ? 'bg-brand-50/60 border-brand-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.2 rounded bg-white border text-[10px] font-mono">
                            Rev #{h.revision}
                          </span>
                          <span className="text-slate-900">
                            {isCorrection
                              ? `🎙️ ${h.appliedSlot ? `${h.appliedSlot}번 AI ` : ''}음성 정정`
                              : isRollback
                              ? '↩️ 정정 복원(되돌리기)'
                              : isAi
                              ? `🤖 ${h.appliedSlot ? `${h.appliedSlot}번 AI ` : ''}보류 보완`
                              : h.changeType === 'RULE_RESOLVE'
                              ? '⚡ 규칙 기반 보류 해결'
                              : h.changeType === 'MANUAL_EDIT'
                              ? '✏️ 판매자 수동 수정'
                              : '초기 자동 저장'}
                          </span>
                          {h.failoverAttempted && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-200 text-purple-800">
                              1번 실패 → 2번 처리
                            </span>
                          )}
                        </div>
                        <span className="text-slate-400 font-mono text-[10px]">
                          {new Date(h.changedAt).toLocaleTimeString()}
                        </span>
                      </div>

                      <p className="text-slate-700 font-medium">{h.summary}</p>

                      {/* Before / After Diff */}
                      {(h.before?.amount !== h.after?.amount ||
                        h.before?.buyerNickname !== h.after?.buyerNickname) && (
                        <div className="mt-1.5 p-2 rounded-xl bg-white/80 border border-slate-200/80 flex flex-wrap gap-3 font-mono">
                          {h.before?.buyerNickname !== h.after?.buyerNickname && (
                            <span className="text-slate-800">
                              구매자: <span className="text-rose-600 line-through">{h.before?.buyerNickname}</span> →{' '}
                              <span className="text-emerald-700 font-bold">{h.after?.buyerNickname}</span>
                            </span>
                          )}
                          {h.before?.amount !== h.after?.amount && (
                            <span className="text-slate-800">
                              금액: <span className="text-rose-600 line-through">{(h.before?.amount || 0).toLocaleString()}원</span> →{' '}
                              <span className="text-emerald-700 font-bold">{(h.after?.amount || 0).toLocaleString()}원</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="p-3.5 sm:p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
