import React, { useId } from 'react';
import { Layers } from 'lucide-react';
import { ManagePeriodTabs } from './ManagePeriodTabs';
import type { ManageSelection } from '../../services/manage/useManagePeriod';
import { selectedManageSessionIds } from '../../services/manage/scope';
import { formatSessionDisplay } from '../../utils/sessionFormatter';

export const ManageScopeControl: React.FC<{
  selection: ManageSelection;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}> = ({ selection, leading, trailing }) => {
  const selectId = useId();
  const { scope, sessions, loading, error, setMode, setSessionId, setPeriodDays, refreshSessions } = selection;
  const latestId = [...selectedManageSessionIds({ mode: 'session', sessionId: 'LATEST' }, sessions, selection.now)][0] || null;
  const selectedId = scope.mode === 'session' ? scope.sessionId : 'LATEST';
  const missingSelected = selectedId !== 'ALL' && selectedId !== 'LATEST' && !sessions.some((session) => session.id === selectedId);
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-1">
        {leading}
        <div role="tablist" aria-label="조회 방식" className="flex gap-1">
          {([{ id: 'session', label: '방송회차별' }, { id: 'period', label: '기간별' }] as const).map((mode) => (
            <button key={mode.id} type="button" role="tab" aria-selected={scope.mode === mode.id}
              onClick={() => setMode(mode.id)}
              className={`min-h-[36px] rounded-full px-3 text-xs font-bold ${scope.mode === mode.id
                ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
              {mode.label}
            </button>
          ))}
        </div>
        {trailing && <div className="ml-auto flex-shrink-0">{trailing}</div>}
      </div>
      {scope.mode === 'session' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm sm:p-3">
          <div className="flex items-center gap-2">
            <label htmlFor={selectId} className="flex flex-shrink-0 items-center text-xs font-bold text-slate-700">
              <Layers className="mr-1.5 h-3.5 w-3.5 text-brand-600" aria-hidden="true" /> 회차 선택:
            </label>
            <select id={selectId} value={selectedId} onChange={(event) => setSessionId(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 focus:border-brand-500 focus:outline-none">
              {selectedId === 'LATEST' && <option value="LATEST">{loading ? '최근 회차 불러오는 중…' : '선택할 방송회차 없음'}</option>}
              {missingSelected && <option value={selectedId}>{formatSessionDisplay(selectedId)} · 저장된 회차</option>}
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {formatSessionDisplay(session.id, { sessions, recognizedAt: session.startedAt })}
                  {session.status === 'ACTIVE' ? ' · 열린 회차' : session.id === latestId ? ' · 최근 회차' : ''}
                  {session.estimated ? ' · 기록 기준 날짜' : ''}
                </option>
              ))}
              <option value="ALL">전체 회차 (모든 방송 합산)</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <ManagePeriodTabs days={scope.periodDays} onChange={setPeriodDays} />
          <p className="text-[11px] text-slate-500">한국 시간의 방송 시작일 기준입니다. 자정을 넘어도 해당 회차 전체를 함께 표시합니다.</p>
        </div>
      )}
      {error && (
        <p role="status" className="text-[11px] text-amber-700">
          회차 목록을 새로 읽지 못했습니다. 저장된 판매 기록을 함께 표시합니다.{' '}
          <button type="button" onClick={refreshSessions} className="font-bold underline">다시 불러오기</button>
        </p>
      )}
    </div>
  );
};
