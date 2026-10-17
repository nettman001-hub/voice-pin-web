import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { CommentCaptureSettings } from '../../components/helper/CommentCaptureSettings';
import {
  CommentHelperStatus,
  SttDeviceInfo
} from '../../types/helper';
import { commentHelperService } from '../../services/commentHelperService';
import {
  Cpu,
  RefreshCw,
  AlertCircle,
  Clock,
  Bot
} from 'lucide-react';

export const CommentHelperPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === '관리자';
  const [status, setStatus] = useState<CommentHelperStatus | null>(null);

  // STT 상태 (관리자 전용)
  const [sttDevices, setSttDevices] = useState<SttDeviceInfo[]>([]);
  const [selectedSttDevice, setSelectedSttDevice] = useState('');
  const [isDetectingStt, setIsDetectingStt] = useState(false);
  const [sttFeedback, setSttFeedback] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = commentHelperService.subscribeStatus((newStatus) => {
      setStatus(newStatus);
      if (isAdmin && newStatus.stt?.device) {
        setSelectedSttDevice(newStatus.stt.device);
      }
    });

    if (isAdmin) void loadSttDevices();

    return () => {
      unsubscribe();
    };
  }, [isAdmin]);

  const loadSttDevices = async () => {
    setIsDetectingStt(true);
    try {
      const res = await commentHelperService.detectSttDevices();
      if (res && res.devices) {
        setSttDevices(res.devices);
      }
    } catch (e) {
      console.error('STT 장치 감지 실패:', e);
    } finally {
      setIsDetectingStt(false);
    }
  };

  const handleSttDeviceChange = async (device: string) => {
    setSelectedSttDevice(device);
    setSttFeedback('가속 연산 장치를 변경하는 중...');
    try {
      const res = await commentHelperService.setSttDevice(device);
      if (res && res.ok) {
        setSttFeedback(res.message || '가속 연산 장치가 변경되었습니다.');
      } else {
        setSttFeedback(res.error || '장치 변경에 실패했습니다.');
      }
    } catch (e) {
      setSttFeedback(`오류: ${e instanceof Error ? e.message : '장치 변경 실패'}`);
    }
    setTimeout(() => setSttFeedback(null), 4000);
  };

  const getStatusTone = () => {
    if (!status) return { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', dot: 'bg-slate-400', label: '연결 확인 중' };
    if (status.helper === 'error') return { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500', label: '연결 오류' };
    if (status.helper !== 'running') return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', label: '시작하는 중' };
    if (status.tiktokState === 'collecting') return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', label: '댓글 수집 중' };
    if (status.tiktokState === 'connecting') return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500', label: '틱톡 연결 중' };
    if (status.tiktokState === 'waiting_live') return { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500', label: '방송 대기 중' };
    return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', label: '정상 작동 중' };
  };

  const tone = getStatusTone();

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-3.5 sm:space-y-6 sm:p-6 lg:p-8">
      {/* 헤더 */}
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand-600">방송 준비 · 장치 운영</span>
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-brand-50 text-brand-600">
              <Bot className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">댓글 도우미 & 장치 설정</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            댓글 도우미 앱과의 연결 상태를 확인하고 실시간 댓글 수집 및 키워드 알림을 설정하세요.
          </p>
        </div>
      </div>

      <nav aria-label="장치 설정 바로가기" className="flex flex-wrap gap-2 text-xs font-bold">
        <a href="#helper-status" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-brand-200 hover:text-brand-700">연결 상태</a>
        <a href="#comment-capture-settings" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-brand-200 hover:text-brand-700">댓글 수집·알림</a>
        {isAdmin && (
          <a href="#admin-stt-settings" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-brand-200 hover:text-brand-700">STT 가속 장치</a>
        )}
      </nav>

      {/* 연결 상태는 모든 설정의 출발점이다. */}
      <section id="helper-status" aria-labelledby="helper-status-title" className={`scroll-mt-24 space-y-4 rounded-3xl border p-4 shadow-sm sm:p-6 ${tone.border} ${tone.bg}`}>
        <h2 id="helper-status-title" className="text-sm font-black text-slate-900">댓글 도우미 연결 상태</h2>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className={`w-3 h-3 rounded-full ${tone.dot} animate-pulse`} />
            <span className={`text-sm font-black ${tone.text}`}>{tone.label}</span>
          </div>
          <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
            <Clock className="w-3.5 h-3.5" />
            {status?.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleTimeString('ko-KR') : '확인 중'}
          </span>
        </div>
        <p className="text-xs text-slate-700 font-medium">
          {status?.message || '댓글 도우미 연결 상태를 확인하고 있습니다.'}
        </p>

        <div className={`grid grid-cols-1 gap-3 border-t border-slate-200/60 pt-2 text-xs sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          <div className="bg-white/90 p-3 rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[10px] text-slate-500 block font-semibold">틱톡 방송 계정</span>
            <strong className="text-slate-900 text-sm truncate block mt-0.5">
              {status?.tiktokUsername ? `@${status.tiktokUsername}` : '(미설정)'}
            </strong>
          </div>
          <div className="bg-white/90 p-3 rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[10px] text-slate-500 block font-semibold">수집 댓글 수</span>
            <strong className="text-slate-900 text-sm block mt-0.5">
              {status?.totalComments?.toLocaleString() || 0}개
            </strong>
          </div>
          {isAdmin && (
            <div className="bg-white/90 p-3 rounded-2xl border border-slate-200/80 shadow-xs">
              <span className="text-[10px] text-slate-500 block font-semibold">STT 가속 장치 · 관리자</span>
              <strong className="text-slate-900 text-sm block truncate mt-0.5">{status?.stt?.deviceName || '준비 완료'}</strong>
            </div>
          )}
        </div>
      </section>

      <CommentCaptureSettings />

      {/* 전문가용 STT 장치 선택은 관리자에게만 노출한다. */}
      {isAdmin && (
        <section id="admin-stt-settings" aria-label="관리자 STT 장치 설정" className="scroll-mt-24 space-y-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-brand-50 text-brand-600">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">음성인식(STT) 하드웨어 가속</h2>
                <p className="text-xs text-slate-500">내 PC 그래픽카드(GPU)를 사용하여 무료로 실시간 음성을 전사합니다.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadSttDevices()}
              disabled={isDetectingStt}
              className="text-xs text-brand-600 hover:text-brand-700 font-bold flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isDetectingStt ? 'animate-spin' : ''}`} />
              {isDetectingStt ? '감지 중...' : '장치 새로고침'}
            </button>
          </div>

          <div className="text-xs space-y-2">
            <label className="font-semibold text-slate-700 block">가속 연산 장치 선택</label>
            <select
              value={selectedSttDevice}
              onChange={(e) => void handleSttDeviceChange(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-brand-500"
            >
              {sttDevices.length === 0 ? (
                <option value="auto">자동 감지 (GPU 우선, 없을 시 CPU)</option>
              ) : (
                sttDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} {d.isGpu ? '⚡ (GPU 고속 가속)' : '(CPU)'}
                  </option>
                ))
              )}
            </select>
            <p className="text-[11px] text-slate-500">
              NVIDIA GeForce, AMD Radeon, DirectX 12/Vulkan 그래픽카드가 감지되면 CPU 부하 없이 초고속 실시간 음성인식이 작동합니다.
            </p>
          </div>

          {sttFeedback && (
            <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-blue-600" />
              <span>{sttFeedback}</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
