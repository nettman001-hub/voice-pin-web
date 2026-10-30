import {
  admin,
  successResponse,
  errorResponse,
  type AuthContext,
} from '../../_shared/productSales.ts';
import {
  validateTouchCommit,
  parseTouchPrice,
  cleanTouchRunSettings,
} from './touchSalesCore.ts';

const messages: Record<string, string> = {
  SESSION_ENDED: '판매 중인 회차가 없습니다. 판매 화면에서 회차를 확인해 주세요.',
  TOUCH_NOT_RUNNING: '판매 연결이 멈췄습니다. 판매 화면에서 다시 시작해 주세요.',
  COMMENT_ALREADY_COMMITTED:
    '이미 이 댓글로 판매했습니다. 추가 판매로 저장할 수 있습니다.',
  PC_ALREADY_RUNNING: '다른 기기 또는 탭에서 판매 중입니다.',
  PC_LEASE_LOST: '다른 기기로 판매 연결이 변경되었습니다.',
  CLOCK_INVALID: '기기 시각을 맞춘 뒤 다시 시도해 주세요.',
  REVISION_CONFLICT:
    '다른 화면에서 수정했습니다. 새로고침 후 다시 시도해 주세요.',
  OPERATION_PAYLOAD_MISMATCH: '같은 작업 번호로 다른 판매를 보낼 수 없습니다.',
  COMMENT_IDENTITY_CONFLICT: '댓글 계정 정보가 일치하지 않습니다.',
  PRINT_ALREADY_PENDING: '아직 처리 중인 전표가 있습니다.',
  CAPTURE_LEASE_LOST: '사진을 촬영하는 기기의 판매 연결을 확인해 주세요.',
};
async function rpc(name: string, params: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, params);
  if (error)
    throw Object.assign(new Error(error.message), {
      code: error.message.includes('COMMENT_IDENTITY_CONFLICT')
        ? 'COMMENT_IDENTITY_CONFLICT'
        : 'DATABASE_ERROR',
    });
  return data;
}
function respond(result: any) {
  if (!result?.ok)
    return errorResponse(
      result?.code || 'DATABASE_ERROR',
      messages[result?.code] || '작업 상태를 확인한 뒤 다시 시도해 주세요.',
      409,
      result,
    );
  return successResponse(result);
}
const stateKeys = [
  'running',
  'producerId',
  'sessionId',
  'displayCode',
  'helperConnected',
  'commentStatus',
  'screenConnected',
  'printerConnected',
  'delaySeconds',
  'delaySource',
  'prepareSeconds',
  'totalCount',
  'totalAmount',
  'transport',
  'phoneCount',
  // 폰 단독 판매: 폰이 댓글·전표·사진을 맡는다. 다시 찍기는 지금 + 카운트다운.
  'phoneOnly',
];
function cleanState(input: any) {
  return Object.fromEntries(
    stateKeys
      .filter((k) =>
        ['number', 'boolean', 'string'].includes(typeof input?.[k]),
      )
      .map((k) => [
        k,
        typeof input[k] === 'string' ? input[k].slice(0, 100) : input[k],
      ]),
  );
}
async function listSales(workspaceId: string, sessionId: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin
      .from('sales')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('session_id', sessionId)
      .order('recognized_at', { ascending: false })
      .order('id')
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const detailMap = new Map<string, any>();
  for (let offset = 0; offset < rows.length; offset += 200) {
    const { data, error } = await admin
      .from('touch_sale_details')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in(
        'sale_id',
        rows.slice(offset, offset + 200).map((r) => r.id),
      );
    if (error) throw error;
    for (const d of data || []) detailMap.set(d.sale_id, d);
  }
  const imagePaths = [
    ...new Set<string>(
      rows
        .map(
          (s) => detailMap.get(s.id)?.image_path || s.capture_image_paths?.[0],
        )
        .filter(
          (p) =>
            typeof p === 'string' && !/^(https?:\/\/|data:image\/)/.test(p),
        ),
    ),
  ];
  const imageUrls = new Map<string, string>();
  for (let offset = 0; offset < imagePaths.length; offset += 100) {
    const { data } = await admin.storage
      .from('voicecap-private')
      .createSignedUrls(imagePaths.slice(offset, offset + 100), 1800);
    for (const image of data || [])
      if (image.path && image.signedUrl)
        imageUrls.set(image.path, image.signedUrl);
  }
  return rows.map((s) => {
    const d = detailMap.get(s.id);
    let imageUrl = '';
    const imagePath = d?.image_path || s.capture_image_paths?.[0];
    if (imagePath) {
      imageUrl = /^(https?:\/\/|data:image\/)/.test(imagePath)
        ? imagePath
        : imageUrls.get(imagePath) || '';
    }
    return {
      id: s.id,
      sessionId: s.session_id,
      buyerId: s.buyer_id,
      buyerNickname: s.buyer_nickname,
      amount: s.amount,
      unitPrice: s.unit_price,
      quantity: s.quantity,
      recognizedAt: s.recognized_at,
      productName: s.product_name_snapshot || s.product_name,
      status: s.status,
      printStatus: s.print_status,
      captureStatus: d?.capture_status || (imageUrl ? 'CAPTURED' : 'NONE'),
      captureDueAt: d?.capture_due_at,
      imageUrl,
      revision: s.revision,
      comment: d?.comment,
      history: s.history || [],
      touchSale: !!d,
      source: s.source,
      recordState: s.record_state,
      reviewDecision: s.ai_verification?.reviewDecision,
    };
  });
}

