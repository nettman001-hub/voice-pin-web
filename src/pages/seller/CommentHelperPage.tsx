import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { CommentCaptureSettings } from '../../components/helper/CommentCaptureSettings';
import {
  CommentHelperStatus,
  PaperSize,
  PrinterDevice,
  SttDeviceInfo
} from '../../types/helper';
import { commentHelperService } from '../../services/commentHelperService';
import {
  Printer,
  Cpu,
  RefreshCw,
  Power,
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  Bot,
  ArrowRight,
  MessageSquareText
} from 'lucide-react';

export const CommentHelperPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === '관리자';
  const [status, setStatus] = useState<CommentHelperStatus | null>(null);
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [paperSize, setPaperSize] = useState<PaperSize>('LABEL_50_30');
  const [printEnabled, setPrintEnabled] = useState(false);
  const [printFeedback, setPrintFeedback] = useState<string | null>(null);
  const [isSavingPrinter, setIsSavingPrinter] = useState(false);
  const [isTestingPrint, setIsTestingPrint] = useState(false);

  // STT 상태
  const [sttDevices, setSttDevices] = useState<SttDeviceInfo[]>([]);
  const [selectedSttDevice, setSelectedSttDevice] = useState('');
  const [isDetectingStt, setIsDetectingStt] = useState(false);
  const [sttFeedback, setSttFeedback] = useState<string | null>(null);

  // 자동 실행
  const [autoStart, setAutoStart] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);


  useEffect(() => {
    const unsubscribe = commentHelperService.subscribeStatus((newStatus) => {
      setStatus(newStatus);
      setPrintEnabled(Boolean(newStatus.print?.enabled));
      setPaperSize(newStatus.print?.paperSize || 'LABEL_50_30');
      if (newStatus.print?.printerName) {
        setSelectedPrinter(newStatus.print.printerName);
      }
      setAutoStart(Boolean(newStatus.autoStart));
      if (isAdmin && newStatus.stt?.device) {
        setSelectedSttDevice(newStatus.stt.device);
      }
    });

    void loadPrinters();
    if (isAdmin) void loadSttDevices();

    return () => {
      unsubscribe();
    };
  }, [isAdmin]);

  const loadPrinters = async () => {
    try {
      const list = await commentHelperService.getPrinters();
      setPrinters(list);
      if (list.length > 0 && !selectedPrinter) {
        const defaultPrinter = list.find((p) => p.isDefault) || list[0];
        setSelectedPrinter(defaultPrinter.name);
      }
    } catch (e) {
      console.error('프린터 목록 조회 실패:', e);
    }
  };

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

  const handleSavePrintSettings = async () => {
    setIsSavingPrinter(true);
    setPrintFeedback(null);
    try {
      const result = await commentHelperService.savePrintSettings({
        enabled: printEnabled,
        printerName: selectedPrinter,
        paperSize
      });
      setPrintFeedback(result.message || '프린터 설정이 저장되었습니다.');
      setTimeout(() => setPrintFeedback(null), 4000);
    } catch (e) {
      setPrintFeedback(e instanceof Error ? e.message : '설정 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingPrinter(false);
    }
  };

  const handleTestPrint = async () => {
    setIsTestingPrint(true);
    setPrintFeedback(null);
    try {
      const res = await commentHelperService.testPrint();
      if (res.ok) {
        setPrintFeedback('테스트 전표(3줄) 인쇄를 요청했습니다.');
      } else {
        setPrintFeedback(`인쇄 실패: ${res.error || '프린터 상태를 확인해 주세요.'}`);
      }
    } catch (e) {
      setPrintFeedback(`인쇄 오류: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      setIsTestingPrint(false);
      setTimeout(() => setPrintFeedback(null), 5000);
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

  const handleToggleAutoStart = async (checked: boolean) => {
    setAutoStart(checked);
    await commentHelperService.setAutoStart(checked);
  };

  const handleRestartServer = async () => {
    setIsRestarting(true);
    try {
      await commentHelperService.restart();
    } catch (e) {
      console.error('서버 재시작 오류:', e);
    } finally {
      setTimeout(() => setIsRestarting(false), 1200);
    }
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
            연결 상태를 확인한 뒤 댓글 수집·알림, 전표 출력, 자동 실행 순서로 설정하세요.
          </p>
        </div>
        <Link to="/comments" className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3.5 py-2.5 text-xs font-bold text-cyan-800 hover:bg-cyan-100">
          <MessageSquareText className="h-4 w-4" />댓글/판매멘트 기록<ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <nav aria-label="장치 설정 바로가기" className="flex flex-wrap gap-2 text-xs font-bold">
        <a href="#helper-status" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-brand-200 hover:text-brand-700">연결 상태</a>
        <a href="#comment-capture-settings" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-brand-200 hover:text-brand-700">댓글 수집·알림</a>
        <a href="#helper-print-settings" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-brand-200 hover:text-brand-700">전표 출력</a>
        <a href="#helper-system-settings" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-brand-200 hover:text-brand-700">실행·진단</a>
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

        <div className={`grid grid-cols-1 gap-3 border-t border-slate-200/60 pt-2 text-xs sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
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
          <div className="bg-white/90 p-3 rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[10px] text-slate-500 block font-semibold">전표 자동 출력</span>
            <strong className="text-slate-900 text-sm block truncate mt-0.5">
              {status?.print?.enabled ? '사용 중' : '꺼짐'}
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

      {/* 댓글 수집 다음으로 출력 경로를 구성한다. */}
      <section id="helper-print-settings" aria-labelledby="helper-print-title" className="scroll-mt-24 space-y-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-brand-50 text-brand-600">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 id="helper-print-title" className="text-base font-bold text-slate-900">판매 전표 자동 출력</h2>
              <p className="text-xs text-slate-500">음성인식으로 확정된 주문을 Windows 프린터로 자동 Silent 인쇄합니다.</p>
            </div>
          </div>
          <label className="flex items-center space-x-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={printEnabled}
              onChange={(e) => setPrintEnabled(e.target.checked)}
              className="w-4 h-4 rounded text-brand-600 border-slate-300 focus:ring-brand-500 cursor-pointer accent-brand-600"
            />
            <span className="text-xs font-bold text-slate-800">자동 출력 사용</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-semibold text-slate-700">Windows 프린터 선택</label>
              <button
                type="button"
                onClick={() => void loadPrinters()}
                className="text-[11px] text-brand-600 hover:text-brand-700 font-bold flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> 새로고침
              </button>
            </div>
            <select
              value={selectedPrinter}
              onChange={(e) => setSelectedPrinter(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-brand-500"
            >
              {printers.length === 0 ? (
                <option value="">
                  댓글 도우미에서 프린터를 감지합니다.
                </option>
              ) : (
                printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} {p.isDefault ? '(기본)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1.5">용지 규격</label>
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as PaperSize)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-brand-500"
            >
              <option value="LABEL_50_30">라벨 스티커 (50 × 30 mm)</option>
              <option value="RECEIPT_80">영수증 프린터 (80 mm)</option>
              <option value="RECEIPT_58">영수증 프린터 (58 mm)</option>
              <option value="A4">일반 프린터 (A4)</option>
            </select>
          </div>
        </div>

        {printFeedback && (
          <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-blue-600" />
            <span>{printFeedback}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => void handleTestPrint()}
            disabled={isTestingPrint}
            className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            {isTestingPrint ? '인쇄 요청 중...' : '세 줄 테스트 출력'}
          </button>
          <button
            type="button"
            onClick={() => void handleSavePrintSettings()}
            disabled={isSavingPrinter}
            className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/20 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            {isSavingPrinter ? '저장 중...' : '프린터 설정 저장'}
          </button>
        </div>
      </section>

      {/* 전문가용 STT 장치 선택은 관리자에게만 노출한다. */}
      {isAdmin && <section aria-label="관리자 STT 장치 설정" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
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
      </section>}

      {/* 운영 중 재시작과 진단 기능은 마지막에 둔다. */}
      <section id="helper-system-settings" aria-labelledby="helper-system-title" className="scroll-mt-24 space-y-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 id="helper-system-title" className="text-base font-bold text-slate-900">자동 실행과 진단</h2>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">컴퓨터를 켤 때 자동 실행</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Windows 시작 시 백그라운드 트레이로 자동 실행되어 라이브 방송 중단 없는 댓글 수집과 인쇄를 지원합니다.
            </p>
          </div>
          <label className="flex items-center space-x-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => void handleToggleAutoStart(e.target.checked)}
              className="w-4 h-4 rounded text-brand-600 border-slate-300 focus:ring-brand-500 cursor-pointer accent-brand-600"
            />
            <span className="text-xs font-bold text-slate-800">자동 실행</span>
          </label>
        </div>

        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void handleRestartServer()}
            disabled={isRestarting}
            className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <Power className="w-4 h-4 text-rose-500" />
            {isRestarting ? '서버 다시 시작 중...' : '댓글 서버 다시 시작'}
          </button>

          <button
            type="button"
            onClick={() => void commentHelperService.openLogs()}
            className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4 text-slate-500" />
            진단 로그 파일 열기
          </button>
        </div>
      </section>
    </div>
  );
};
