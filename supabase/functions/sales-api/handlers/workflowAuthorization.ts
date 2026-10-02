import type { AuthContext } from "../../_shared/productSales.ts";

export function requireAnalysisAdmin(auth: AuthContext) {
  if (auth.actorType !== "USER" || auth.role !== "ADMIN") {
    throw {
      code: "FORBIDDEN",
      status: 403,
      message: "관리자만 판매방식을 분석·승인·적용할 수 있습니다.",
    };
  }
}
