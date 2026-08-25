import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { Bell, Mail, Smartphone, Volume2, CheckCircle2 } from 'lucide-react';

export const NotificationSettingsPage: React.FC = () => {
  const { notifications, toggleNotification, sendTestNotification } = useAppData();
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const handleTestSound = () => {
    sendTestNotification();
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch {}
    setToastMsg('테스트 알림 및 알림음이 발송되었습니다! 🔔');
    setTimeout(() => setToastMsg(null), 2500);
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-4xl mx-auto space-y-4 sm:space-y-6">
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">알림 설정</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] sm:text-xs font-bold border border-brand-200">
              실시간 피드백
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
            판매 자동 저장, 보류 건 발생 시 푸시 및 이메일 알림 수신 여부를 설정합니다.
          </p>
        </div>

        <button
          onClick={handleTestSound}
          className="w-full sm:w-auto px-4 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-500/20 transition flex items-center justify-center space-x-1.5 active:scale-95 text-center"
        >
          <Volume2 className="w-4 h-4" />
          <span>테스트 알림 발송</span>
        </button>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 설정 항목들 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3 sm:space-y-4">
        <div className="space-y-2.5 sm:space-y-3">
          {notifications.map((item) => (
            <div
              key={item.id}
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs"
            >
              <div>
                <div className="font-bold text-slate-900 text-xs sm:text-sm">{item.eventType}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">해당 이벤트 발생 시 지정된 채널로 즉시 알립니다.</div>
              </div>

              <div className="flex items-center space-x-4 self-end sm:self-auto border-t sm:border-t-0 border-slate-200/60 pt-2 sm:pt-0 w-full sm:w-auto justify-end">
                <label className="flex items-center space-x-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.pushEnabled}
                    onChange={() => toggleNotification(item.id, 'push')}
                    className="rounded border-slate-300 text-brand-600 w-4 h-4"
                  />
                  <span className="font-semibold text-slate-700 text-xs">푸시 알림</span>
                </label>

                <label className="flex items-center space-x-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.emailEnabled}
                    onChange={() => toggleNotification(item.id, 'email')}
                    className="rounded border-slate-300 text-brand-600 w-4 h-4"
                  />
                  <span className="font-semibold text-slate-700 text-xs">이메일</span>
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
