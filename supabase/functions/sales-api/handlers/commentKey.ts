import {
  admin,
  successResponse,
  errorResponse,
  type AuthContext,
} from '../../_shared/productSales.ts';
import {
  COMMENT_KEY_NAME,
  COMMENT_TOKEN_SECONDS,
  jwtRequest,
  mergeCommentKey,
  normalizeTikTokId,
  publicCommentKey,
  readJwtResponse,
  type CommentKeyValue,
} from './commentKeyCore.ts';

const isGlobalAdmin = (auth: AuthContext) =>
  auth.actorType === 'USER' && auth.role === 'ADMIN';

async function readKeyRow() {
  const { data, error } = await admin
    .from('platform_secrets')
    .select('value,updated_at')
    .eq('name', COMMENT_KEY_NAME)
    .maybeSingle();
  if (error) throw error;
  return data as { value?: CommentKeyValue; updated_at?: string } | null;
}

async function mintJwt(
  value: CommentKeyValue,
  uniqueId: string,
  workspaceId: string,
) {
  const request = jwtRequest(value, uniqueId, workspaceId);
  try {
    const res = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(8000),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {}
    return readJwtResponse(res.status, json);
  } catch (e) {
    return { error: `연결 실패 · ${(e as Error).message || '시간 초과'}`.slice(0, 160) };
  }
}

/** 관리자 메뉴 "댓글 연결 키 (Euler)". 키 원문은 저장만 하고 돌려주지 않는다. */
export async function handleCommentKeyAdmin(auth: AuthContext, body: any) {
  if (!isGlobalAdmin(auth))
    return errorResponse(
      'CAPABILITY_DENIED',
      '관리자만 댓글 연결 키를 볼 수 있습니다.',
      403,
    );
  try {
    const row = await readKeyRow();
    if (body.action === 'comment-key-get')
      return successResponse(publicCommentKey(row));
    if (body.action === 'comment-key-save') {
      const merged = mergeCommentKey(row?.value || {}, body);
      if (merged.error) return errorResponse('VALIDATION_ERROR', merged.error);
      const updatedAt = new Date().toISOString();
      const { error } = await admin.from('platform_secrets').upsert(
        {
          name: COMMENT_KEY_NAME,
          value: merged.value,
          updated_by: auth.actorId,
          updated_at: updatedAt,
        },
        { onConflict: 'name' },
      );
      if (error) throw error;
      return successResponse(
        publicCommentKey({ value: merged.value, updated_at: updatedAt }),
      );
    }
    if (body.action === 'comment-key-test') {
      const value = row?.value || {};
      if (!value.apiKey)
        return errorResponse('NOT_CONFIGURED', '저장된 키가 없습니다.', 409);
      const uniqueId = normalizeTikTokId(body.uniqueId) || 'tiktok';
      if (!value.accountId)
        return successResponse({
          mode: 'KEY',
          ok: true,
          message:
            '계정 번호가 없어 짧은 토큰을 만들지 않고, 로그인한 판매 앱에 연결할 때마다 키를 넘깁니다.',
        });
      const minted = await mintJwt(value, uniqueId, auth.workspaceId || 'admin');
      return successResponse(
        'token' in minted
          ? { mode: 'JWT', ok: true, message: '짧은 토큰을 만들었습니다.' }
          : {
              mode: 'KEY',
              ok: false,
              message: `짧은 토큰을 만들지 못했습니다 (${minted.error}). 판매 앱에는 키를 넘겨 연결합니다.`,
            },
      );
    }
    return errorResponse('VALIDATION_ERROR', '알 수 없는 요청입니다.');
  } catch {
    return errorResponse(
      'DATABASE_ERROR',
      '댓글 연결 키를 읽지 못했습니다. DB 마이그레이션 적용 여부를 확인해 주세요.',
      500,
    );
  }
}

async function readTouchSettings(workspaceId: string) {
  const { data, error } = await admin
    .from('workspace_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('namespace', 'touch_sales')
    .maybeSingle();
  if (error) throw error;
  return (data?.value || {}) as Record<string, unknown>;
}

/** 판매 폰: 틱톡 ID 저장(touch-tiktok-id)과 댓글 연결 토큰 받기(touch-comment-token). PC 댓글 도우미 키(comment-helper-key). */
export async function handleCommentToken(auth: AuthContext, body: any) {
  const workspace = auth.workspaceId;
  // 기기 연결(문자 앱 등)은 댓글 연결 정보를 받지 않는다. 로그인한 판매자만.
  if (auth.actorType !== 'USER')
    return errorResponse('CAPABILITY_DENIED', '판매자 로그인이 필요합니다.', 403);
  if (!workspace)
    return errorResponse('VALIDATION_ERROR', '판매자 작업공간이 없습니다.');
  try {
    const settings = await readTouchSettings(workspace);
    if (body.action === 'touch-tiktok-id') {
      const tiktokId = normalizeTikTokId(body.uniqueId);
      if (!tiktokId)
        return errorResponse(
          'VALIDATION_ERROR',
          '틱톡 ID를 확인해 주세요. @ 뒤의 영문·숫자만 입력합니다.',
        );
      const { error } = await admin.from('workspace_settings').upsert(
        {
          workspace_id: workspace,
          namespace: 'touch_sales',
          value: { ...settings, tiktokId },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,namespace' },
      );
      if (error) throw error;
      return successResponse({ tiktokId });
    }
    if (body.action === 'comment-helper-key') {
      // 윈도우 댓글 도우미: 서명(sign)에 키 원문이 필요하다. 로그인한 판매자 웹이 연결할 때마다 받아
      // 도우미 메모리에만 넘긴다(폰 단독 판매와 같은 관리자 메뉴 키).
      const value = (await readKeyRow())?.value || {};
      if (!value.apiKey)
        return errorResponse('COMMENT_KEY_MISSING', '관리자 메뉴에 댓글 연결 키가 없습니다.', 409);
      return successResponse({ apiKey: value.apiKey });
    }
    const uniqueId = normalizeTikTokId(settings.tiktokId);
    if (!uniqueId)
      return errorResponse(
        'TIKTOK_ID_MISSING',
        '판매 설정에서 틱톡 ID를 먼저 저장해 주세요.',
        409,
      );
    const value = (await readKeyRow())?.value || {};
    if (!value.apiKey)
      return errorResponse(
        'COMMENT_KEY_MISSING',
        '댓글 연결이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.',
        409,
      );
    const expiresAt = Date.now() + COMMENT_TOKEN_SECONDS * 1000;
    if (value.accountId) {
      const minted = await mintJwt(value, uniqueId, workspace);
      if ('token' in minted)
        return successResponse({
          mode: 'JWT',
          uniqueId,
          jwtKey: minted.token,
          expiresAt,
        });
      console.warn('[comment-token] JWT 발급 실패, 키로 연결', minted.error);
    }
    // 계획서 대안: 로그인한 판매 앱에만 연결할 때마다 넘긴다. 앱은 키를 저장하지 않는다.
    return successResponse({ mode: 'KEY', uniqueId, apiKey: value.apiKey, expiresAt });
  } catch {
    return errorResponse(
      'DATABASE_ERROR',
      '댓글 연결 정보를 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
      500,
    );
  }
}
