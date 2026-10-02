import { isSupabaseConfigured, requireSupabase } from "./supabaseClient";
import type {
  SellerAnalysisDocument,
  SellerAnalysisInput,
  SellerAnalysisSummary,
} from "../types/sellerAnalysis";
import type { AppliedSalesWorkflow } from "../types/salesWorkflow";

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

export class SellerAnalysisApiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "SellerAnalysisApiError";
  }
}

async function invoke<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new SellerAnalysisApiError(
      "서버 연결 설정이 없어 판매 분석을 저장하거나 요청할 수 없습니다.",
    );
  }
  const { data, error } = await requireSupabase().functions.invoke<
    ApiEnvelope<T>
  >("sales-api", {
    body: { action, ...payload },
  });
  if (error) {
    let message = error.message;
    let code: string | undefined;
    try {
      const context = (error as { context?: Response }).context;
      if (context && typeof context.json === "function") {
        const response = await context.json() as ApiEnvelope<unknown>;
        message = response.error?.message || message;
        code = response.error?.code;
      }
    } catch {
      /* Keep the transport error if no server envelope was returned. */
    }
    throw new SellerAnalysisApiError(
      message || "판매 분석 서버에 연결하지 못했습니다.",
      code,
    );
  }
  if (!data?.ok || !data.data) {
    throw new SellerAnalysisApiError(
      data?.error?.message || "판매 분석 요청을 처리하지 못했습니다.",
      data?.error?.code,
    );
  }
  return data.data;
}

export const sellerAnalysisApi = {
  async verify(
    document: Pick<SellerAnalysisDocument, "id" | "revision">,
    reportVersion: number,
    reviewed: boolean,
  ): Promise<SellerAnalysisDocument> {
    return (await invoke<{ analysis: SellerAnalysisDocument }>(
      "seller-analysis-verify",
      {
        id: document.id,
        expectedRevision: document.revision,
        reportVersion,
        reviewed,
      },
    )).analysis;
  },
  async currentWorkflow(
    sessionId?: string,
  ): Promise<AppliedSalesWorkflow | null> {
    return (await invoke<{ workflow: AppliedSalesWorkflow | null }>(
      "seller-workflow-current",
      { sessionId },
    )).workflow;
  },
  async workflowState(sellerUserId: string): Promise<any> {
    return invoke("seller-workflow-state", { sellerUserId });
  },
  async workflowAction(
    action: "deploy" | "review-shadow" | "activate" | "rollback",
    payload: Record<string, unknown>,
  ): Promise<void> {
    await invoke(`seller-workflow-${action}`, payload);
  },
  async observe(sessionId: string): Promise<void> {
    await invoke("seller-workflow-observe", { sessionId });
  },
  async list(): Promise<SellerAnalysisSummary[]> {
    return (await invoke<{ analyses: SellerAnalysisSummary[] }>(
      "seller-analysis-list",
    )).analyses;
  },
  async get(id: string): Promise<SellerAnalysisDocument> {
    return (await invoke<{ analysis: SellerAnalysisDocument }>(
      "seller-analysis-get",
      { id },
    )).analysis;
  },
  async save(
    input: SellerAnalysisInput,
    existing?: Pick<SellerAnalysisDocument, "id" | "revision">,
  ): Promise<SellerAnalysisDocument> {
    return (await invoke<{ analysis: SellerAnalysisDocument }>(
      "seller-analysis-save",
      {
        input,
        ...(existing
          ? { id: existing.id, expectedRevision: existing.revision }
          : {}),
      },
    )).analysis;
  },
  async analyze(
    document: Pick<SellerAnalysisDocument, "id" | "revision">,
    feedback?: string,
  ): Promise<SellerAnalysisDocument> {
    return (await invoke<{ analysis: SellerAnalysisDocument }>(
      "seller-analysis-analyze",
      {
        id: document.id,
        expectedRevision: document.revision,
        ...(feedback?.trim() ? { feedback: feedback.trim() } : {}),
      },
    )).analysis;
  },
  async approve(
    document: Pick<SellerAnalysisDocument, "id" | "revision">,
    reportVersion: number,
  ): Promise<SellerAnalysisDocument> {
    return (await invoke<{ analysis: SellerAnalysisDocument }>(
      "seller-analysis-approve",
      {
        id: document.id,
        expectedRevision: document.revision,
        reportVersion,
      },
    )).analysis;
  },
};

export const createSellerAnalysisInput = (): SellerAnalysisInput => ({
  sellerName: "",
  sellerUserId: null,
  adminDescription: "",
  commentText: "",
  transcriptText: "",
});

export function sameSellerAnalysisInput(
  left: SellerAnalysisInput,
  right: SellerAnalysisInput,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** This is a UI guard only; the server repeats revision/report checks atomically. */
export function canApproveSellerAnalysis(
  document: SellerAnalysisDocument | null,
  input: SellerAnalysisInput,
  pendingFeedback: string,
  visibleReportVersion: number | null,
): boolean {
  if (!document || document.status !== "REVIEW" || pendingFeedback.trim()) {
    return false;
  }
  if (!sameSellerAnalysisInput(document.input, input)) return false;
  if (
    visibleReportVersion === null ||
    visibleReportVersion !== document.currentReportVersion
  ) return false;
  const report = document.reports.find((item) =>
    item.version === visibleReportVersion
  );
  return Boolean(
    report && report.inputRevision === document.revision &&
      report.verification?.reviewed &&
      report.report.supportAssessment !== "NEW_MODULE_REQUIRED",
  );
}
