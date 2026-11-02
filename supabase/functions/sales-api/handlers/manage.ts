import {
  admin,
  successResponse,
  errorResponse,
  type AuthContext,
} from '../../_shared/productSales.ts';
import { MANAGE_MESSAGES, validateManageRequest } from './manageCore.ts';

/** 관리탭 쓰기: 연락처 연결, 보관·출고, 정산서. 판매자 로그인(USER)만 쓸 수 있다. */
export async function handleManage(auth: AuthContext, action: string, body: Record<string, unknown>) {
  if (auth.actorType !== 'USER') {
    return errorResponse('CAPABILITY_DENIED', '판매자 로그인으로만 할 수 있는 작업입니다.', 403);
  }
  const checked = validateManageRequest(action, body);
  if (!checked.ok) {
    return errorResponse('VALIDATION_ERROR', MANAGE_MESSAGES.VALIDATION_ERROR, 400, { field: checked.reason });
  }
  const { data, error } = await admin.rpc('voicecap_manage', {
    p_workspace_id: auth.workspaceId,
    p_actor_id: auth.actorId,
    p_action: checked.dbAction,
    p_payload: checked.payload,
  });
  if (error) return errorResponse('DATABASE_ERROR', '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', 500, {}, true);
  const result = data as Record<string, unknown> | null;
  if (!result?.ok) {
    const code = String(result?.code || 'DATABASE_ERROR');
    return errorResponse(code, MANAGE_MESSAGES[code] || '작업 상태를 확인한 뒤 다시 시도해 주세요.', 409, result || {});
  }
  return successResponse(result);
}
