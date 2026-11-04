import React from 'react';
import { MANAGE_PERIODS } from '../../services/manage/period';

export const ManagePeriodTabs: React.FC<{ days: number; onChange: (days: number) => void }> = ({ days, onChange }) => (
  <div role="tablist" aria-label="기간" className="flex gap-1">
    {MANAGE_PERIODS.map((period) => (
      <button key={period.days} type="button" role="tab" aria-selected={days === period.days}
        onClick={() => onChange(period.days)}
        className={`min-h-[36px] flex-shrink-0 rounded-full px-3 text-xs font-bold ${days === period.days
          ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
        {period.label}
      </button>
    ))}
  </div>
);
