import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { Bell, Send, CheckCircle2, Shield, Mail } from 'lucide-react';

export const NotificationSettingsPage: React.FC = () => {
  const { notifications, toggleNotification, sendTestNotification } = useAppData();
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const handleTestNotification = () => {
    sendTestNotification();
    setToastMsg('테스트 알림이 발송되었습니다. (브라우저 푸시 권한 필요)');
    setTimeout(() => setToastMsg(null), 3000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">알림 설정</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 text-xs font-bold">
              푸시 & 이메일
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            판매 내역 저장 실패, 보류 건 발생, 구독 만료 등 주요 이벤트의 알림 수신 채널을 설정합니다.
          </p>
        </div>

        <button
          onClick={handleTestNotification}
          className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition"
        >
          <Send className="w-3.5 h-3.5 text-brand-400" />
          <span>테스트 알림 보내기</span>
        </button>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 알림 토글 리스트 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
          <Bell className="w-4 h-4 text-brand-400" />
          <span>이벤트별 알림 채널 설정</span>
        </h3>

        <div className="space-y-3">
          {notifications.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                <h4 className="text-sm font-bold text-white">{item.eventType}</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  해당 이벤트가 발생했을 때 즉시 판매자에게 알림을 발송합니다.
                </p>
              </div>

              <div className="flex items-center space-x-6">
                {/* 앱 푸시 토글 */}
                <label className="flex items-center space-x-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={item.pushEnabled}
                    onChange={() => toggleNotification(item.id, 'push')}
                    className="rounded border-slate-700 bg-slate-900 text-brand-500 w-4 h-4"
                  />
                  <span>앱 푸시</span>
                </label>

                {/* 이메일 토글 */}
                <label className="flex items-center space-x-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={item.emailEnabled}
                    onChange={() => toggleNotification(item.id, 'email')}
                    className="rounded border-slate-700 bg-slate-900 text-brand-500 w-4 h-4"
                  />
                  <span>이메일</span>
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
