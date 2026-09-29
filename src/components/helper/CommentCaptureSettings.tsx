import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCommentCapture, getCommentStatusBadge } from '../../context/CommentCaptureContext';
import { COMMENT_HELPER_DOWNLOAD_URL, DEFAULT_COMMENT_SERVER_URL } from '../../types/comment';
import { ArrowRight, BellRing, CheckCircle2, Download, MessageSquareText, Play, Square } from 'lucide-react';

export const CommentCaptureSettings: React.FC = () => {
  const {
    config, saveConfig, isActive, isRunning, serverStatus, serverMessage, newCount,
    startCapture, stopCapture,
  } = useCommentCapture();
  const [username, setUsername] = useState(config.tiktokUsername);
  const [alertWords, setAlertWords] = useState(config.alertWords.join(', '));
  const [alertDuration, setAlertDuration] = useState(String(config.alertDurationSec));
  const [alertCommand, setAlertCommand] = useState(config.alertVoiceCommand);
  const [helperCheckComplete, setHelperCheckComplete] = useState(serverStatus !== 'DISCONNECTED');
  const [saveFeedback, setSaveFeedback] = useState('');

  useEffect(() => {
    setUsername(config.tiktokUsername);
    setAlertWords(config.alertWords.join(', '));
    setAlertDuration(String(config.alertDurationSec));
    setAlertCommand(config.alertVoiceCommand);
  }, [config]);

  // A disconnected helper may still be starting. Delay installation guidance.
  useEffect(() => {
    if (serverStatus !== 'DISCONNECTED') {
      setHelperCheckComplete(true);
      return;
    }
    setHelperCheckComplete(false);
    const timer = window.setTimeout(() => setHelperCheckComplete(true), 2500);
    return () => window.clearTimeout(timer);
  }, [serverStatus]);

  const saveSettings = (customUsername = username, showFeedback = true) => {
    const cleanUsername = customUsername.trim().replace(/^@/, '');
    const duration = Math.max(3, parseInt(alertDuration, 10) || 15);
    const words = alertWords.split(',').map((word) => word.trim()).filter(Boolean);
    const commands = [...new Set(alertCommand.split(',').map((command) => command.trim()).filter(Boolean))];
    const command = commands.join(', ') || '닫아';
    saveConfig({
      tiktokUsername: cleanUsername,
      serverUrl: DEFAULT_COMMENT_SERVER_URL,
      alertWords: words,
      alertDurationSec: duration,
      alertVoiceCommand: command,
    });
    setUsername(cleanUsername);
    setAlertDuration(String(duration));
    setAlertCommand(command);
    if (showFeedback) setSaveFeedback('댓글 수집·알림 설정을 저장했습니다.');
  };

  return (
    <section id="comment-capture-settings" aria-labelledby="comment-capture-title" className="scroll-mt-24 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm space-y-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl bg-cyan-50 p-2.5 text-cyan-700"><MessageSquareText className="h-5 w-5" /></span>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-700">댓글 수집</span>
            <h2 id="comment-capture-title" className="text-base font-black text-slate-900">댓글 자동 캡처 & 키워드 알림</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              틱톡 라이브 댓글을 자동 기록하고 지정한 단어가 포함되면 알림창을 표시합니다.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-bold ${
            isRunning ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : isActive ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-100 text-slate-600'
          }`}>
            {isRunning ? '실시간 수집 중' : isActive ? '대기 중 · 라이브 청취 필요' : '수집 중지됨'}
          </span>
          <button type="button" onClick={isActive ? stopCapture : startCapture}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-sm transition ${
              isActive ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}>
            {isActive ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {isActive ? '댓글 수집 정지' : '댓글 수집 시작'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <span className="block text-[10px] font-bold text-slate-500">신규 수집 댓글</span>
          <strong className="mt-1 block text-lg text-slate-900">{newCount.toLocaleString()}건</strong>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <span className="block text-[10px] font-bold text-slate-500">수집 프로그램</span>
          <strong className="mt-1 block text-sm text-slate-900">{getCommentStatusBadge(serverStatus).label}</strong>
        </div>
        <Link to="/comments" className="group rounded-2xl border border-cyan-200 bg-cyan-50 p-3 transition hover:bg-cyan-100">
          <span className="block text-[10px] font-bold text-cyan-700">수집된 댓글 확인</span>
          <strong className="mt-1 flex items-center gap-1 text-sm text-cyan-900">댓글/판매멘트 기록 <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></strong>
        </Link>
      </div>

      {helperCheckComplete && serverStatus === 'DISCONNECTED' && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div>
            <strong className="text-amber-900">댓글 받기 프로그램을 확인해 주세요.</strong>
            <p className="mt-1 text-amber-800">Windows 시작 메뉴에서 VoiceCAP 댓글 도우미를 실행하세요. 없다면 한 번만 설치하면 됩니다.</p>
          </div>
          <a href={COMMENT_HELPER_DOWNLOAD_URL} target="_blank" rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2.5 font-bold text-white hover:bg-amber-500">
            <Download className="h-3.5 w-3.5" />프로그램 다운로드
          </a>
        </div>
      )}
      {isActive && serverStatus === 'ERROR' && (
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
          댓글 수집 중 문제가 발생했습니다. {serverMessage}
        </p>
      )}

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">수집 대상</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">방송 중인 틱톡 계정을 지정하세요.</p>
        </div>
        <div className="max-w-xl space-y-1.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <label htmlFor="comment-helper-tiktok-id" className="font-bold text-slate-700">틱톡 ID (@ 제외)</label>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
              config.tiktokUsername ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}>
              {config.tiktokUsername ? `설정됨 · @${config.tiktokUsername}` : '미설정'}
            </span>
          </div>
          <div className="flex gap-2">
            <input id="comment-helper-tiktok-id" type="text" value={username}
              onChange={(event) => { setUsername(event.target.value.replace(/^@/, '')); setSaveFeedback(''); }}
              onBlur={() => { if (username.trim().replace(/^@/, '') !== config.tiktokUsername) saveSettings(username, false); }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveSettings(username); } }}
              placeholder="예: my_shop_official"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-slate-900 focus:border-brand-500 focus:outline-none" />
            <button type="button" onClick={() => saveSettings(username)}
              className="shrink-0 rounded-xl bg-cyan-600 px-3.5 py-2.5 font-bold text-white hover:bg-cyan-500">ID 저장</button>
          </div>
          <p className="text-[11px] text-slate-500">입력 후 Enter 또는 ID 저장을 누르면 설정을 저장하고 계정 동기화를 요청합니다.</p>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-rose-500" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">키워드 알림</h3>
            <p className="text-[11px] text-slate-500">일치하는 댓글이 들어오면 큰 알림창을 띄웁니다.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="comment-helper-alert-words" className="font-bold text-slate-700">알림 단어 (쉼표로 구분)</label>
            <input id="comment-helper-alert-words" type="text" value={alertWords}
              onChange={(event) => { setAlertWords(event.target.value); setSaveFeedback(''); }}
              placeholder="저요, 구매"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="comment-helper-alert-duration" className="font-bold text-slate-700">알림창 자동 닫힘 시간 (초)</label>
            <input id="comment-helper-alert-duration" type="number" min={3} value={alertDuration}
              onChange={(event) => { setAlertDuration(event.target.value); setSaveFeedback(''); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-slate-900 focus:border-brand-500 focus:outline-none" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="comment-helper-alert-command" className="font-bold text-slate-700">알림창 닫는 음성 명령 (쉼표로 구분)</label>
            <input id="comment-helper-alert-command" type="text" value={alertCommand}
              onChange={(event) => { setAlertCommand(event.target.value); setSaveFeedback(''); }}
              placeholder="닫아, 알림 닫기"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <p role="status" className="flex items-center gap-1 text-[11px] text-emerald-700">
          {saveFeedback && <><CheckCircle2 className="h-3.5 w-3.5" />{saveFeedback}</>}
        </p>
        <button type="button" onClick={() => saveSettings()}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-brand-500">
          댓글 수집·알림 설정 저장
        </button>
      </div>
    </section>
  );
};
