import React, { useEffect, useRef, useState } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useLive } from "../../context/LiveContext";
import { useCommentCapture } from "../../context/CommentCaptureContext";
import {
  canApproveSellerAnalysis,
  createSellerAnalysisInput,
  sameSellerAnalysisInput,
  sellerAnalysisApi,
} from "../../services/sellerAnalysisApi";
import { SellerAnalysisCapture } from "../../services/sellerAnalysisCapture";
import { normalizeAnalysisInput } from "../../services/sellerAnalysisRules";
import type {
  SellerAnalysisDocument,
  SellerAnalysisInput,
  SellerAnalysisSlot,
  SellerAnalysisSummary,
} from "../../types/sellerAnalysis";

const field =
  "w-full rounded-xl border border-slate-200 bg-white p-3 text-sm disabled:bg-slate-50";
const button =
  "rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40";
export default function SellerAnalysisPage() {
  const { allMembers, refreshMembers } = useAppData();
  const live = useLive();
  const capture = useCommentCapture();
  const [items, setItems] = useState<SellerAnalysisSummary[]>([]);
  const [doc, setDoc] = useState<SellerAnalysisDocument | null>(null);
  const [input, setInput] = useState<SellerAnalysisInput>(
    createSellerAnalysisInput,
  );
  const [feedback, setFeedback] = useState("");
  const [slotNumber, setSlotNumber] = useState<SellerAnalysisSlot>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [state, setState] = useState<any>(null);
  const [reviewed, setReviewed] = useState(false);
  const recorder = useRef<SellerAnalysisCapture | null>(null);
  const viewGeneration = useRef(0);
  const loadList = () => sellerAnalysisApi.list().then(setItems);
  useEffect(() => {
    void loadList().catch((e) => setError(e.message));
    void refreshMembers();
    return () => {
      ++viewGeneration.current;
      recorder.current?.stop();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setState(null);
    if (input.sellerUserId) {
      void sellerAnalysisApi.workflowState(input.sellerUserId).then((s) => {
        if (active) {
          setState(s);
        }
      }).catch((e) => {
        if (active) setError(e.message);
      });
    }
    return () => {
      active = false;
    };
  }, [input.sellerUserId, doc?.approvedAt]);
  const stop = () => {
    const active = Boolean(recorder.current);
    recorder.current?.stop();
    recorder.current = null;
    setCapturing(false);
    if (active) setStatus("청취 종료 · 자료를 저장하고 분석해 주세요.");
  };
  const accept = (next: SellerAnalysisDocument) => {
    setDoc(next);
    setInput(next.input);
    setVersion(next.currentReportVersion);
    setReviewed(false);
    const pending = next.status === "ANALYZING" &&
      next.messages.at(-1)?.continuation;
    if (pending) setSlotNumber(pending.requestedSlot);
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = (id: string) =>
    void run(async () => {
      stop();
      setStatus("");
      const generation = ++viewGeneration.current;
      const next = await sellerAnalysisApi.get(id);
      if (generation === viewGeneration.current) {
        accept(next);
        setFeedback("");
      }
    });
  const save = async () => {
    const next = await sellerAnalysisApi.save(input, doc || undefined);
    accept(next);
    await loadList();
    return next;
  };
  const start = () =>
    void run(async () => {
      if (live.isListening || capture.isActive) {
        throw new Error(
          "기존 라이브 청취와 댓글 수집을 종료한 뒤 분석 청취를 시작해 주세요.",
        );
      }
      if (!input.broadcastUsername?.trim()) {
        throw new Error("분석할 방송의 TikTok 아이디를 입력해 주세요.");
      }
      const apiKey = live.sttProvider === "SONIOX"
        ? live.sonioxApiKey
        : live.deepgramApiKey;
      if (!apiKey) throw new Error("관리자 STT API 키를 설정해 주세요.");
      const sessionId = crypto.randomUUID();
      setInput((i) => ({
        ...i,
        sessionId,
        comments: [],
        transcripts: [],
        commentText: "",
        transcriptText: "",
      }));
      setReviewed(false);
      setCapturing(true);
      const service = new SellerAnalysisCapture();
      recorder.current = service;
      const generation = ++viewGeneration.current;
      const current = () => generation === viewGeneration.current;
      try {
        await service.start({
          username: input.broadcastUsername,
          serverUrl: capture.config.serverUrl,
          sessionId,
          stt: {
            provider: live.sttProvider,
            apiKey,
            model: "nova-3",
            language: "ko",
            keyterms: [],
            punctuate: true,
            interimResults: true,
            endpointing: 800,
            allowBrowserSpeechFallback: false,
          },
          comment: (c) => {
            if (!current()) return;
            setInput((i) => {
              const rows = i.comments || [];
              if (rows.some((r) => r.id === c.id)) return i;
              if (rows.length >= 2000) {
                queueMicrotask(stop);
                return i;
              }
              return { ...i, comments: [...rows, c] };
            });
          },
          transcript: (t) => {
            if (!current()) return;
            setInput((i) => {
              const rows = i.transcripts || [];
              if (rows.length >= 500) {
                queueMicrotask(stop);
                return i;
              }
              return { ...i, transcripts: [...rows, t] };
            });
          },
          status: (s) => {
            if (current()) {
              setStatus(s);
              if (s.startsWith("청취 중지")) setCapturing(false);
            }
          },
        });
      } catch (e) {
        setCapturing(false);
        throw e;
      }
    });
  const report = doc?.reports.find((r) => r.version === version);
  const statusLabel: Record<string, string> = {
    DRAFT: "자료 준비",
    ANALYZING: "분석 중",
    REVIEW: "검토 대기",
    APPROVED: "승인 완료",
    FAILED: "분석 실패",
  };
  const supportLabel: Record<string, string> = {
    SUPPORTED: "지원 가능",
    NEEDS_REVIEW: "추가 확인 필요",
    NEW_MODULE_REQUIRED: "공통 기능 추가 필요",
  };
  const dirty = Boolean(doc && !sameSellerAnalysisInput(doc.input, input));
  const analyze = () =>
    void run(async () => {
      stop();
      const generation = viewGeneration.current;
      const current = doc && !dirty ? doc : await save();
      const next = await sellerAnalysisApi.analyze(
        current,
        feedback,
        slotNumber,
      );
      if (generation === viewGeneration.current) {
        accept(next);
        setFeedback("");
        await loadList();
      }
    });
  const verify = (confirmed: boolean) =>
    void run(async () => {
      if (!doc || !report || dirty || feedback.trim()) {
        throw new Error("자료와 수정 요청을 먼저 분석해 주세요.");
      }
      const next = await sellerAnalysisApi.verify(
        doc,
        report.version,
        confirmed,
      );
      accept(next);
    });
  const deploymentAction = (
    action: "deploy" | "review-shadow" | "activate" | "rollback",
  ) =>
    void run(async () => {
      if (!doc || !input.sellerUserId) return;
      await sellerAnalysisApi.workflowAction(action, {
        analysisId: doc.id,
        reportVersion: doc.approvedReportVersion,
        sellerUserId: input.sellerUserId,
        expectedRevision: state?.deployment?.revision || 0,
      });
      setState(await sellerAnalysisApi.workflowState(input.sellerUserId));
      setStatus(
        "판매방식 적용 설정을 저장했습니다. 진행 중인 회차는 유지하고, 다음 새 회차부터 적용됩니다.",
      );
    });
  const sections: [string, keyof NonNullable<typeof report>["report"]][] = [
    ["판매 흐름", "workflow"],
    ["구매 댓글", "purchaseSignals"],
    ["판매 확정", "confirmationSignals"],
    ["가격", "priceRules"],
    ["닉네임 연결", "nicknameRules"],
    ["예외", "exceptions"],
    ["미확인 사항", "unknowns"],
    ["추가 지원 필요", "suggestions"],
  ];
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="rounded-3xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-black">판매자 판매방식 분석</h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          방송 청취 → AI 분석·수정 → 재생 검증 → 최종 승인 → 관찰 검증 →
          판매자별 적용
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="rounded-xl bg-blue-50 p-4 text-blue-800">
          {status}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
        <aside className="space-y-3 rounded-3xl border bg-white p-4">
          <button
            className={button}
            disabled={busy || capturing}
            onClick={() => {
              ++viewGeneration.current;
              setDoc(null);
              setInput(createSellerAnalysisInput());
              setFeedback("");
              setVersion(null);
              setReviewed(false);
            }}
          >
            새 판매자 분석
          </button>
          {items.map((i) => (
            <button
              key={i.id}
              disabled={busy || capturing}
              onClick={() => open(i.id)}
              className={`block w-full rounded-xl p-3 text-left text-sm ${
                doc?.id === i.id ? "bg-brand-50" : "bg-slate-50"
              }`}
            >
              <strong>{i.input.sellerName}</strong>
              <span className="mt-1 block text-xs text-slate-500">
                {statusLabel[i.status]} ·{" "}
                {new Date(i.updatedAt).toLocaleString()}
              </span>
            </button>
          ))}
        </aside>
        <div className="space-y-6">
          <section className="space-y-4 rounded-3xl border bg-white p-6">
            <h2 className="text-lg font-bold">분석할 판매자와 방송 자료</h2>
            <label className="block text-sm font-bold">
              등록 판매자<select
                className={field}
                disabled={busy || capturing}
                value={input.sellerUserId || ""}
                onChange={(e) =>
                  setInput((i) => ({
                    ...i,
                    sellerUserId: e.target.value || null,
                    sellerName: allMembers.find((m) => m.id === e.target.value)
                      ?.nickname || i.sellerName,
                  }))}
              >
                <option value="">미등록 판매자 · 분석만 진행</option>
                {allMembers.filter((m) => m.role !== "관리자").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nickname} ({m.email})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-bold">
                판매자 이름<input
                  className={field}
                  disabled={busy || capturing}
                  value={input.sellerName}
                  maxLength={120}
                  onChange={(e) =>
                    setInput((i) => ({ ...i, sellerName: e.target.value }))}
                />
              </label>
              <label className="text-sm font-bold">
                TikTok 방송 아이디<input
                  className={field}
                  disabled={busy || capturing}
                  value={input.broadcastUsername || ""}
                  onChange={(e) =>
                    setInput((i) => ({
                      ...i,
                      broadcastUsername: e.target.value,
                    }))}
                  placeholder="@아이디"
                />
              </label>
            </div>
            <label className="block text-sm font-bold">
              관리자가 알고 있는 판매방식<textarea
                className={`${field} mt-2 min-h-32`}
                disabled={busy || capturing}
                value={input.adminDescription}
                maxLength={8000}
                onChange={(e) =>
                  setInput((i) => ({ ...i, adminDescription: e.target.value }))}
                placeholder="예: 상품번호와 가격을 안내하고, 구매자들이 번호를 댓글로 입력합니다. 여러 구매자를 호명해 확정합니다."
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={button}
                disabled={busy || capturing || live.isListening ||
                  capture.isActive}
                onClick={start}
              >
                방송 청취 시작
              </button>
              <button className={button} disabled={!capturing} onClick={stop}>
                청취 종료
              </button>
              <span className="text-sm text-slate-500">
                댓글 {input.comments?.length || 0}/2,000 · 발화{" "}
                {input.transcripts?.length || 0}/500 · 분석 청취는 판매를
                적재하지 않습니다.
              </span>
            </div>
            <p className="text-xs leading-6 text-slate-500">
              청취 시작 시 분석할 방송 탭을 새로 선택하고 탭 오디오 공유를
              허용해 주세요. 기존 일시정지된 탭 공유 연결은 교체됩니다.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="max-h-60 overflow-auto rounded-xl bg-slate-50 p-3 text-xs leading-6">
                {input.comments?.map((c) => (
                  <p key={c.id}>
                    {new Date(c.capturedAt).toLocaleTimeString()} ·{" "}
                    <b>{c.nickname}</b>: {c.content}
                  </p>
                ))}
              </div>
              <div className="max-h-60 overflow-auto rounded-xl bg-slate-50 p-3 text-xs leading-6">
                {input.transcripts?.map((t) => (
                  <p key={t.id}>
                    {new Date(t.recognizedAt).toLocaleTimeString()} · {t.text}
                  </p>
                ))}
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-bold">
                기존 방송 자료 입력·불러오기
              </summary>
              <p className="my-2 text-xs text-slate-500">
                텍스트는 AI 참고용입니다. 재생 검증에는 시각이 포함된 JSON
                자료가 필요합니다.
              </p>
              <textarea
                aria-label="고객 댓글 참고 자료"
                className={field}
                disabled={busy || capturing}
                value={input.commentText}
                maxLength={24000}
                onChange={(e) =>
                  setInput((i) => ({ ...i, commentText: e.target.value }))}
              />
              <textarea
                aria-label="판매자 멘트 참고 자료"
                className={field}
                disabled={busy || capturing}
                value={input.transcriptText}
                maxLength={48000}
                onChange={(e) =>
                  setInput((i) => ({ ...i, transcriptText: e.target.value }))}
              />
              <label className="mt-3 block text-sm">
                분석 자료 JSON 불러오기<input
                  type="file"
                  accept="application/json,.json"
                  disabled={busy || capturing}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void run(async () => {
                        if (file.size > 500000) {
                          throw new Error("자료 파일은 500KB까지 가능합니다.");
                        }
                        setInput(
                          normalizeAnalysisInput(JSON.parse(await file.text())),
                        );
                      });
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            </details>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={button}
                disabled={busy || capturing}
                onClick={() =>
                  void run(async () => {
                    await save();
                    setStatus("분석 자료를 저장했습니다.");
                  })}
              >
                자료 저장
              </button>
              <button
                type="button"
                className={button}
                title="현재 방송 자료를 JSON 파일로 다운로드합니다."
                onClick={() => {
                  const a = document.createElement("a");
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(input, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  a.href = url;
                  a.download = "voicecap-판매방식-분석자료.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                자료다운로드
              </button>
              <select
                aria-label="분석 AI 슬롯"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold disabled:bg-slate-50 disabled:opacity-40"
                value={slotNumber}
                disabled={busy || capturing}
                onChange={(e) =>
                  setSlotNumber(Number(e.target.value) as SellerAnalysisSlot)}
              >
                <option value={1}>1번슬롯</option>
                <option value={2}>2번슬롯</option>
              </select>
              <button
                className={button}
                disabled={busy || capturing}
                onClick={analyze}
              >
                {busy ? "처리 중…" : "AI 판매방식 분석"}
              </button>
            </div>
            <p className="text-xs leading-6 text-slate-500">
              선택한 슬롯을 먼저 사용하며, 슬롯별 응답 대기시간은 최대
              2분입니다. 실패 시 관리자 자동 대체 설정을 따릅니다. 수정·추가
              요청에도 같은 선택을 사용합니다.
            </p>
          </section>
          {doc && (
            <section className="space-y-4 rounded-3xl border bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">AI 분석 보고서</h2>
                <select
                  aria-label="보고서 버전"
                  className="rounded-lg border p-2"
                  value={version || ""}
                  onChange={(e) => {
                    setVersion(Number(e.target.value));
                    setReviewed(false);
                  }}
                >
                  {doc.reports.map((r) => (
                    <option key={r.version} value={r.version}>
                      버전 {r.version}
                      {r.version === doc.approvedReportVersion
                        ? " · 승인됨"
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
              {report
                ? (
                  <>
                    <p className="whitespace-pre-wrap leading-7">
                      {report.report.summary}
                    </p>
                    <p className="text-sm font-bold">
                      지원 판정: {supportLabel[report.report.supportAssessment]}
                      {" "}
                      · {report.report.inventoryRule}
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                      {sections.map(([label, key]) => (
                        <div key={key} className="rounded-xl bg-slate-50 p-4">
                          <h3 className="font-bold">{label}</h3>
                          {(report.report[key] as string[]).map((s, i) => (
                            <p key={i} className="mt-2 text-sm leading-6">
                              {s}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                    <details>
                      <summary className="cursor-pointer font-bold">
                        판매방식 설정 보기
                      </summary>
                      <pre className="overflow-auto p-3 text-xs">{JSON.stringify(report.report.profile,null,2)}</pre>
                    </details>
                    <button
                      className={button}
                      disabled={busy || capturing || dirty ||
                        Boolean(feedback.trim()) ||
                        version !== doc.currentReportVersion ||
                        doc.status !== "REVIEW"}
                      onClick={() => verify(false)}
                    >
                      수집 방송으로 재생 검증
                    </button>
                    {report.verification && (
                      <>
                        <p className="text-sm">
                          확정 후보 {report.verification.decisions.filter((d) =>
                            d.status === "CONFIRMED"
                          ).length}건 · 보류{" "}
                          {report.verification.decisions.filter((d) =>
                            d.status === "REVIEW"
                          ).length}건
                        </p>
                        <div className="max-h-80 overflow-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr>
                                <th>시각</th>
                                <th>구매자</th>
                                <th>상품</th>
                                <th>수량</th>
                                <th>금액</th>
                                <th>결과</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.verification.decisions.map((d) => (
                                <tr key={d.id} className="border-t">
                                  <td className="py-3">
                                    {new Date(d.recognizedAt)
                                      .toLocaleTimeString()}
                                  </td>
                                  <td>{d.nickname}</td>
                                  <td>{d.orderCode || "현재 상품"}</td>
                                  <td>{d.quantity}</td>
                                  <td>{d.amount.toLocaleString()}원</td>
                                  <td>
                                    {d.status === "CONFIRMED"
                                      ? "확정 후보"
                                      : d.reasons.join(" · ")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <label className="flex gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={reviewed || report.verification.reviewed}
                            disabled={busy || doc.status !== "REVIEW"}
                            onChange={(e) => setReviewed(e.target.checked)}
                          />원본 방송과 후보·누락·오감지를 비교하고 결과를
                          확인했습니다.
                        </label>
                        <button
                          className={button}
                          disabled={busy || !reviewed || dirty ||
                            Boolean(feedback.trim()) || doc.status !== "REVIEW"}
                          onClick={() => verify(true)}
                        >
                          검증 확인 저장
                        </button>
                      </>
                    )}
                    <button
                      className={button}
                      disabled={busy || capturing ||
                        !canApproveSellerAnalysis(
                          doc,
                          input,
                          feedback,
                          version,
                        )}
                      onClick={() =>
                        void run(async () => {
                          accept(
                            await sellerAnalysisApi.approve(
                              doc,
                              report.version,
                            ),
                          );
                          await loadList();
                        })}
                    >
                      관리자 최종 승인
                    </button>
                    {doc.approvedAt && (
                      <p className="text-sm text-green-700">
                        버전 {doc.approvedReportVersion} 승인 ·{" "}
                        {new Date(doc.approvedAt).toLocaleString()} · 승인자
                        {" "}
                        {doc.approvedBy}
                      </p>
                    )}
                    <details>
                      <summary className="cursor-pointer text-sm font-bold">
                        AI에게 보낸 질문과 답변
                      </summary>
                      {report.requestedSlot && (
                        <p className="mt-2 text-xs text-slate-500">
                          요청한 우선 슬롯: {report.requestedSlot}번슬롯
                        </p>
                      )}
                      {report.attempts.map((a, i) => (
                        <div
                          key={i}
                          className="mt-3 rounded-xl bg-slate-50 p-4"
                        >
                          <p>
                            슬롯 {a.slot} · {a.provider} · {a.model} {a.error}
                          </p>
                          <pre className="mt-3 whitespace-pre-wrap break-words text-xs">{a.conversationTrace?.systemPrompt}{'\n\n'}{a.conversationTrace?.userPrompt}{'\n\n답변\n'}{a.conversationTrace?.responseText}</pre>
                        </div>
                      ))}
                    </details>
                  </>
                )
                : (
                  <p className="text-slate-500">
                    자료를 저장한 뒤 AI 분석을 요청해 주세요. {doc.lastError}
                  </p>
                )}
              <div className="space-y-3 border-t pt-5">
                <h3 className="font-bold">수정·추가 요청 대화</h3>
                <div className="max-h-64 space-y-3 overflow-auto">
                  {doc.messages.map((m) => (
                    <p
                      key={m.id}
                      className={`rounded-xl p-3 text-sm leading-6 ${
                        m.role === "ADMIN" ? "bg-brand-50" : "bg-slate-50"
                      }`}
                    >
                      <b>
                        {m.role === "ADMIN"
                          ? "관리자"
                          : m.role === "ASSISTANT"
                          ? "AI"
                          : "처리 결과"}
                      </b>{" "}
                      · {m.content}
                    </p>
                  ))}
                </div>
                <textarea
                  aria-label="AI 수정·추가 요청"
                  className={`${field} min-h-24`}
                  disabled={busy || capturing}
                  value={feedback}
                  maxLength={4000}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="분석에서 빠진 판매방식이나 수정할 내용을 입력해 주세요."
                />
                <button
                  className={button}
                  disabled={busy || capturing || !feedback.trim()}
                  onClick={analyze}
                >
                  요청 보내고 다시 분석
                </button>
              </div>
            </section>
          )}
          {input.sellerUserId && (
            <section className="space-y-4 rounded-3xl border bg-white p-6">
              <h2 className="text-lg font-bold">판매자별 적용·관찰 검증</h2>
              <p className="text-sm">
                현재: {state?.deployment && state.deployment.mode !== "DEFAULT"
                  ? `${
                    state.deployment.mode === "ACTIVE"
                      ? "운영 적용"
                      : "관찰 모드"
                  } · 설정 버전 ${
                    state.profiles?.find((p: any) =>
                      p.id === state.deployment.profile_id
                    )?.report_version
                  }`
                  : "기본 판매 처리"}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  className={button}
                  disabled={busy || capturing || dirty ||
                    doc?.status !== "APPROVED"}
                  onClick={() => deploymentAction("deploy")}
                >
                  승인 버전을 관찰 모드로 적용
                </button>
                <button
                  className={button}
                  disabled={busy || capturing ||
                    state?.deployment?.mode !== "SHADOW" ||
                    !state?.observations?.some((o: any) =>
                      o.profile_id === state.deployment.profile_id &&
                      o.decisions.length
                    )}
                  onClick={() => deploymentAction("review-shadow")}
                >
                  실제 방송 관찰 결과 확인
                </button>
                <button
                  className={button}
                  disabled={busy || capturing ||
                    state?.deployment?.mode !== "SHADOW" ||
                    !state?.deployment?.shadow_reviewed}
                  onClick={() => deploymentAction("activate")}
                >
                  운영 적용
                </button>
                <button
                  className={button}
                  disabled={busy || capturing || !state?.deployment ||
                    state.deployment.mode === "DEFAULT"}
                  onClick={() => deploymentAction("rollback")}
                >
                  {state?.deployment?.previous_profile_id
                    ? "이전 버전으로 복귀"
                    : "기본 처리로 복귀"}
                </button>
                <button
                  className="text-sm font-bold text-brand-700"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setState(
                        await sellerAnalysisApi.workflowState(
                          input.sellerUserId!,
                        ),
                      )
                    )}
                >
                  관찰 결과 새로고침
                </button>
              </div>
              <p className="text-xs leading-6 text-slate-500">
                관찰 모드는 기존 판매 처리와 나란히 결과를 계산합니다. 새
                설정으로 판매를 적재하지 않습니다. 실제 방송 결과를 확인한 뒤
                운영 적용할 수 있습니다.
              </p>
              {(state?.observations || []).map((o: any) => (
                <details key={o.id}>
                  <summary className="cursor-pointer text-sm">
                    방송 {o.session_id} · 관찰 {o.decisions.length}건
                  </summary>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(o.decisions,null,2)}</pre>
                </details>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
