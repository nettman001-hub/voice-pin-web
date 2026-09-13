import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CommentHelperStatus,
  PaperSize,
  PrinterDevice,
  SttDeviceInfo
} from '../../types/helper';
import { commentHelperService } from '../../services/commentHelperService';
import { isDesktopApp } from '../../services/authCredentialsService';
import {
  Printer,
  Cpu,
  RefreshCw,
  Power,
  FileText,
  ExternalLink,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles
} from 'lucide-react';

interface CommentHelperModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommentHelperModal: React.FC<CommentHelperModalProps> = ({ isOpen, onClose }) => {
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

  const isDesktop = isDesktopApp();

  useEffect(() => {
    if (!isOpen) return;

    // 상태 구독
    const unsubscribe = commentHelperService.subscribeStatus((newStatus) => {
      setStatus(newStatus);
      setPrintEnabled(Boolean(newStatus.print?.enabled));
      setPaperSize(newStatus.print?.paperSize || 'LABEL_50_30');
      if (newStatus.print?.printerName) {
        setSelectedPrinter(newStatus.print.printerName);
      }
      setAutoStart(Boolean(newStatus.autoStart));
      if (newStatus.stt?.device) {
        setSelectedSttDevice(newStatus.stt.device);
      }
    });

    // 프린터 목록 조회
    void loadPrinters();
    // STT 장치 목록 조회
    void loadSttDevices();

    return () => {
      unsubscribe();
    };
  }, [isOpen]);

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

  if (!isOpen) return null;

