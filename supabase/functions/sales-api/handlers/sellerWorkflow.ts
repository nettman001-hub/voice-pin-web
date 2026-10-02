import {
  admin,
  type AuthContext,
  successResponse,
} from "../../_shared/productSales.ts";
import { requireAnalysisAdmin } from "./workflowAuthorization.ts";
import { replaySalesWorkflow } from "../../../../src/services/salesWorkflowEngine.ts";
import type {
  AppliedSalesWorkflow,
  WorkflowTranscript,
} from "../../../../src/types/salesWorkflow.ts";

export async function getWorkspaceWorkflow(
  workspaceId: string,
  sessionId?: string,
): Promise<AppliedSalesWorkflow | null> {
  if (sessionId) {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
      throw {
        code: "VALIDATION_ERROR",
        status: 400,
        message: "정식 방송 회차가 필요합니다.",
      };
    }
    const { data: pin, error } = await admin.rpc("voicecap_pin_workflow", {
      p_workspace: workspaceId,
      p_session: sessionId,
    });
    if (error) throw error;
    if (!pin?.ok) {
      throw {
        code: pin?.code || "SESSION_NOT_ACTIVE",
        status: 409,
        message: "진행 중인 방송 회차를 확인해 주세요.",
      };
    }
    if (pin.profileId) {
      const { data: p, error: pe } = await admin.from(
        "seller_workflow_profiles",
      ).select("*").eq("id", pin.profileId).single();
      if (pe) throw pe;
      return {
        id: p.id,
        version: p.report_version,
        profile: p.profile,
        mode: "ACTIVE",
      };
    }
  }
  const { data: ws, error: wsError } = await admin.from("workspaces").select(
    "owner_id",
  ).eq("id", workspaceId).maybeSingle();
  if (wsError) throw wsError;
  if (!ws) return null;
  const { data: d, error } = await admin.from("seller_workflow_deployments")
    .select("profile_id,mode").eq("seller_user_id", ws.owner_id).maybeSingle();
  if (error) throw error;
  if (!d || d.mode === "DEFAULT") return null;
  const { data: p, error: pe } = await admin.from("seller_workflow_profiles")
    .select("*").eq("id", d.profile_id).single();
  if (pe) throw pe;
  return {
    id: p.id,
    version: p.report_version,
    profile: p.profile,
    mode: d.mode,
  };
}
export async function getWorkflowEvents(
  workspaceId: string,
  sessionId: string,
  options: {
    profile?: AppliedSalesWorkflow["profile"];
    endAt?: string;
  } = {},
) {
  const { data: setting, error: se } = await admin.from("workspace_settings")
    .select("value").eq("workspace_id", workspaceId).eq(
      "namespace",
      `session_transcripts_${sessionId}`,
    ).maybeSingle();
  if (se) throw se;
  const eligible: WorkflowTranscript[] = (setting?.value?.logs || []).filter((
    t: any,
  ) =>
    t.workflowEligible !== false && t.isFinal !== false &&
    Number.isFinite(Date.parse(t.recognizedAt))
  ).map((t: any) => ({
    id: t.id,
    text: t.text,
    recognizedAt: t.recognizedAt,
    isFinal: t.isFinal,
  }));
  const end = options.endAt
    ? Math.min(Date.now(), Date.parse(options.endAt))
    : Math.max(0, ...eligible.map((t) => Date.parse(t.recognizedAt)));
  const start = end -
    ((options.profile?.offerLifetimeSeconds || 600) +
        (options.profile?.requestWindowSeconds || 300)) * 1000;
  const transcripts = eligible.filter((t) =>
    Date.parse(t.recognizedAt) >= start && Date.parse(t.recognizedAt) <= end
  );
  const { data: comments, error: ce, count } = await admin.from("live_comments")
    .select(
      "id,session_id,platform_message_id,buyer_id,nickname_snapshot,content,captured_at",
      { count: "exact" },
    ).eq("workspace_id", workspaceId).eq("session_id", sessionId)
    .gte("captured_at", new Date(start).toISOString()).lte(
      "captured_at",
      new Date(end + 10_000).toISOString(),
    ).order("captured_at").limit(10001);
  if (ce) throw ce;
  if ((count || 0) > 10000 || transcripts.length > 10000) {
    throw {
      code: "CONTEXT_TOO_LARGE",
      status: 409,
      message: "분석 구간이 너무 큽니다. 확인이 필요합니다.",
    };
  }
  return {
    transcripts,
    comments: (comments || []).map((c: any) => ({
      id: c.id,
      sessionId: c.session_id,
      platformMessageId: c.platform_message_id,
      buyerId: c.buyer_id,
      nickname: c.nickname_snapshot,
      content: c.content,
      capturedAt: c.captured_at,
    })),
  };
}
export async function handleSellerWorkflow(auth: AuthContext, body: any) {
  if (body.action === "seller-workflow-current") {
    return successResponse({
      workflow: await getWorkspaceWorkflow(auth.workspaceId, body.sessionId),
    });
  }
  if (body.action === "seller-workflow-observe") {
    const workflow = await getWorkspaceWorkflow(auth.workspaceId);
    if (!workflow || workflow.mode !== "SHADOW") {
      return successResponse({ skipped: true });
    }
    const { data: session, error } = await admin.from("live_sessions").select(
      "id",
    ).eq("id", body.sessionId).eq("workspace_id", auth.workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (!session) {
      throw {
        code: "NOT_FOUND",
        status: 404,
        message: "방송 회차를 찾지 못했습니다.",
      };
    }
    const { data: ws } = await admin.from("workspaces").select("owner_id").eq(
      "id",
      auth.workspaceId,
    ).single();
    const events = await getWorkflowEvents(auth.workspaceId, body.sessionId, {
      profile: workflow.profile,
    });
    const decisions = replaySalesWorkflow({
      sessionId: body.sessionId,
      profile: workflow.profile,
      ...events,
    });
    const { error: e } = await admin.from("seller_workflow_observations")
      .upsert({
        seller_user_id: ws!.owner_id,
        profile_id: workflow.id,
        session_id: body.sessionId,
        decisions: decisions.slice(-500),
      }, { onConflict: "profile_id,session_id" });
    if (e) throw e;
    return successResponse({ decisions });
  }
  requireAnalysisAdmin(auth);
  if (body.action === "seller-workflow-state") {
    const { data: deployment, error } = await admin.from(
      "seller_workflow_deployments",
    ).select("*").eq("seller_user_id", body.sellerUserId).maybeSingle();
    if (error) throw error;
    const { data: profiles, error: pe } = await admin.from(
      "seller_workflow_profiles",
    ).select("*").eq("seller_user_id", body.sellerUserId).order("created_at", {
      ascending: false,
    }).limit(30);
    if (pe) throw pe;
    const { data: observations, error: oe } = await admin.from(
      "seller_workflow_observations",
    ).select("*").eq("seller_user_id", body.sellerUserId).order("created_at", {
      ascending: false,
    }).limit(10);
    if (oe) throw oe;
    return successResponse({ deployment, profiles, observations });
  }
  let profileId = body.profileId;
  let seller = body.sellerUserId;
  if (body.action === "seller-workflow-deploy") {
    const { data: a, error } = await admin.from("seller_workflow_analyses")
      .select("document").eq("id", body.analysisId).single();
    if (error) throw error;
    const doc = a.document;
    const report = doc.reports.find((r: any) =>
      r.version === body.reportVersion
    );
    seller = doc.input.sellerUserId;
    if (
      !seller || doc.status !== "APPROVED" ||
      doc.approvedReportVersion !== body.reportVersion ||
      !report?.verification?.reviewed
    ) {
      throw {
        code: "APPROVAL_REQUIRED",
        status: 409,
        message: "등록 판매자의 검증·승인된 보고서만 적용할 수 있습니다.",
      };
    }
    const { data: p, error: pe } = await admin.from("seller_workflow_profiles")
      .upsert({
        seller_user_id: seller,
        analysis_id: doc.id,
        report_version: report.version,
        profile: report.report.profile,
        created_by: auth.actorId,
      }, { onConflict: "analysis_id,report_version" }).select("id").single();
    if (pe) throw pe;
    profileId = p.id;
  }
  const { data: d, error: de } = await admin.from("seller_workflow_deployments")
    .select("*").eq("seller_user_id", seller).maybeSingle();
  if (de) throw de;
  if (body.expectedRevision !== (d?.revision || 0)) {
    throw {
      code: "REVISION_CONFLICT",
      status: 409,
      message: "적용 설정이 변경되었습니다. 새로 불러와 주세요.",
    };
  }
  let mode = "SHADOW";
  if (body.action === "seller-workflow-review-shadow") {
    if (!d || d.mode !== "SHADOW") {
      throw {
        code: "VALIDATION_ERROR",
        status: 400,
        message: "관찰 중인 설정이 없습니다.",
      };
    }
    const { data: observations, error } = await admin.from(
      "seller_workflow_observations",
    ).select("decisions").eq("profile_id", d.profile_id).limit(10);
    if (error) throw error;
    if (!observations?.some((o) => o.decisions.length > 0)) {
      throw {
        code: "OBSERVATION_REQUIRED",
        status: 409,
        message: "실제 방송의 관찰 결과가 있어야 확인할 수 있습니다.",
      };
    }
    profileId = d.profile_id;
  } else if (body.action === "seller-workflow-activate") {
    profileId = d?.profile_id;
    mode = "ACTIVE";
  } else if (body.action === "seller-workflow-rollback") {
    profileId = d?.previous_profile_id || d?.profile_id;
    mode = d?.previous_profile_id ? "ACTIVE" : "DEFAULT";
  } else if (body.action !== "seller-workflow-deploy") {
    throw {
      code: "VALIDATION_ERROR",
      status: 400,
      message: "지원하지 않는 적용 요청입니다.",
    };
  }
  if (!profileId) {
    throw {
      code: "NOT_FOUND",
      status: 404,
      message: "적용할 설정 버전이 없습니다.",
    };
  }
  const { data, error } = await admin.rpc("voicecap_deploy_workflow", {
    p_seller: seller,
    p_profile: profileId,
    p_mode: mode,
    p_expected_revision: body.expectedRevision,
    p_actor: auth.actorId,
    p_shadow_reviewed: body.action === "seller-workflow-review-shadow",
  });
  if (error) throw error;
  if (!data.ok) {
    throw {
      code: data.code,
      status: 409,
      message: "관찰 검증 또는 설정 버전을 확인해 주세요.",
    };
  }
  return successResponse({ ok: true });
}
