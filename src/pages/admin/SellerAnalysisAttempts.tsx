import React from "react";
import type {
  SellerAnalysisAttempt,
  SellerAnalysisMessage,
} from "../../types/sellerAnalysis";

/** A fallback message and the final message can contain the same first attempt. */
export function collectSellerAnalysisAttempts(
  messages: SellerAnalysisMessage[],
): SellerAnalysisAttempt[] {
  const attempts = new Map<string, SellerAnalysisAttempt>();
  for (const message of messages) {
    for (const attempt of message.attempts || []) {
      attempts.set(`${attempt.slot}:${attempt.startedAt}`, attempt);
    }
  }
  return [...attempts.values()];
}

export function analysisAttemptStatus(attempt: SellerAnalysisAttempt): string {
  if (!attempt.error) return "정상 응답";
  switch (attempt.errorCode) {
    case "TIMEOUT":
      return "응답 시간 초과";
    case "INVALID_REPORT":
      return "답변 형식 확인 실패";
    case "OUTPUT_LIMIT":
      return "답변 길이 초과";
    case "PROVIDER_ERROR":
      return "AI 요청 실패";
    default:
      return "분석 실패";
  }
}

export default function SellerAnalysisAttempts(
  { attempts }: { attempts: SellerAnalysisAttempt[] },
) {
  return <div className="space-y-3">
    {attempts.map((attempt, index) => {
      const duration = Date.parse(attempt.completedAt) -
        Date.parse(attempt.startedAt);
      return <details
        key={`${attempt.slot}:${attempt.startedAt}:${index}`}
        className="rounded-xl bg-slate-50 p-4"
      >
        <summary className="cursor-pointer text-sm leading-6">
          <strong>{attempt.slot}번슬롯</strong> · {attempt.model} · {attempt.provider}
          {" · "}{attempt.phase === "FORMAT_REPAIR" ? "답변 형식 재확인" : "판매방식 분석"}
          {" · "}{Number.isFinite(duration) && duration >= 0
            ? `${(duration / 1000).toFixed(1)}초`
            : "소요 시간 기록 없음"}
          {" · "}{analysisAttemptStatus(attempt)}
        </summary>
        {attempt.error && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-red-700">{attempt.error}</p>}
        {attempt.conversationTrace
          ? <>
            <h4 className="mt-4 text-sm font-bold">AI에게 전달한 지침</h4>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6">{attempt.conversationTrace.systemPrompt}</pre>
            <h4 className="mt-4 text-sm font-bold">질문</h4>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6">{attempt.conversationTrace.userPrompt}</pre>
            <h4 className="mt-4 text-sm font-bold">AI 답변</h4>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6">{attempt.conversationTrace.responseText || "받은 답변이 없습니다."}</pre>
          </>
          : <p className="mt-3 text-sm text-slate-500">질문과 답변 기록이 없습니다.</p>}
      </details>;
    })}
  </div>;
}
