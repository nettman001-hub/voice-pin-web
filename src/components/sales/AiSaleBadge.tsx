import React from 'react';
import { Sparkles } from 'lucide-react';
import { SaleRecord } from '../../types/live';
import { useSaleAiConversationWindow } from './SaleAiConversationWindow';

/**
 * 판매 적재/해결 시 AI가 사용되었는지 판별하는 헬퍼 함수
 */
export function isAiUsedSale(sale?: Partial<SaleRecord> | null): boolean {
  if (!sale) return false;
  // 1. aiVerification 메타데이터 검사
  if (sale.aiVerification && sale.aiVerification.aiStatus && sale.aiVerification.aiStatus !== 'NONE') {
    return true;
  }
  // 2. 보류 사유가 AI에 의해 해결된 경우
  if (sale.pendingReasons?.some((r) => r.resolvedBy === 'AI')) {
    return true;
  }
  // 3. 변경 이력에 AI 작업이 포함된 경우
  if (sale.history?.some((h) => h.changedBy === 'AI' || h.changeType === 'AI_RESOLVE')) {
    return true;
  }
  // 4. 명시적 AI 플래그 또는 메모
  if ((sale as any).isAiAssisted || (sale as any).isAiResolved) {
    return true;
  }
  if (typeof sale.note === 'string' && (sale.note.includes('AI') || sale.note.includes('인공지능'))) {
    return true;
  }
  return false;
}

interface AiSaleBadgeProps {
  sale?: Partial<SaleRecord> | null;
  className?: string;
  showIcon?: boolean;
}

/**
 * AI를 사용하여 적재/해결된 판매 건에 표시하는 AI 배지 컴포넌트
 */
export const AiSaleBadge: React.FC<AiSaleBadgeProps> = ({
  sale,
  className = '',
  showIcon = true,
}) => {
  const { openConversation } = useSaleAiConversationWindow();
  if (!isAiUsedSale(sale)) return null;

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-black bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-xs tracking-tight hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500 ${className}`}
      title="AI에게 보낸 질문과 답변을 새 창에서 확인"
      aria-label="AI 질문과 답변 보기 (새 창)"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (sale) openConversation(sale);
      }}
    >
      {showIcon && <Sparkles className="w-2.5 h-2.5 text-purple-200" />}
      <span>AI</span>
    </button>
  );
};
