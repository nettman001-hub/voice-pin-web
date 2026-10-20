import { readOperationalAiSetting } from '../src/services/aiAppliedSettings.ts';
import { createClient } from '@supabase/supabase-js';
import { createAiTaskObject, processAiTask } from '../supabase/functions/sales-api/handlers/aiTaskCore.ts';
import { DEFAULT_AI_SETTINGS } from '../src/types/aiSettings.ts';

export const config = { maxDuration: 300 };

// Read-only configuration/authentication client. No task, attempt, transcript,
// comment, sale, usage or conversation is persisted by this endpoint.
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST required' });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = serviceKey || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(503).json({ ok: false, error: '테스트 AI 서버의 인증 설정이 준비되지 않았습니다.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    ...(!serviceKey ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}) });
  try {
    const { data: identity, error: authError } = await client.auth.getUser(token);
    if (authError || !identity.user) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    const body = req.body || {};
    if (JSON.stringify(body).length > 1_000_000 || !body.sourceWorkspaceId || !body.sale?.id || !body.request
      || body.request.taskType !== 'PENDING_RESOLUTION') return res.status(400).json({ ok: false, error: '테스트 검토 요청을 확인해 주세요.' });
    const { data: workspace, error: workspaceError } = await client.from('workspaces').select('owner_id').eq('id', body.sourceWorkspaceId).maybeSingle();
    if (workspaceError) throw workspaceError;
    // Match the product's existing member/administrator access boundary.
    const { data: member, error: memberError } = await client.from('workspace_members').select('workspace_id').eq('workspace_id', body.sourceWorkspaceId).eq('user_id', identity.user.id).maybeSingle();
    if (memberError) throw memberError;
    const isAdmin = identity.user.app_metadata?.role === 'ADMIN';
    if (!workspace || (!member && !isAdmin)) {
      return res.status(403).json({ ok: false, error: '작업공간에 접근할 수 없습니다.' });
    }
    const setting = await readOperationalAiSetting(client);
    if (setting?.enabled_pending_resolution === false) return res.json({ ok: true, data: { skipped: true, message: '보류 AI 검토가 비활성화되어 있습니다.' } });
    const { data: secrets, error: secretsError } = serviceKey && setting?.id
      ? await client.from('ai_secrets').select('slot_number,secret_value').eq('setting_id', setting.id)
      : { data: [], error: null };
    if (secretsError) throw secretsError;
    const task = createAiTaskObject({ taskType: 'PENDING_RESOLUTION', workspaceId: body.request.workspaceId,
      sessionId: body.sale.sessionId, saleId: body.sale.id, saleRevision: body.sale.revision,
      settingVersion: setting?.applied_version || 1, currentUtterance: body.sale.rawTranscript, request: body.request }, setting?.primary_slot === 2 ? 2 : 1);
    if (typeof body.taskId === 'string' && /^ai_task_[a-zA-Z0-9_-]{1,100}$/.test(body.taskId)) task.taskId = body.taskId;
    const result = await processAiTask(task, {
      slot1Config: setting?.slot1 || DEFAULT_AI_SETTINGS.slot1, slot2Config: setting?.slot2 || DEFAULT_AI_SETTINGS.slot2,
      slot1Secret: secrets?.find(s => s.slot_number === 1)?.secret_value,
      slot2Secret: secrets?.find(s => s.slot_number === 2)?.secret_value,
      primarySlot: setting?.primary_slot === 2 ? 2 : 1,
      slot1CircuitBreaker: body.circuitBreakers?.slot1, slot2CircuitBreaker: body.circuitBreakers?.slot2,
    });
    return res.json({ ok: true, data: { task: result.task,
      circuitBreakers: { slot1: result.slot1CircuitBreaker, slot2: result.slot2CircuitBreaker } } });
  } catch (error) {
    // Do not log request/response bodies or provider conversation traces.
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : '테스트 AI 검토에 실패했습니다.' });
  }
}
