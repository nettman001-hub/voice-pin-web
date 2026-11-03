import {
  admin,
  successResponse,
  errorResponse,
  sha256,
  type AuthContext,
} from '../../_shared/productSales.ts';
import { readCommentApiKey } from './commentKey.ts';
import {
  HELPER_CAPABILITY,
  HELPER_ERRORS,
  cleanCollectorState,
  cleanHelperName,
  cleanInstallId,
  cleanPhoneName,
  isSecret,
  isUuid,
  newPairCode,
  newRegistrationCode,
  newSecretToken,
  normalizePairCode,
  normalizeRegistrationCode,
  pairCodeHashInput,
  registrationCodeHashInput,
  validatePushBatch,
} from './helperLinkCore.ts';

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw error;
  return data as Record<string, any>;
}

function respond(result: Record<string, any>) {
  if (result?.ok) {
    const { ok: _ok, ...rest } = result;
    return successResponse(rest);
  }
  const code = String(result?.code || 'TEMPORARILY_UNAVAILABLE');
  const known = HELPER_ERRORS[code];
  return errorResponse(
    code,
    known?.message || '잠시 뒤 다시 시도해 주세요.',
    known?.status || 500,
    { generation: result?.generation ?? undefined, status: result?.status ?? undefined },
    known?.retryable ?? !known,
  );
}

function clientKey(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '';
  return forwarded.split(',')[0].trim().slice(0, 64);
}

/** 로그인 없이: 도우미가 등록을 시작하고(확인코드 받기) 결과를 확인한다. */
export async function handleHelperPublic(req: Request, body: any) {
  try {
    if (body.action === 'helper-register-begin') {
      if (!isSecret(body.secret, 'hrs'))
        return errorResponse('VALIDATION_ERROR', '등록 비밀값이 올바르지 않습니다.');
      const client = clientKey(req);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const code = newRegistrationCode();
        const result = await rpc('voicecap_helper_register_begin', {
          p_code_hash: await sha256(registrationCodeHashInput(code)),
          p_secret_hash: await sha256(body.secret),
          p_name: cleanHelperName(body.helperName),
          p_version: typeof body.appVersion === 'string' ? body.appVersion.slice(0, 40) : null,
          p_client: client ? await sha256(`client:${client}`) : null,
        });
        if (result.code === 'CODE_COLLISION') continue;
        if (!result.ok) return respond(result);
        return successResponse({ registrationId: result.registrationId, code, expiresAt: result.expiresAt });
      }
      return respond({ ok: false, code: 'CODE_COLLISION' });
    }
    if (body.action === 'helper-register-poll') {
      if (!isUuid(body.registrationId) || !isSecret(body.secret, 'hrs'))
        return errorResponse('VALIDATION_ERROR', '등록 요청 정보가 올바르지 않습니다.');
      // 기기 토큰은 승인된 요청에서 딱 한 번 만든다. 원문은 이 응답에만 있고 서버에는 해시만 남는다.
      const token = newSecretToken('vchd');
      const result = await rpc('voicecap_helper_register_complete', {
        p_id: body.registrationId,
        p_secret_hash: await sha256(body.secret),
        p_token_hash: await sha256(token),
      });
      if (!result.ok) return respond(result);
      if (result.status !== 'REGISTERED') return successResponse({ status: result.status });
      return successResponse({
        status: 'REGISTERED',
        deviceToken: token,
        deviceId: result.deviceId,
        workspaceId: result.workspaceId,
        workspaceName: result.workspaceName,
        helperName: result.helperName,
      });
    }
    return errorResponse('VALIDATION_ERROR', '알 수 없는 요청입니다.');
  } catch {
    return errorResponse('TEMPORARILY_UNAVAILABLE', '도우미 등록 서버에 연결하지 못했습니다.', 500, {}, true);
  }
}