  const getStatusTone = () => {
    if (!status || status.helper === 'error') return { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500', label: '연결 오류' };
    if (status.helper !== 'running') return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', label: '시작하는 중' };
    if (status.tiktokState === 'collecting') return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', label: '댓글 수집 중' };
    if (status.tiktokState === 'connecting') return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500', label: '틱톡 연결 중' };
    if (status.tiktokState === 'waiting_live') return { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500', label: '방송 대기 중' };
    return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', label: '정상 작동 중' };
  };

  const tone = getStatusTone();

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in">
      <div className="w-full max-w-2xl max-h-[86vh] my-auto flex flex-col bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* 모달 상단 헤더 */}
        <div className="flex-shrink-0 px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow-md shadow-brand-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-black text-slate-900">VoiceCAP 내장 댓글 도우미</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">
                  v{status?.version || '1.3.7'}
                </span>
                {isDesktop && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                    윈도우 앱 내장
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                틱톡 실시간 댓글 수집 · 영수증 프린터 자동 출력 · 오프라인 STT 가속
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {isDesktop && (
              <button
                type="button"
                onClick={() => void commentHelperService.openHelperWindow()}
                className="p-1.5 rounded-xl hover:bg-slate-200 text-slate-500 hover:text-slate-800 text-xs font-semibold flex items-center gap-1 transition"
                title="독립된 작은 보조 창으로 띄우기"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline text-[11px]">미니 창</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 스크롤 가능한 본문 내용 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* 1. 실시간 작동 상태 요약 카드 */}
          <div className={`p-4 rounded-2xl border ${tone.border} ${tone.bg} space-y-3`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className={`w-2.5 h-2.5 rounded-full ${tone.dot} animate-pulse`} />
                <span className={`text-xs font-bold ${tone.text}`}>{tone.label}</span>
              </div>
              <span className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3" />
                {status?.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleTimeString('ko-KR') : '확인 중'}
              </span>
            </div>
            <p className="text-xs text-slate-700 font-medium">
              {status?.message || '댓글 서버가 정상 작동 중입니다.'}
            </p>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 text-xs">
              <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/80">
                <span className="text-[10px] text-slate-500 block font-semibold">틱톡 계정</span>
                <strong className="text-slate-800 text-xs truncate block">
                  {status?.tiktokUsername ? `@${status.tiktokUsername}` : '(미설정)'}
                </strong>
              </div>
              <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/80">
                <span className="text-[10px] text-slate-500 block font-semibold">수집 댓글</span>
                <strong className="text-slate-800 text-xs block">
                  {status?.totalComments?.toLocaleString() || 0}개
                </strong>
              </div>
              <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/80">
                <span className="text-[10px] text-slate-500 block font-semibold">STT 엔진</span>
                <strong className="text-slate-800 text-xs block truncate">
                  {status?.stt?.deviceName || '준비 완료'}
                </strong>
              </div>
            </div>
          </div>

          {/* 2. 판매 전표 자동 출력 (Windows 프린터) 설정 섹션 */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Printer className="w-4 h-4 text-brand-600" />
                <h3 className="text-sm font-bold text-slate-900">판매 전표 자동 출력</h3>
              </div>
              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={printEnabled}
                  onChange={(e) => setPrintEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-brand-600 border-slate-300 focus:ring-brand-500 cursor-pointer accent-brand-600"
                />
                <span className="text-xs font-bold text-slate-700">판매 시 자동 출력</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700">Windows 프린터</label>
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
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-brand-500"
                >
                  {printers.length === 0 ? (
                    <option value="">
                      {isDesktop ? '감지된 프린터가 없습니다.' : 'Windows 앱에서 프린터를 감지합니다.'}
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
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-brand-500"
                >
                  <option value="LABEL_50_30">라벨 스티커 (50 × 30 mm)</option>
                  <option value="RECEIPT_80">영수증 프린터 (80 mm)</option>
                  <option value="RECEIPT_58">영수증 프린터 (58 mm)</option>
                  <option value="A4">일반 프린터 (A4)</option>
                </select>
              </div>
            </div>

            {printFeedback && (
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-blue-600" />
                <span>{printFeedback}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => void handleTestPrint()}
                disabled={isTestingPrint}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5" />
                {isTestingPrint ? '인쇄 요청 중...' : '세 줄 테스트 출력'}
              </button>
              <button
                type="button"
                onClick={() => void handleSavePrintSettings()}
                disabled={isSavingPrinter}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-sm transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isSavingPrinter ? '저장 중...' : '프린터 설정 저장'}
              </button>
            </div>
          </div>

          {/* 3. 오프라인 음성인식(STT) 가속 장치 설정 섹션 */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-brand-600" />
                <h3 className="text-sm font-bold text-slate-900">음성인식(STT) 하드웨어 가속</h3>
              </div>
              <button
                type="button"
                onClick={() => void loadSttDevices()}
                disabled={isDetectingStt}
                className="text-[11px] text-brand-600 hover:text-brand-700 font-bold flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isDetectingStt ? 'animate-spin' : ''}`} />
                {isDetectingStt ? '감지 중...' : '장치 새로고침'}
              </button>
            </div>

            <div className="text-xs space-y-2">
              <label className="font-semibold text-slate-700 block">연산 가속 장치 선택</label>
              <select
                value={selectedSttDevice}
                onChange={(e) => void handleSttDeviceChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-brand-500"
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
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-blue-600" />
                <span>{sttFeedback}</span>
              </div>
            )}
          </div>

          {/* 4. 부팅 시 자동 실행 및 시스템 제어 */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-800">컴퓨터를 켤 때 자동 실행</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  부팅 시 백그라운드 트레이로 자동 실행되어 댓글 수집과 출력을 대기합니다.
                </p>
              </div>
              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => void handleToggleAutoStart(e.target.checked)}
                  className="w-4 h-4 rounded text-brand-600 border-slate-300 focus:ring-brand-500 cursor-pointer accent-brand-600"
                />
                <span className="text-xs font-bold text-slate-700">자동 실행</span>
              </label>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void handleRestartServer()}
                disabled={isRestarting}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <Power className="w-3.5 h-3.5 text-rose-500" />
                {isRestarting ? '서버 다시 시작 중...' : '댓글 서버 다시 시작'}
              </button>

              <button
                type="button"
                onClick={() => void commentHelperService.openLogs()}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                진단 로그 파일 열기
              </button>
            </div>
          </div>
        </div>

        {/* 모달 하단 푸터 */}
        <div className="flex-shrink-0 px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            VoiceCAP All-in-One Desktop Runtime
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold shadow-sm transition"
          >
            확인 및 닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
