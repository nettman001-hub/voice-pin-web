import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { remoteWorkspaceService } from '../../services/remoteWorkspaceService';
import {
  DEFAULT_KEEPING_ALERT_DAYS, KEEPING_ALERT_DAYS_SETTING, normalizeKeepingAlertDays,
} from '../../services/manage/fulfillment';

/** 더보기 › 보관 설정: 오래 보관한 상품을 알릴 일수. 알림만 하고 자동 출고는 하지 않는다. */
export const KeepingSettingsPage: React.FC = () => {
  const { workspaceId } = useAuth();
  const [warnDays, setWarnDays] = useState(String(DEFAULT_KEEPING_ALERT_DAYS.warnDays));
  const [alertDays, setAlertDays] = useState(String(DEFAULT_KEEPING_ALERT_DAYS.alertDays));
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    remoteWorkspaceService.fetchWorkspaceSettings(workspaceId, KEEPING_ALERT_DAYS_SETTING)
      .then((raw) => {
        if (cancelled) return;
        const days = normalizeKeepingAlertDays(raw);
        setWarnDays(String(days.warnDays));
        setAlertDays(String(days.alertDays));
        setStatus('idle');
      })
      .catch(() => { if (!cancelled) setStatus('idle'); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const preview = normalizeKeepingAlertDays({ warnDays, alertDays });
  const save = async () => {
    if (!workspaceId) return;
    setStatus('saving');
    try {
      await remoteWorkspaceService.saveWorkspaceSettings(workspaceId, KEEPING_ALERT_DAYS_SETTING, preview, { throwOnError: true });
      setWarnDays(String(preview.warnDays));
      setAlertDays(String(preview.alertDays));
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3">
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
        <p className="text-sm text-slate-600">
          보관한 지 오래된 상품을 홈과 할 일에서 알려 드립니다. 알림만 하고 자동으로 출고하지 않습니다.
        </p>
        <label className="block">
          <span className="text-sm font-bold text-slate-800">주의 (노란색)</span>
          <span className="mt-1 flex items-center gap-2">
            <input
              type="number" inputMode="numeric" min={1} max={365} value={warnDays}
              onChange={(event) => { setWarnDays(event.target.value); setStatus('idle'); }}
              className="h-11 w-24 rounded-xl border border-slate-300 px-3 text-base"
            />
            <span className="text-sm text-slate-600">일째부터</span>
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-bold text-slate-800">경고 (빨간색)</span>
          <span className="mt-1 flex items-center gap-2">
            <input
              type="number" inputMode="numeric" min={2} max={365} value={alertDays}
              onChange={(event) => { setAlertDays(event.target.value); setStatus('idle'); }}
              className="h-11 w-24 rounded-xl border border-slate-300 px-3 text-base"
            />
            <span className="text-sm text-slate-600">일째부터</span>
          </span>
        </label>
        <p className="text-xs text-slate-500">저장되는 값: 주의 {preview.warnDays}일, 경고 {preview.alertDays}일 (경고는 주의보다 길어야 합니다)</p>
        <button
          type="button"
          disabled={status === 'saving' || status === 'loading' || !workspaceId}
          onClick={() => void save()}
          className="h-11 w-full rounded-xl bg-brand-600 text-sm font-bold text-white disabled:opacity-50"
        >
          {status === 'saving' ? '저장 중…' : '저장'}
        </button>
        {status === 'saved' && <p role="status" className="text-sm font-bold text-emerald-700">저장했습니다.</p>}
        {status === 'error' && <p role="alert" className="text-sm font-bold text-rose-700">저장하지 못했습니다. 인터넷 연결을 확인해 주세요.</p>}
      </div>
    </div>
  );
};

export default KeepingSettingsPage;