/** 등록된 도우미 기기만. 작업공간·기기는 토큰으로 정하고 본문 값을 믿지 않는다. */
export async function handleHelperDevice(auth: AuthContext, body: any) {
  if (auth.actorType !== 'DEVICE' || !auth.deviceId || !auth.capabilities.has(HELPER_CAPABILITY))
    return errorResponse('CAPABILITY_DENIED', '등록된 PC 댓글도우미만 사용할 수 있습니다.', 403);
  const device = auth.deviceId;
  try {
    switch (body.action) {
      case 'helper-heartbeat':
        return respond(await rpc('voicecap_helper_heartbeat', { p_device: device, p_state: cleanCollectorState(body.state) }));
      case 'helper-set-enabled':
        if (typeof body.enabled !== 'boolean') return errorResponse('VALIDATION_ERROR', 'enabled는 true 또는 false입니다.');
        return respond(await rpc('voicecap_helper_set_enabled', { p_device: device, p_enabled: body.enabled }));
      case 'helper-pair-issue': {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const code = newPairCode();
          const result = await rpc('voicecap_helper_pair_issue', {
            p_device: device,
            p_code_hash: await sha256(pairCodeHashInput(auth.workspaceId, code)),
          });
          if (result.code === 'CODE_COLLISION') continue;
          if (!result.ok) return respond(result);
          return successResponse({ code, expiresAt: result.expiresAt });
        }
        return respond({ ok: false, code: 'CODE_COLLISION' });
      }
      case 'helper-pair-cancel':
        return respond(await rpc('voicecap_helper_pair_cancel', { p_device: device }));
      case 'helper-pair-decide':
        if (!isUuid(body.linkId) || typeof body.approve !== 'boolean')
          return errorResponse('VALIDATION_ERROR', '승인할 폰 요청을 확인해 주세요.');
        return respond(await rpc('voicecap_helper_pair_decide', { p_device: device, p_link: body.linkId, p_approve: body.approve }));
      case 'helper-unlink':
        if (!isUuid(body.linkId)) return errorResponse('VALIDATION_ERROR', '해제할 폰을 확인해 주세요.');
        return respond(await rpc('voicecap_helper_unlink', { p_device: device, p_link: body.linkId, p_actor_user: null }));
      case 'helper-unregister':
        return respond(await rpc('voicecap_helper_unregister', { p_device: device }));
      case 'helper-push': {
        const checked = validatePushBatch(body);
        if ('error' in checked) return errorResponse('VALIDATION_ERROR', checked.error);
        return respond(await rpc('voicecap_helper_push', {
          p_device: device,
          p_session: body.sessionId,
          p_generation: body.generation,
          p_comments: checked.comments,
        }));
      }
      case 'helper-comment-key': {
        // 브라우저 없이 재시작한 도우미가 틱톡 서명 키를 받는다. 메모리에만 두고 저장하지 않는다.
        const apiKey = await readCommentApiKey();
        if (!apiKey) return errorResponse('COMMENT_KEY_MISSING', '관리자 메뉴에 댓글 연결 키가 없습니다.', 409);
        return successResponse({ apiKey });
      }
    }
    return errorResponse('VALIDATION_ERROR', '알 수 없는 요청입니다.');
  } catch {
    return errorResponse('TEMPORARILY_UNAVAILABLE', '도우미 연결 서버 오류입니다. 잠시 뒤 다시 시도합니다.', 500, {}, true);
  }
}

