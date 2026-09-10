// Vercel Serverless Function: AI 설정 조회/저장 프록시 및 백업 엔드포인트
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ymegrhxpbeanvxwdzfym.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, settings, expectedVersion, applyImmediately, version } = req.body || {};

    if (action === 'get-ai-settings') {
      if (supabase) {
        const { data, error } = await supabase
          .from('ai_settings')
          .select('*')
          .eq('scope', 'GLOBAL')
          .maybeSingle();

        if (data && !error) {
          return res.status(200).json({
            ok: true,
            data: {
              settings: {
                id: data.id,
                scope: data.scope,
                version: data.version,
                appliedVersion: data.applied_version,
                isDraft: data.is_draft,
                enabledPendingResolution: data.enabled_pending_resolution,
                enabledVoiceCorrection: data.enabled_voice_correction,
                primarySlot: data.primary_slot,
                autoFallbackEnabled: data.auto_fallback_enabled,
                recoveryIntervalSeconds: data.recovery_interval_seconds ?? 30,
                autoReturnToPrimary: data.auto_return_to_primary,
                cloudMonthlyBudgetKrw: data.cloud_monthly_budget_krw,
                slot1: data.slot1,
                slot2: data.slot2,
                updatedAt: data.updated_at,
              },
            },
          });
        }
      }

      return res.status(200).json({
        ok: true,
        data: {
          settings: null,
          message: 'DB 설정이 없어 로컬 설정을 사용합니다.',
        },
      });
    }

    if (action === 'save-ai-settings') {
      const newVersion = (expectedVersion || 1) + 1;
      const appliedVer = applyImmediately ? newVersion : (expectedVersion || 1);
      const isDraft = !applyImmediately;

      if (supabase && settings) {
        try {
          const { data: current } = await supabase
            .from('ai_settings')
            .select('*')
            .eq('scope', 'GLOBAL')
            .maybeSingle();

          const updatePayload: Record<string, any> = {
            scope: 'GLOBAL',
            version: newVersion,
            applied_version: appliedVer,
            is_draft: isDraft,
            enabled_pending_resolution: settings.enabledPendingResolution,
            enabled_voice_correction: settings.enabledVoiceCorrection,
            primary_slot: settings.primarySlot || 1,
            auto_fallback_enabled: settings.autoFallbackEnabled,
            recovery_interval_seconds: settings.recoveryIntervalSeconds || 30,
            auto_return_to_primary: settings.autoReturnToPrimary,
            cloud_monthly_budget_krw: settings.cloudMonthlyBudgetKrw || null,
            slot1: settings.slot1 || {},
            slot2: settings.slot2 || {},
            updated_at: new Date().toISOString(),
          };

          if (current?.id) {
            await supabase.from('ai_settings').update(updatePayload).eq('id', current.id);
          } else {
            await supabase.from('ai_settings').insert(updatePayload);
          }
        } catch (dbErr) {
          console.warn('[Vercel ai-settings] DB update failed, falling back to response echoing:', dbErr);
        }
      }

      const updatedSettings = {
        ...settings,
        version: newVersion,
        appliedVersion: appliedVer,
        isDraft,
        updatedAt: new Date().toISOString(),
      };

      return res.status(200).json({
        ok: true,
        data: {
          settings: updatedSettings,
        },
      });
    }

    if (action === 'apply-ai-settings') {
      if (supabase && version) {
        try {
          await supabase
            .from('ai_settings')
            .update({ applied_version: version, is_draft: false, updated_at: new Date().toISOString() })
            .eq('scope', 'GLOBAL');
        } catch {}
      }

      return res.status(200).json({
        ok: true,
        data: {
          appliedVersion: version,
          isDraft: false,
        },
      });
    }

    return res.status(400).json({ ok: false, message: '지원되지 않는 action: ' + action });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'AI 설정 처리 중 오류가 발생했습니다.' });
  }
}