export async function handleTouchSales(auth: AuthContext, body: any) {
  if (auth.actorType !== 'USER' || !auth.workspaceId)
    return errorResponse(
      'AUTH_REQUIRED',
      '판매자 계정으로 로그인해 주세요.',
      403,
    );
  const workspace = auth.workspaceId;
  try {
    if (body.action === 'touch-time')
      return successResponse({
        receivedAt: body.__serverReceivedAt,
        sentAt: Date.now(),
      });
    if (body.action === 'touch-sale-detail') {
      const { data: sale, error: saleError } = await admin
        .from('sales')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('id', body.saleId)
        .maybeSingle();
      if (saleError) throw saleError;
      if (!sale) return errorResponse('NOT_FOUND', '판매내역이 없습니다.', 404);
      const [history, invoices, payments, context] = await Promise.all([
        admin
          .from('sale_revisions')
          .select(
            'old_revision,new_revision,before_value,after_value,reason,created_at',
          )
          .eq('workspace_id', workspace)
          .eq('sale_id', sale.id)
          .order('created_at', { ascending: false })
          .limit(50),
        admin
          .from('invoices')
          .select('id')
          .eq('workspace_id', workspace)
          .contains('sale_ids', JSON.stringify([sale.id]))
          .limit(1),
        admin
          .from('payment_receipts')
          .select('id')
          .eq('workspace_id', workspace)
          .contains('sale_ids', JSON.stringify([sale.id]))
          .limit(1),
        admin
          .from('touch_sale_details')
          .select('entry_context')
          .eq('workspace_id', workspace)
          .eq('sale_id', sale.id)
          .maybeSingle(),
      ]);
      for (const result of [history, invoices, payments, context])
        if (result.error) throw result.error;
      return successResponse({
        history: history.data || [],
        settlementUsed: !!invoices.data?.length || !!payments.data?.length,
        entryContext: context.data?.entry_context || {},
      });
    }
    if (body.action === 'touch-bootstrap') {
      const [
        { data: run, error: runError },
        { data: session, error: sessionError },
      ] = await Promise.all([
        admin
          .from('touch_sales_runs')
          .select('*')
          .eq('workspace_id', workspace)
          .maybeSingle(),
        admin
          .from('live_sessions')
          .select('*')
          .eq('workspace_id', workspace)
          .eq('status', 'ACTIVE')
          .maybeSingle(),
      ]);
      if (runError || sessionError) throw runError || sessionError;
      let product = null;
      if (session?.active_product_id) {
        const { data } = await admin
          .from('products')
          .select('*')
          .eq('workspace_id', workspace)
          .eq('id', session.active_product_id)
          .maybeSingle();
        if (data)
          product = {
            id: data.id,
            productCode: data.product_code,
            name: data.name,
            unitPrice: data.unit_price,
            revision: data.revision,
          };
      }
      return successResponse({
        run,
        session,
        product,
        sales: session ? await listSales(workspace, session.id) : [],
        serverNow: Date.now(),
      });
    }
    if (body.action === 'touch-voice-presence') {
      const { data: session } = await admin
        .from('live_sessions')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('id', body.sessionId)
        .maybeSingle();
      if (!session)
        return errorResponse('SESSION_ENDED', '유효한 회차가 없습니다.', 409);
      const { error } = await admin
        .from('touch_voice_presence')
        .upsert({
          workspace_id: workspace,
          session_id: session.id,
          producer_id: body.producerId,
          running: body.running === true,
          updated_at: new Date().toISOString(),
        });
      if (error) throw error;
      return successResponse({ ok: true });
    }
    if (body.action === 'commit-touch-sale') {
      const error = validateTouchCommit(body.sale || {});
      if (error) return errorResponse('VALIDATION_ERROR', error);
      return respond(
        await rpc('voicecap_commit_touch_sale', {
          p_workspace_id: workspace,
          p_actor_id: auth.actorId,
          p_payload: body.sale,
        }),
      );
    }
    if (body.action === 'touch-run') {
      if (
        !['START', 'HEARTBEAT', 'STOP'].includes(body.kind) ||
        !/^[0-9a-f-]{36}$/i.test(body.producerId || '')
      )
        return errorResponse(
          'VALIDATION_ERROR',
          '판매 기기 연결 정보가 올바르지 않습니다.',
        );
      const settings = cleanTouchRunSettings(body.settings);
      const state = cleanState(body.state);
      if (typeof state.delaySeconds === 'number')
        state.delaySeconds = Math.max(0, Math.min(20, state.delaySeconds));
      return respond(
        await rpc('voicecap_touch_run', {
          p_workspace_id: workspace,
          p_producer_id: body.producerId,
          p_session_id: body.sessionId,
          p_kind: body.kind,
          p_state: { settings, state },
        }),
      );
    }
    if (body.action === 'claim-touch-jobs')
      return respond(
        await rpc('voicecap_claim_touch_jobs', {
          p_workspace_id: workspace,
          p_producer_id: body.producerId,
          p_limit: 10,
        }),
      );
    if (body.action === 'touch-print')
      return respond(
        await rpc('voicecap_touch_print', {
          p_workspace_id: workspace,
          p_job_id: body.jobId,
          p_lease: body.leaseToken,
          p_kind: body.kind,
          p_result: body.result || null,
        }),
      );
    if (body.action === 'touch-record-print') {
      if (
        typeof body.saleId !== 'string' ||
        !body.saleId ||
        !['SUCCESS', 'FAILED'].includes(body.result)
      )
        return errorResponse('VALIDATION_ERROR', '출력 결과를 확인해 주세요.');
      return respond(
        await rpc('voicecap_touch_record_print', {
          p_workspace_id: workspace,
          p_actor_id: auth.actorId,
          p_sale_id: body.saleId,
          p_result: body.result,
        }),
      );
    }
    if (body.action === 'claim-touch-captures')
      return respond(
        await rpc('voicecap_claim_touch_captures', {
          p_workspace_id: workspace,
          p_producer_id: body.producerId,
        }),
      );
    if (body.action === 'touch-capture-save') {
      const { data: detail } = await admin
        .from('touch_sale_details')
        .select('*')
        .eq('workspace_id', workspace)
        .eq('sale_id', body.saleId)
        .maybeSingle();
      if (
        !detail ||
        detail.capture_owner !== body.producerId ||
        detail.capture_status !== 'PENDING' ||
        detail.capture_generation !== body.generation ||
        Date.parse(detail.capture_lease_expires_at || '') < Date.now()
      )
        return errorResponse(
          'CAPTURE_LEASE_LOST',
          messages.CAPTURE_LEASE_LOST,
          409,
        );
      let path: string | null = null;
      if (body.image) {
        if (
          typeof body.image !== 'string' ||
          body.image.length > 4 * 1024 * 1024 ||
          !body.image.startsWith('data:image/jpeg;base64,')
        )
          return errorResponse(
            'VALIDATION_ERROR',
            '4MB 이하 JPEG 사진이 필요합니다.',
          );
        const bytes = Uint8Array.from(atob(body.image.split(',')[1]), (c) =>
          c.charCodeAt(0),
        );
        if (bytes[0] !== 255 || bytes[1] !== 216)
          return errorResponse(
            'VALIDATION_ERROR',
            'JPEG 사진이 올바르지 않습니다.',
          );
        path = `${workspace}/touch-sales/${body.saleId}/${crypto.randomUUID()}.jpg`;
        const { error } = await admin.storage
          .from('voicecap-private')
          .upload(path, bytes, { contentType: 'image/jpeg' });
        if (error) throw error;
      }
      let result;
      try {
        result = await rpc('voicecap_touch_capture', {
          p_workspace_id: workspace,
          p_producer_id: body.producerId,
          p_sale_id: body.saleId,
          p_status: path ? 'CAPTURED' : 'MISSING',
          p_path: path,
          p_captured_at: body.capturedAt || null,
          p_generation: body.generation,
        });
      } catch (e) {
        if (path) await admin.storage.from('voicecap-private').remove([path]);
        throw e;
      }
      if (!result.ok && path)
        await admin.storage.from('voicecap-private').remove([path]);
      if (
        result.ok &&
        path &&
        result.previousPath &&
        result.previousPath !== path
      )
        await admin.storage
          .from('voicecap-private')
          .remove([result.previousPath]);
      return respond(result);
    }
    if (body.action === 'touch-capture-reset') {
      const { data: run } = await admin
        .from('touch_sales_runs')
        .select('*')
        .eq('workspace_id', workspace)
        .maybeSingle();
      const { data: sale } = await admin
        .from('sales')
        .select('id,record_state')
        .eq('workspace_id', workspace)
        .eq('id', body.saleId)
        .maybeSingle();
      if (!run?.running || sale?.record_state !== 'ACTIVE')
        return errorResponse(
          'NOT_FOUND',
          '판매 내역과 판매 기기 연결을 확인해 주세요.',
          409,
        );
      const delay = Math.max(
        0,
        Math.min(
          20,
          Number(
            run.last_state?.phoneOnly === true
              ? (run.settings?.prepareSeconds ?? 4)
              : (run.last_state?.delaySeconds ??
                  run.settings.fallbackDelaySeconds ??
                  6),
          ),
        ),
      );
      const { error } = await admin
        .from('touch_sale_details')
        .update({
          capture_status: 'PENDING',
          capture_due_at: new Date(Date.now() + delay * 1000).toISOString(),
          capture_owner: null,
          capture_lease_expires_at: null,
          capture_generation: crypto.randomUUID(),
          recapture: true,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspace)
        .eq('sale_id', body.saleId);
      if (error) throw error;
      return successResponse({ ok: true });
    }
    if (body.action === 'update-touch-sale') {
      if (
        body.patch?.kind === 'FIELDS' &&
        (!Number.isInteger(body.patch.unitPrice) ||
          body.patch.unitPrice < 1 ||
          body.patch.unitPrice > 99999999)
      )
        return errorResponse('VALIDATION_ERROR', '수정 가격을 확인해 주세요.');
      if (body.patch?.kind === 'PRICE') {
        const parsed = parseTouchPrice(body.patch.inputPrice || '');
        if (parsed.amount !== body.patch.unitPrice || parsed.error)
          return errorResponse(
            'VALIDATION_ERROR',
            parsed.error || '가격을 확인해 주세요.',
          );
      }
      return respond(
        await rpc('voicecap_update_touch_sale', {
          p_workspace_id: workspace,
          p_actor_id: auth.actorId,
          p_payload: body.patch,
        }),
      );
    }
    if (body.action === 'touch-capture-target') {
      if (!Number.isFinite(Date.parse(body.dueAt)))
        return errorResponse(
          'VALIDATION_ERROR',
          '캡처 시각이 올바르지 않습니다.',
        );
      const { data: run } = await admin
        .from('touch_sales_runs')
        .select('producer_id,lease_expires_at')
        .eq('workspace_id', workspace)
        .maybeSingle();
      if (
        run?.producer_id !== body.producerId ||
        Date.parse(run.lease_expires_at) < Date.now()
      )
        return errorResponse('PC_LEASE_LOST', messages.PC_LEASE_LOST, 409);
      const { data: detail } = await admin
        .from('touch_sale_details')
        .select('confirmed_at,recapture')
        .eq('workspace_id', workspace)
        .eq('sale_id', body.saleId)
        .maybeSingle();
      const seconds =
        (Date.parse(body.dueAt) - Date.parse(detail?.confirmed_at)) / 1000;
      if (!detail || (!detail.recapture && (seconds < 2 || seconds > 30)))
        return errorResponse(
          'VALIDATION_ERROR',
          '캡처 시간 범위를 확인해 주세요.',
        );
      const { error } = await admin
        .from('touch_sale_details')
        .update({ capture_due_at: body.dueAt })
        .eq('workspace_id', workspace)
        .eq('sale_id', body.saleId)
        .eq('capture_status', 'PENDING')
        .eq('capture_owner', body.producerId);
      if (error) throw error;
      return successResponse({ ok: true });
    }
    if (body.action === 'touch-events') {
      const allowed = [
        'START',
        'STOP',
        'DIRECT',
        'FALLBACK',
        'DISCONNECTED',
        'HELPER_ERROR',
        'PRINT_ERROR',
        'CAPTURE_MISSING',
        'LATE_SALE',
        'SUMMARY',
      ];
      const metricKeys = [
        'directComments',
        'fallbackComments',
        'fallbackMessages',
        'signalMessages',
        'directSeconds',
        'fallbackSeconds',
        'transitions',
        'phoneCount',
        'delayAverage',
        'delayMaximum',
        'delaySum',
        'delaySamples',
        'delayUnavailableSeconds',
      ];
      if (!allowed.includes(body.kind))
        return errorResponse('VALIDATION_ERROR', '잘못된 기록 종류입니다.');
      const metrics = Object.fromEntries(
        metricKeys
          .filter((k) => Number.isFinite(body.metrics?.[k]))
          .map((k) => [k, Math.max(0, Math.min(10000000, body.metrics[k]))]),
      );
      const { data: session } = await admin
        .from('live_sessions')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('id', body.sessionId)
        .maybeSingle();
      if (!session)
        return errorResponse('SESSION_ENDED', '유효한 회차가 없습니다.', 409);
      const { error } = await admin
        .from('touch_sales_events')
        .upsert(
          {
            id: body.eventId || crypto.randomUUID(),
            workspace_id: workspace,
            session_id: session.id,
            producer_id: body.producerId || null,
            kind: body.kind,
            metrics,
          },
          { onConflict: 'id', ignoreDuplicates: true },
        );
      if (error) throw error;
      return successResponse({ ok: true });
    }
    return errorResponse('VALIDATION_ERROR', '알 수 없는 댓글터치 작업입니다.');
  } catch (error) {
    const e = error as { message?: string; code?: string };
    return errorResponse(
      e.code || 'DATABASE_ERROR',
      messages[e.code || ''] ||
        '저장 결과를 확인하지 못했습니다. 같은 작업 번호로 다시 확인합니다.',
      500,
      {},
      true,
    );
  }
}
