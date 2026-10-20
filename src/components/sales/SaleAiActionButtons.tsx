import { useWorkspaceRuntime, useRuntimeAuth as useAuth } from '../../context/WorkspaceRuntimeContext';
import React, { useState, useMemo } from 'react';
import { SaleRecord } from '../../types/live';
import { SaleAiEvidenceModal } from './SaleAiEvidenceModal';
import { useSaleAiConversationWindow } from './SaleAiConversationWindow';
import { useSales } from '../../context/SalesContext';
import { useLive } from '../../context/LiveContext';

import { useOptionalCommentCapture } from '../../context/CommentCaptureContext';

import { rollbackCorrection } from '../../services/voiceCorrectionService';
import { confirmedAiRecoveryBaseline } from '../../services/confirmedVoiceSaleRecovery';
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
  hideEvidence?: boolean;
}

export const SaleAiActionButtons: React.FC<SaleAiActionButtonsProps> = ({
  sale,
  className = '',
  onRefresh,
  hideEvidence = false,
}) => {
  const runtime = useWorkspaceRuntime();
  const { storageService, aiSettingsApi, flushPendingComments } = runtime;
  const { updateSale, refreshSales } = useSales();
  const { syncCurrentTranscriptsToCloud } = useLive();
  const { workspaceId } = useAuth();
  const commentCapture = useOptionalCommentCapture();
  const { openConversation } = useSaleAiConversationWindow();
  const [showEvidenceModal, setShowEvidenceModal] = useState<boolean>(false);
  const [isApplyingCandidate, setIsApplyingCandidate] = useState<boolean>(false);
  const [isRollingBack, setIsRollingBack] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState<string | null>(null);

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
    if (sale.aiVerification?.reviewMode === 'TEXT_PROMPT_RECOVERY' && aiStatus === 'RESOLVED') return {
      text: '원본 근거 정정 완료', className: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
    };

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

    if (aiStatus === 'INSUFFICIENT_DATA') return {
      text: sale.aiVerification?.errorMessage ? 'AI 검토 실패 · 재시도 가능' : 'AI 검토 완료 · 근거 부족',
      className: 'bg-amber-50 text-amber-800 border border-amber-200',
    };

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
  const hasCandidate = Boolean(candidate?.nickname && candidateAmount && candidateAmount > 0
    && sale.aiVerification?.nicknameVerified !== false);
  const canRecoverConfirmed = Boolean(confirmedAiRecoveryBaseline(sale));
  const hasRecoveryCandidate = canRecoverConfirmed && sale.aiVerification?.reviewMode === 'TEXT_PROMPT_RECOVERY'
    && hasCandidate && Boolean(sale.aiVerification.recoveryReview?.candidateFingerprint);

  const handleConfirmedRecovery = async (mode: 'PREVIEW' | 'APPLY') => {
    setErrorMsg(null); setRecoveryMsg(null);
    if (mode === 'PREVIEW') setIsReviewing(true); else setIsApplyingCandidate(true);
    try {
      if (!canRecoverConfirmed || sale.syncStatus === 'PENDING' || !workspaceId) throw new Error('판매 저장 확인 후 원본 근거를 다시 검토해 주세요.');
      if (mode === 'PREVIEW') {
        await flushPendingComments(workspaceId);
        await syncCurrentTranscriptsToCloud(sale.sessionId);
      }
      const result = await aiSettingsApi.triggerPendingAiResolution(sale.id, {
        workspaceId, confirmedAiRecovery: mode, expectedRevision: sale.revision || 1,
        expectedRecoveryFingerprint: mode === 'APPLY' ? sale.aiVerification?.recoveryReview?.candidateFingerprint : undefined,
        transcripts: storageService.getSessionTranscripts(workspaceId, sale.sessionId),
      });
      if (result.skipped) setErrorMsg(result.message || '원본 근거가 부족해 정정하지 않았습니다.');
      else setRecoveryMsg(result.message || (mode === 'APPLY' ? '원본 근거로 판매를 정정했습니다.' : '정정 후보를 확인하고 정정 적용을 눌러 주세요.'));
      await refreshSales(); onRefresh?.();
    } catch (error: any) { setErrorMsg(error?.message || '원본 근거 정정에 실패했습니다.'); }
    finally { setIsReviewing(false); setIsApplyingCandidate(false); }
  };

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
      if (!hasCandidate || sale.syncStatus === 'PENDING') {
        throw new Error('댓글 닉네임과 가격을 확인한 후보만 적용할 수 있습니다. 구매자를 직접 확인해 주세요.');
      }
      const newNickname = candidate?.nickname || sale.buyerNickname;
      const newAmount = candidateAmount || sale.amount;

      // 낙관적 revision 증가 및 서버 확정
      const updated: SaleRecord = {
        ...sale,
        buyerNickname: newNickname,
        buyerId: candidate?.buyerId || sale.buyerId,
        amount: newAmount,
        unitPrice: newAmount,
        purchaseRequestId: sale.aiVerification?.candidatePurchaseRequestId || sale.purchaseRequestId,
        sourceCommentIds: sale.aiVerification?.candidateCommentId ? [sale.aiVerification.candidateCommentId] : sale.sourceCommentIds,
        status: '확정',
        pendingReasons: sale.pendingReasons?.map((reason) => ({ ...reason, resolved: true,
          resolvedAt: new Date().toISOString(), resolvedBy: 'MANUAL', resolutionDetails: '판매자가 닉네임·가격 후보를 확인했습니다.' })),
        revision: (sale.revision || 1) + 1,
        aiVerification: {
          ...sale.aiVerification,
          aiStatus: 'RESOLVED',
          reviewDecision: undefined,
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
        {canRecoverConfirmed && (
          <button type="button" disabled={isReviewing || isApplyingCandidate}
            className="px-2.5 py-1 bg-amber-50 text-amber-900 text-[11px] font-bold rounded-lg border border-amber-300 disabled:opacity-50"
            title="원본 발화와 실제 구매 댓글·가격을 확인해 정정 후보를 보여줍니다"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleConfirmedRecovery('PREVIEW'); }}>
            {isReviewing ? '원본 근거 확인 중' : '원본 근거 재검토'}
          </button>
        )}
        {sale.status === '보류' && sale.source === 'WEB_VOICE' && (
          <button type="button" disabled={isReviewing || sale.syncStatus === 'PENDING' || sale.aiVerification?.aiStatus === 'CHECKING'}
            className="px-2.5 py-1 bg-sky-50 text-sky-800 text-[11px] font-bold rounded-lg border border-sky-200 flex items-center gap-1 disabled:opacity-50"
            title="AI 검토를 실행하고 질문·답변을 새 창에서 확인"
            onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              const conversation = openConversation(sale, { reviewing: true });
              setIsReviewing(true); setErrorMsg(null);

              // 1. 화면 메모리 댓글 및 로컬 스토리지 댓글 병합
              const liveList = commentCapture?.liveComments || [];
              const localComments = storageService.getSessionCommentRecords(sale.sessionId, workspaceId || undefined);
              const commentMap = new Map<string, any>();
              for (const c of localComments) {
                const key = c.platformMessageId || c.id;
                if (key) commentMap.set(key, c);
              }
              for (const c of liveList) {
                const key = c.platformMessageId || c.id;
                if (key) commentMap.set(key, c);
              }
              const comments = [...commentMap.values()];

              // 2. 로컬 스토리지 전사 로그 수집
              const transcripts = storageService.getSessionTranscripts(workspaceId || '', sale.sessionId);

              // 3. 댓글 클라우드 큐 flush 시도 (비동기)
              if (workspaceId) {
                void flushPendingComments(workspaceId);
              }

              void syncCurrentTranscriptsToCloud(sale.sessionId)
                .then(() => aiSettingsApi.triggerPendingAiResolution(sale.id, {
                  forceReanalyze: true,
                  workspaceId: workspaceId || undefined,
                  comments,
                  transcripts,
                }))
                .then((result) => {
                  const reviewError = result.sale?.ai_verification?.errorMessage || result.sale?.aiVerification?.errorMessage;
                  if (reviewError || (result.skipped && result.message)) setErrorMsg(reviewError || result.message);
                  conversation?.finishReview(reviewError || result.message || 'AI 검토가 완료되었습니다. 아래 저장된 질문과 답변을 확인해 주세요.');
                  return refreshSales();
                })
                .then(() => onRefresh?.())
                .catch((err) => {
                  const message = err.message || 'AI 검토 요청에 실패했습니다.';
                  setErrorMsg(message);
                  conversation?.finishReview(message);
                })
                .finally(() => setIsReviewing(false));
            }}>
            <Sparkles className="w-3 h-3" />{isReviewing ? 'AI 검토 중' : sale.aiVerification?.aiTaskId ? 'AI 다시 검토' : 'AI 검토'}
          </button>
        )}
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
      {recoveryMsg && <span role="status" className="text-[11px] text-emerald-800">{recoveryMsg}</span>}

      {(candidate || candidateAmount) && (
        <span className="text-[11px] font-bold text-slate-700">
          {sale.aiVerification?.reviewMode === 'TEXT_PROMPT_RECOVERY' ? '원본 근거 검토 결과: ' : 'AI 검토 결과: '}{candidate?.nickname || sale.aiVerification?.suggestedNickname || '구매자 미확인'}
          {' · '}{candidateAmount ? `${candidateAmount.toLocaleString()}원` : '금액 미확인'}
          {sale.aiVerification?.nicknameVerified === false ? ' · 닉네임 확인 필요' : ''}
        </span>
      )}

      {/* 핵심 액션 3종 버튼: 근거 보기, 후보 적용, 되돌리기 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {hasRecoveryCandidate && (
          <button type="button" disabled={isApplyingCandidate || isReviewing || sale.syncStatus === 'PENDING'}
            className="px-2.5 py-1 bg-brand-50 text-brand-800 text-[11px] font-bold rounded-lg border border-brand-300 disabled:opacity-50"
            title={`${sale.buyerNickname} ${sale.amount.toLocaleString()}원 → ${candidate?.nickname} ${candidateAmount?.toLocaleString()}원`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleConfirmedRecovery('APPLY'); }}>
            {isApplyingCandidate ? '정정 저장 중' : '정정 적용'}
          </button>
        )}
        {/* 1. 근거 보기 버튼 */}
        {!hideEvidence && (
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
        )}

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
