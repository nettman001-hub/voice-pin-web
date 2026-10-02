import {
  admin,
  type AuthContext,
  errorResponse,
  successResponse,
} from "../../_shared/productSales.ts";
import type {
  SellerAnalysisAttempt,
  SellerAnalysisDocument,
} from "../../../../src/types/sellerAnalysis.ts";
import {
  analysisPrompt,
  normalizeAnalysisInput,
  parseAnalysisReport,
  verifyAnalysis,
} from "../../../../src/services/sellerAnalysisRules.ts";
import {
  getOperationalAiSetting,
  getPrimaryAiSlot,
} from "./aiOperationalSettings.ts";
import { executeAiPrompt } from "./aiAdapters/index.ts";
import { requireAnalysisAdmin } from "./workflowAuthorization.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code: string, message: string, status = 400): never {
  throw { code, message, status };
}
async function document(id: string): Promise<SellerAnalysisDocument> {
  if (!UUID.test(id || "")) {
    fail("VALIDATION_ERROR", "분석 ID가 올바르지 않습니다.");
  }
  const { data, error } = await admin.from("seller_workflow_analyses").select(
    "document",
  ).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) fail("NOT_FOUND", "분석 자료를 찾지 못했습니다.", 404);
  return data.document;
}
async function save(
  doc: SellerAnalysisDocument,
  expected: number | null,
  actor: string,
) {
  const { data, error } = await admin.rpc("voicecap_save_workflow_analysis", {
    p_id: doc.id,
    p_expected_revision: expected,
    p_document: doc,
    p_actor_id: actor,
  });
  if (error) throw error;
  if (!data.ok) {
    fail(
      "REVISION_CONFLICT",
      "다른 작업에서 분석이 변경되었습니다. 다시 불러와 주세요.",
      409,
    );
  }
  return data.document as SellerAnalysisDocument;
}
export async function handleSellerAnalysis(auth: AuthContext, body: any) {
  requireAnalysisAdmin(auth);
  const now = new Date().toISOString();
  if (body.action === "seller-analysis-list") {
    const { data, error } = await admin.from("seller_workflow_analyses").select(
      "summary",
    ).order("updated_at", { ascending: false }).limit(100);
    if (error) throw error;
    return successResponse({
      analyses: (data || []).map(({ summary: d }) => ({
        ...d,
        input: {
          ...d.input,
          adminDescription: "",
          commentText: "",
          transcriptText: "",
        },
      })),
    });
  }
  if (body.action === "seller-analysis-get") {
    return successResponse({ analysis: await document(body.id) });
  }
  if (body.action === "seller-analysis-save") {
    const input = normalizeAnalysisInput(body.input);
    if (input.sellerUserId) {
      if (!UUID.test(input.sellerUserId)) {
        fail("VALIDATION_ERROR", "등록 판매자 ID가 올바르지 않습니다.");
      }
      const { data, error } = await admin.auth.admin.getUserById(
        input.sellerUserId,
      );
      if (error || !data.user) {
        fail("VALIDATION_ERROR", "등록 판매자를 찾지 못했습니다.");
      }
    }
    const old = body.id ? await document(body.id) : null;
    if (
      old?.input.sellerUserId && old.input.sellerUserId !== input.sellerUserId
    ) {
      fail(
        "SELLER_MISMATCH",
        "이미 등록된 판매자의 분석입니다. 다른 판매자는 새 분석으로 시작해 주세요.",
        409,
      );
    }
    if (
      old?.status === "ANALYZING" &&
      Date.now() - Date.parse(old.updatedAt) < 60_000
    ) fail("BUSY", "AI 분석 완료 후 수정해 주세요.", 409);
    if (old && body.expectedRevision !== old.revision) {
      fail("REVISION_CONFLICT", "분석이 변경되었습니다.", 409);
    }
    const doc: SellerAnalysisDocument = {
      ...(old ||
        { id: crypto.randomUUID(), reports: [], messages: [], createdAt: now }),
      input,
      revision: (old?.revision || 0) + 1,
      status: "DRAFT",
      currentReportVersion: null,
      approvedReportVersion: null,
      approvedRevision: null,
      approvedAt: null,
      approvedBy: null,
      lastError: null,
      updatedAt: now,
    };
    return successResponse({
      analysis: await save(doc, old?.revision || null, auth.actorId),
    });
  }
  let doc = await document(body.id);
  if (doc.revision !== body.expectedRevision) {
    fail(
      "REVISION_CONFLICT",
      "분석이 변경되었습니다. 다시 불러와 주세요.",
      409,
    );
  }
  if (body.action === "seller-analysis-analyze") {
    if (
      doc.status === "ANALYZING" &&
      Date.now() - Date.parse(doc.updatedAt) < 60_000
    ) fail("BUSY", "이미 분석 중입니다.", 409);
    const feedback = String(body.feedback || "").trim();
    if (feedback.length > 4000 || doc.reports.length >= 20) {
      fail(
        "VALIDATION_ERROR",
        "요청은 4,000자, 분석은 20회까지 가능합니다. 새 분석을 만들어 주세요.",
      );
    }
    const previous = doc.reports.at(-1)?.report;
    doc = await save(
      {
        ...doc,
        revision: doc.revision + 1,
        status: "ANALYZING",
        approvedAt: null,
        approvedBy: null,
        approvedRevision: null,
        approvedReportVersion: null,
        updatedAt: now,
        messages: [...doc.messages, {
          id: crypto.randomUUID(),
          role: "ADMIN",
          content: feedback || "최초 분석 요청",
          revision: doc.revision + 1,
          reportVersion: null,
          createdAt: now,
        }],
      },
      doc.revision,
      auth.actorId,
    );
    const attempts: SellerAnalysisAttempt[] = [];
    try {
      const setting = await getOperationalAiSetting();
      if (!setting) {
        throw new Error("관리자 AI 설정을 먼저 운영에 적용해 주세요.");
      }
      const { data: secrets, error: secretError } = await admin.from(
        "ai_secrets",
      ).select("slot_number,secret_value").eq("setting_id", setting.id);
      if (secretError) throw secretError;
      const primary = getPrimaryAiSlot(setting);
      const slots = setting.auto_fallback_enabled === false
        ? [primary]
        : [primary, primary === 1 ? 2 : 1];
      let report = null;
      for (const slot of slots) {
        const config = setting[`slot${slot}`];
        const attempt: SellerAnalysisAttempt = {
          slot: slot as 1 | 2,
          provider: config.provider,
          model: config.model,
          startedAt: new Date().toISOString(),
          completedAt: "",
          error: null,
          conversationTrace: null,
        };
        const result = await executeAiPrompt(
          analysisPrompt(doc.input, previous, feedback),
          {
            slotConfig: {
              ...config,
              timeoutSeconds: slot === primary
                ? 4
                : (config.type === "LOCAL" ? 20 : 15),
            },
            secretValue: secrets?.find((s) => s.slot_number === slot)
              ?.secret_value,
            onConversationTrace: (trace) => {
              attempt.conversationTrace = trace;
            },
          },
        );
        try {
          if (!result.content) {
            throw new Error(result.error || "AI 응답이 없습니다.");
          }
          report = parseAnalysisReport(result.content);
        } catch (e) {
          attempt.error = e instanceof Error ? e.message : String(e);
        }
        attempt.completedAt = new Date().toISOString();
        attempts.push(attempt);
        if (report) break;
      }
      if (!report) {
        throw new Error(
          attempts.at(-1)?.error || "모든 AI 분석에 실패했습니다.",
        );
      }
      const version = (doc.reports.at(-1)?.version || 0) + 1;
      const nextRevision = doc.revision + 1;
      doc = await save(
        {
          ...doc,
          revision: nextRevision,
          status: "REVIEW",
          currentReportVersion: version,
          lastError: null,
          updatedAt: new Date().toISOString(),
          reports: [...doc.reports, {
            version,
            inputRevision: nextRevision,
            input: doc.input,
            report,
            attempts,
            createdAt: now,
          }],
          messages: [...doc.messages, {
            id: crypto.randomUUID(),
            role: "ASSISTANT",
            content: report.summary,
            revision: nextRevision,
            reportVersion: version,
            attempts,
            createdAt: now,
          }],
        },
        doc.revision,
        auth.actorId,
      );
    } catch (e) {
      doc = await save(
        {
          ...doc,
          revision: doc.revision + 1,
          status: "FAILED",
          lastError: e instanceof Error ? e.message : String(e),
          updatedAt: new Date().toISOString(),
          messages: [...doc.messages, {
            id: crypto.randomUUID(),
            role: "SYSTEM",
            content: e instanceof Error ? e.message : String(e),
            revision: doc.revision + 1,
            reportVersion: null,
            attempts,
            createdAt: now,
          }],
        },
        doc.revision,
        auth.actorId,
      );
    }
    return successResponse({ analysis: doc });
  }
  const report = doc.reports.find((r) => r.version === body.reportVersion);
  if (
    !report || report.version !== doc.currentReportVersion ||
    doc.status !== "REVIEW"
  ) fail("STALE_REPORT", "최신 분석 보고서를 선택해 주세요.", 409);
  if (body.action === "seller-analysis-verify") {
    const decisions = verifyAnalysis(doc.input, report.report);
    const revision = doc.revision + 1;
    doc = await save(
      {
        ...doc,
        revision,
        updatedAt: now,
        reports: doc.reports.map((r) =>
          r.version === report.version
            ? {
              ...r,
              inputRevision: revision,
              verification: {
                decisions,
                reviewed: body.reviewed === true,
                verifiedAt: now,
              },
            }
            : r
        ),
      },
      doc.revision,
      auth.actorId,
    );
  } else if (body.action === "seller-analysis-approve") {
    if (
      !report.verification?.reviewed || report.inputRevision !== doc.revision ||
      report.report.supportAssessment === "NEW_MODULE_REQUIRED"
    ) {
      fail(
        "VERIFICATION_REQUIRED",
        "재생 검증 결과를 확인해야 승인할 수 있습니다. 새로운 모듈이 필요한 방식은 개발 후 다시 검증해 주세요.",
        409,
      );
    }
    doc = await save(
      {
        ...doc,
        revision: doc.revision + 1,
        status: "APPROVED",
        approvedRevision: doc.revision,
        approvedReportVersion: report.version,
        approvedAt: now,
        approvedBy: auth.actorId,
        updatedAt: now,
      },
      doc.revision,
      auth.actorId,
    );
  } else fail("VALIDATION_ERROR", "지원하지 않는 판매 분석 요청입니다.");
  return successResponse({ analysis: doc });
}
