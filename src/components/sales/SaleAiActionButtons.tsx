import React, { useState, useMemo } from 'react';
import { SaleRecord } from '../../types/live';
import { SaleAiEvidenceModal } from './SaleAiEvidenceModal';
import { useSales } from '../../context/SalesContext';
import { aiSettingsApi } from '../../services/aiSettingsApi';
import { rollbackCorrection } from '../../services/voiceCorrectionService';
import {
  FileText,
  CheckCircle2,
  Undo2,
  Sparkles,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

interface SaleAiActionButtonsProps {
  sale: SaleRecord;
  className?: string;
  onRefresh?: () => void;
}

export const SaleAiActionButtons: React.FC<SaleAiActionButtonsProps> = ({
  sale,
  className = '',
  onRefresh,
}) => {
  const { updateSale } = useSales();
  const [showEvidenceModal, setShowEvidenceModal] = useState<boolean>(false);
  const [isApplyingCandidate, setIsApplyingCandidate] = useState<boolean>(false);
  const [isRollingBack, setIsRollingBack] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 최신 변경 이력 가져오기
  const latestHistory = useMemo(() => {
    if (!sale.history || sale.history.length === 0) return null;
    return sale.history[sale.history.length - 1];
  }, [sale.history]);

  // AI 상태 텍스트 및 배지 판정 (PLAN.md 6번 명세 준수)
  const aiBadge = useMemo(() => {
    const aiStatus = sale.aiVerification?.aiStatus;
    const history = sale.history || [];
    const latestCorrection = [...history].reverse().find((h) => h.changeType === 'VOICE_CORRECTION');
    const latestAiResolve = [...history].reverse().find((h) => h.changeType === 'AI_RESOLVE');

    // 1. AI 확인 중
    if (aiStatus === 'CHECKING') {
      return {
        text: 'AI 확인 중',
        className: 'bg-sky-100 text-sky-800 border border-sky-300 animate-pulse',
      };
    }

    // 2. 판매자 확인 필요
    if (aiStatus === 'NEEDS_SELLER_CONFIRM') {
      return {
        text: '판매자 확인 필요',
        className: 'bg-rose-100 text-rose-800 border border-rose-300 font-bold',
      };
    }

    // 3. 1번 실패 -> 2번 처리
    if (
      latestCorrection?.failoverAttempted ||
      latestAiResolve?.failoverAttempted ||
      (latestCorrection?.appliedSlot === 2 && latestCorrection.switchReason) ||
      (latestAiResolve?.appliedSlot === 2 && latestAiResolve.switchReason)
    ) {
      return {
        text: '1번 실패 → 2번 처리',
        className: 'bg-purple-100 text-purple-800 border border-purple-300 font-bold',
      };
    }

    // 4. 2번 AI 정정
    if (latestCorrection?.appliedSlot === 2) {
      return {
        text: '2번 AI 정정',
        className: 'bg-purple-100 text-purple-800 border border-purple-300',
      };
    }

    // 5. 1번 AI 정정
    if (latestCorrection?.appliedSlot === 1) {
      return {
        text: '1번 AI 정정',
        className: 'bg-indigo-100 text-indigo-800 border border-indigo-300',
      };
    }

    // 6. 1번 AI 보완 / 2번 AI 보완
    if (latestAiResolve?.appliedSlot === 1) {
      return {
        text: '1번 AI 보완',
        className: 'bg-cyan-100 text-cyan-800 border border-cyan-300',
      };
    }
    if (latestAiResolve?.appliedSlot === 2) {
      return {
        text: '2번 AI 보완',
        className: 'bg-purple-100 text-purple-800 border border-purple-300',
      };
    }

    // 7. 일반 AI 보완 완료
    if (latestAiResolve) {
      return {
        text: 'AI 보완 완료',
        className: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
      };
    }

    return null;
  }, [sale]);

  // 후보 추천 정보 확인
  const candidate = sale.aiVerification?.candidateBuyer;
  const candidateAmount = sale.aiVerification?.candidateAmount;
  const hasCandidate = Boolean(candidate || candidateAmount);

  // 되돌리기(롤백) 가능 여부 확인: 이전 정정 이력이 존재하는지
  const canRollback = useMemo(() => {
    if (!sale.history) return false;
    return sale.history.some((h) => h.changeType === 'VOICE_CORRECTION');
  }, [sale.history]);

  // 1. 후보 적용 클릭 핸들러
  const handleApplyCandidate = async () => {
    setIsApplyingCandidate(true);
    setErrorMsg(null);
    try {
      const newNickname = candidate?.nickname || sale.buyerNickname;
      const newAmount = candidateAmount || sale.amount;

      // 낙관적 revision 증가 및 서버 확정
      const updated: SaleRecord = {
        ...sale,
        buyerNickname: newNickname,
        buyerId: candidate?.buyerId || sale.buyerId,
        amount: newAmount,
        status: '확정',
        revision: (sale.revision || 1) + 1,
        aiVerification: {
          ...sale.aiVerification,
          aiStatus: 'RESOLVED',
          resolutionSummary: `후보 (${newNickname}, ${newAmount.toLocaleString()}원) 판매자 직접 승인 적용`,
          validatedAt: new Date().toISOString(),
        },
        history: [
          ...(sale.history || []),
          {
            revision: (sale.revision || 1) + 1,
            changedAt: new Date().toISOString(),
            changedBy: 'SELLER',
            changeType: 'MANUAL_EDIT',
            before: { buyerNickname: sale.buyerNickname, amount: sale.amount, status: sale.status },
            after: { buyerNickname: newNickname, amount: newAmount, status: '확정' },
            summary: `판매자가 추천 후보 '${newNickname}' 및 금액 '${newAmount.toLocaleString()}원'을 직접 선택 적용함.`,
          },
        ],
      };

      updateSale(updated);
      onRefresh?.();
    } catch (err: any) {
      setErrorMsg(err?.message || '후보 적용에 실패했습니다.');
    } finally {
      setIsApplyingCandidate(false);
    }
  };

  // 2. 되돌리기(Rollback) 클릭 핸들러
  const handleRollback = async () => {
    if (!window.confirm('정말로 최근 음성 정정 내용을 이전 상태로 되돌리시겠습니까?')) {
      return;
    }

    setIsRollingBack(true);
    setErrorMsg(null);
    try {
      // 로컬/서비스 롤백 검증 함수 실행
      const result = rollbackCorrection(sale);
      if (!result.success) {
        setErrorMsg(result.conflictReason || '이미 결제나 출고가 진행되어 자동 복원할 수 없습니다.');
        return;
      }

      if (result.rolledBackSale) {
        updateSale(result.rolledBackSale);
        onRefresh?.();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '되돌리기 처리에 실패했습니다.');
    } finally {
      setIsRollingBack(false);
    }
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {/* 상태 배지 및 전후 값 Diff */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {aiBadge && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${aiBadge.className}`}>
            {aiBadge.text}
          </span>
        )}

        {/* Diff 표시: 예: 금액 9,000원 → 12,000원 / 구매자 xxx → ooo */}
        {latestHistory && (latestHistory.before?.amount !== latestHistory.after?.amount || latestHistory.before?.buyerNickname !== latestHistory.after?.buyerNickname) && (
          <span className="text-[10px] text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200 font-mono">
            {latestHistory.before?.buyerNickname !== latestHistory.after?.buyerNickname && (
              <span>{latestHistory.before?.buyerNickname} → <strong>{latestHistory.after?.buyerNickname}</strong> </span>
            )}
            {latestHistory.before?.amount !== latestHistory.after?.amount && (
              <span>{(latestHistory.before?.amount || 0).toLocaleString()}원 → <strong>{(latestHistory.after?.amount || 0).toLocaleString()}원</strong></span>
            )}
          </span>
        )}
      </div>

      {errorMsg && (
        <span className="text-[10px] text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
          ⚠️ {errorMsg}
        </span>
      )}

      {/* 핵심 액션 3종 버튼: 근거 보기, 후보 적용, 되돌리기 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* 1. 근거 보기 버튼 */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowEvidenceModal(true);
          }}
          className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold rounded-lg border border-slate-200 shadow-2xs flex items-center gap-1 transition active:scale-95"
          title="발화 원본, 관련 댓글, 상품 스냅샷 및 전체 변경 이력 확인"
        >
          <FileText className="w-3 h-3 text-brand-600" />
          <span>근거 보기</span>
        </button>

        {/* 2. 후보 적용 버튼 (후보가 있을 경우) */}
        {hasCandidate && sale.status === '보류' && (
          <button
            type="button"
            disabled={isApplyingCandidate}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleApplyCandidate();
            }}
            className="px-2.5 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 text-[11px] font-bold rounded-lg border border-brand-300 shadow-2xs flex items-center gap-1 transition active:scale-95 disabled:opacity-50"
            title={`추천 후보 적용: ${candidate?.nickname || ''} ${candidateAmount ? `${candidateAmount.toLocaleString()}원` : ''}`}
          >
            <CheckCircle2 className="w-3 h-3 text-brand-600" />
            <span>후보 적용</span>
          </button>
        )}

        {/* 3. 되돌리기 버튼 (정정 이력이 있을 경우) */}
        {canRollback && (
          <button
            type="button"
            disabled={isRollingBack}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleRollback();
            }}
            className="px-2 py-1 bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800 text-[11px] font-bold rounded-lg border border-slate-200 hover:border-amber-300 shadow-2xs flex items-center gap-1 transition active:scale-95 disabled:opacity-50"
            title="최근 음성 정정 내용을 이전 상태로 되돌립니다."
          >
            <Undo2 className="w-3 h-3" />
            <span>되돌리기</span>
          </button>
        )}
      </div>

      {/* 근거 보기 모달 */}
      {showEvidenceModal && (
        <SaleAiEvidenceModal sale={sale} onClose={() => setShowEvidenceModal(false)} />
      )}
    </div>
  );
};