/** 로그인한 판매자(웹·폰). 폰 연결 토큰은 본문 linkToken으로 받고 해시로만 비교한다. */
export async function handleHelperUser(auth: AuthContext, body: any) {
  if (auth.actorType !== 'USER' || !auth.workspaceId)
    return errorResponse('CAPABILITY_DENIED', '판매자 로그인이 필요합니다.', 403);
  const ws = auth.workspaceId;
  const user = auth.actorId;
  try {
    if (body.action === 'helper-register-approve') {
      if (!['OWNER', 'MANAGER', 'ADMIN'].includes(auth.role || ''))
        return errorResponse('CAPABILITY_DENIED', '대표 또는 매니저 계정만 PC 도우미를 등록할 수 있습니다.', 403);
      const code = normalizeRegistrationCode(body.code);
      if (!code) return errorResponse('VALIDATION_ERROR', '도우미 화면의 확인코드 8자리를 입력해 주세요.');
      return respond(await rpc('voicecap_helper_register_approve', {
        p_workspace: ws,
        p_user: user,
        p_code_hash: await sha256(registrationCodeHashInput(code)),
      }));
    }
    if (body.action === 'helper-pair-claim') {
      const code = normalizePairCode(body.code);
      const installId = cleanInstallId(body.installId);
      if (!code || !installId) return errorResponse('VALIDATION_ERROR', '도우미 화면의 인증번호 6자리를 입력해 주세요.');
      const token = newSecretToken('vcpl');
      const result = await rpc('voicecap_helper_pair_claim', {
        p_workspace: ws,
        p_user: user,
        p_code_hash: await sha256(pairCodeHashInput(ws, code)),
        p_install_id: installId,
        p_phone_name: cleanPhoneName(body.phoneName),
        p_token_hash: await sha256(token),
      });
      if (!result.ok) return respond(result);
      // 승인 전이라도 토큰을 먼저 준다. 서버는 PC가 승인한 뒤에만 이 토큰으로 댓글을 내준다.
      return successResponse({ linkToken: token, linkId: result.linkId, status: 'PENDING', helperName: result.helperName });
    }
    if (!isSecret(body.linkToken, 'vcpl'))
      return errorResponse('LINK_NOT_ACTIVE', 'PC 댓글도우미 연결 정보가 없습니다. 폰을 다시 연결해 주세요.', 403);
    const tokenHash = await sha256(body.linkToken);
    switch (body.action) {
      case 'helper-phone-status':
        return respond(await rpc('voicecap_helper_phone_status', { p_workspace: ws, p_user: user, p_token_hash: tokenHash }));
      case 'helper-attach':
      case 'helper-detach':
        if (!isUuid(body.sessionId) || !isUuid(body.producerId))
          return errorResponse('VALIDATION_ERROR', '판매 회차 정보가 올바르지 않습니다.');
        return respond(await rpc('voicecap_helper_attach', {
          p_workspace: ws,
          p_user: user,
          p_token_hash: tokenHash,
          p_session: body.sessionId,
          p_producer: body.producerId,
          p_detach: body.action === 'helper-detach',
          // 판매 시작의 첫 연결이면 PC 도우미 댓글 연결을 켠다(종료하면 detach가 끈다).
          p_start: body.action === 'helper-attach' && body.start === true,
        }));
      case 'helper-pull': {
        if (!isUuid(body.sessionId)) return errorResponse('VALIDATION_ERROR', '판매 회차 정보가 올바르지 않습니다.');
        const after = body.after == null ? null : Number(body.after);
        if (after !== null && (!Number.isSafeInteger(after) || after < 0))
          return errorResponse('VALIDATION_ERROR', '커서가 올바르지 않습니다.');
        return respond(await rpc('voicecap_helper_pull', {
          p_workspace: ws,
          p_user: user,
          p_token_hash: tokenHash,
          p_session: body.sessionId,
          p_after: after,
          p_tail: Math.max(0, Math.min(500, Number.isInteger(body.tail) ? body.tail : 100)),
          p_limit: Math.max(1, Math.min(1000, Number.isInteger(body.limit) ? body.limit : 500)),
        }));
      }
      case 'helper-phone-unlink': {
        const status = await rpc('voicecap_helper_phone_status', { p_workspace: ws, p_user: user, p_token_hash: tokenHash });
        if (!status.ok || !status.linkId || !status.helperDeviceId) return successResponse({ status: status.linkStatus || 'REVOKED' });
        return respond(await rpc('voicecap_helper_unlink', { p_device: status.helperDeviceId, p_link: status.linkId, p_actor_user: user }));
      }
    }
    return errorResponse('VALIDATION_ERROR', '알 수 없는 요청입니다.');
  } catch {
    return errorResponse('TEMPORARILY_UNAVAILABLE', 'PC 댓글도우미 연결 서버 오류입니다. 잠시 뒤 다시 시도합니다.', 500, {}, true);
  }
}
