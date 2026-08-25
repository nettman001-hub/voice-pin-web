import React, { useState, useRef, useEffect } from 'react';
import { useAppData, CAPTURE_PRESETS } from '../../context/AppDataContext';
import { useLive } from '../../context/LiveContext';
import { RecognitionWordRule, RuleAction, CaptureAreaPreset, CaptureAreaConfig } from '../../types/rules';
import { screenCaptureService } from '../../services/screenCaptureService';
import {
  Sliders,
  Plus,
  Trash2,
  Shield,
  Crop,
  Move,
  Maximize2,
  MousePointer,
  Sparkles,
  Eye,
  X,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Monitor,
  Tv,
  Camera,
  Layers,
  Settings2
} from 'lucide-react';

export const RecognitionRulesPage: React.FC = () => {
  const {
    rules,
    addRule,
    updateRule,
    deleteRule,
    toggleRule,
    captureAreaConfig,
    setCaptureAreaConfig
  } = useAppData();
  const { isListening, stopListening, disconnectScreenShare } = useLive();

  const [newWord, setNewWord] = useState('');
  const [newAction, setNewAction] = useState<RuleAction>('DB_SAVE');

  const [modalNotice, setModalNotice] = useState<{
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning';
  } | null>(null);

  const showNotice = (message: string, title = '상황 안내', type: 'info' | 'success' | 'warning' = 'info') => {
    setModalNotice({ title, message, type });
  };

  // 윈도우 데스크톱 해상도 기준 설정
  const [desktopResolution, setDesktopResolution] = useState<{ width: number; height: number; name: string }>({
    width: 1920,
    height: 1080,
    name: '1920 x 1080 (FHD 데스크톱 기본)'
  });

  // 선택 모드
  const [selectMode, setSelectMode] = useState<'DRAG' | 'CLICK_POINTS'>('DRAG');
  const [clickPointStep, setClickPointStep] = useState<1 | 2>(1);
  const [firstPoint, setFirstPoint] = useState<{ x: number; y: number } | null>(null);

  const [currentArea, setCurrentArea] = useState<CaptureAreaConfig>(captureAreaConfig);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragAction, setDragAction] = useState<'CREATE' | 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR' | null>(null);

  const [testCaptureUrl, setTestCaptureUrl] = useState<string | null>(null);
  const [isTestingCapture, setIsTestingCapture] = useState(false);
  const [isScreenConnected, setIsScreenConnected] = useState<boolean>(() => !!screenCaptureService.getActiveStream());

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCurrentArea(captureAreaConfig);
  }, [captureAreaConfig]);

  useEffect(() => screenCaptureService.subscribeConnection((state) => {
    setIsScreenConnected(state.isConnected);
  }), []);

  // 화면 스트림 변경 요청
  const handleChangeScreen = async () => {
    // 처리용 audio clone이 이전 탭을 계속 참조하지 않도록 변경 전에 청취를 종료한다.
    if (isListening) stopListening();
    setIsTestingCapture(true);
    showNotice(
      `변경할 새로운 윈도우 창 또는 모니터 화면을 선택해 주세요.${isListening ? ' 안전한 변경을 위해 기존 청취를 중지했습니다.' : ''}`,
      '🪟 화면 변경 요청',
      'info'
    );
    try {
      const stream = await screenCaptureService.getOrCreateStream(true);
      if (stream) {
        setIsScreenConnected(true);
        showNotice('새로운 윈도우 화면으로 성공적으로 변경되었습니다!', '✅ 화면 변경 완료', 'success');
      }
    } finally {
      setIsTestingCapture(false);
    }
  };

  // 화면 스트림 연결 해제
  const handleDisconnectScreen = () => {
    disconnectScreenShare();
    setIsScreenConnected(false);
    showNotice('윈도우 화면 연결이 정상적으로 해제되었습니다.', '🔌 연결 해제 안내', 'info');
  };

  // 실시간 윈도우 창/화면 캡처 (1회 연결 후 다음부터는 공유창 없이 즉시 캡처)
  const handleTestCapture = async () => {
    setIsTestingCapture(true);
    const hadStream = !!screenCaptureService.getActiveStream();
    if (!hadStream) {
      showNotice('최초 1회 캡처할 윈도우 창(틱톡 라이브 스튜디오/OBS)을 선택해 주세요. 이후부터는 자동으로 즉시 캡처됩니다.', '🪟 윈도우 화면 연결 안내', 'info');
    }
    try {
      const imgUrl = await screenCaptureService.captureArea(null, currentArea, {
        nickname: '러블리샵',
        amount: 35000,
        timestamp: new Date().toLocaleTimeString('ko-KR')
      });
      if (imgUrl) {
        setIsScreenConnected(true);
        setTestCaptureUrl(imgUrl);
      } else {
        setIsScreenConnected(!!screenCaptureService.getActiveStream());
        showNotice('화면 공유가 취소되었거나 창이 선택되지 않았습니다.', 'ℹ️ 안내', 'warning');
      }
    } catch (e) {
      console.error(e);
      showNotice('화면 캡처 처리 중 오류가 발생했습니다.', '⚠️ 오류 발생', 'warning');
    } finally {
      setIsTestingCapture(false);
    }
  };

  const handleAddWord = (e: React.FormEvent) => {
    e.preventDefault();
    const res = addRule(newWord, newAction);
    if (!res.success) {
      showNotice(res.message || '단어 추가에 실패했습니다.', '⚠️ 추가 실패', 'warning');
    } else {
      setNewWord('');
      showNotice(`'${newWord}' 단어가 새로운 인식 규칙으로 추가되었습니다!`, '🎉 단어 규칙 추가 완료', 'success');
    }
  };

  const handleDeleteWord = (id: string, word: string) => {
    const res = deleteRule(id);
    if (!res.success) {
      showNotice(res.message || '삭제할 수 없습니다.', '⚠️ 삭제 실패', 'warning');
    } else {
      showNotice(`'${word}' 단어가 인식 규칙에서 삭제되었습니다.`, '🗑️ 단어 삭제 완료', 'info');
    }
  };

  const handleSelectPreset = (preset: CaptureAreaConfig) => {
    setCurrentArea(preset);
    setCaptureAreaConfig(preset);
    showNotice(`'${preset.name}' 윈도우 데스크톱 영역 프리셋이 적용되었습니다.`, '🪟 프리셋 적용', 'success');
  };

  const getNormalizedCoordinates = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasContainerRef.current) return { x: 0, y: 0 };
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const getNormalizedTouchCoordinates = (touch: React.Touch) => {
    if (!canvasContainerRef.current) return { x: 0, y: 0 };
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const startDrag = (x: number, y: number, actionType: 'CREATE' | 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR') => {
    if (selectMode === 'CLICK_POINTS') return;
    setIsDragging(true);
    setDragAction(actionType);
    setDragStart({ x, y });

    if (actionType === 'CREATE') {
      setCurrentArea({
        preset: 'CUSTOM',
        name: '사용자 지정 영역',
        xRatio: x,
        yRatio: y,
        widthRatio: 0.05,
        heightRatio: 0.05
      });
    }
  };

  const processDrag = (x: number, y: number) => {
    if (!isDragging || !dragStart || selectMode === 'CLICK_POINTS') return;

    if (dragAction === 'CREATE') {
      const minX = Math.min(dragStart.x, x);
      const minY = Math.min(dragStart.y, y);
      const width = Math.max(0.04, Math.abs(x - dragStart.x));
      const height = Math.max(0.04, Math.abs(y - dragStart.y));

      setCurrentArea((prev) => ({
        ...prev,
        xRatio: minX,
        yRatio: minY,
        widthRatio: Math.min(1 - minX, width),
        heightRatio: Math.min(1 - minY, height)
      }));
    } else if (dragAction === 'MOVE') {
      const deltaX = x - dragStart.x;
      const deltaY = y - dragStart.y;

      setCurrentArea((prev) => {
        const newX = Math.max(0, Math.min(1 - prev.widthRatio, prev.xRatio + deltaX));
        const newY = Math.max(0, Math.min(1 - prev.heightRatio, prev.yRatio + deltaY));
        return {
          ...prev,
          xRatio: newX,
          yRatio: newY
        };
      });
      setDragStart({ x, y });
    } else if (dragAction === 'RESIZE_BR') {
      const newWidth = Math.max(0.04, Math.min(1 - currentArea.xRatio, x - currentArea.xRatio));
      const newHeight = Math.max(0.04, Math.min(1 - currentArea.yRatio, y - currentArea.yRatio));
      setCurrentArea((prev) => ({
        ...prev,
        widthRatio: newWidth,
        heightRatio: newHeight
      }));
    } else if (dragAction === 'RESIZE_TL') {
      const newX = Math.max(0, Math.min(currentArea.xRatio + currentArea.widthRatio - 0.04, x));
      const newY = Math.max(0, Math.min(currentArea.yRatio + currentArea.heightRatio - 0.04, y));
      const newWidth = currentArea.xRatio + currentArea.widthRatio - newX;
      const newHeight = currentArea.yRatio + currentArea.heightRatio - newY;
      setCurrentArea((prev) => ({
        ...prev,
        xRatio: newX,
        yRatio: newY,
        widthRatio: newWidth,
        heightRatio: newHeight
      }));
    }
  };

  const endDrag = () => {
    if (isDragging) {
      setIsDragging(false);
      setDragAction(null);
      setDragStart(null);
      setCaptureAreaConfig(currentArea);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>, actionType: 'CREATE' | 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR' = 'CREATE') => {
    e.stopPropagation();
    const { x, y } = getNormalizedCoordinates(e);
    startDrag(x, y, actionType);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { x, y } = getNormalizedCoordinates(e);
    processDrag(x, y);
  };

  const handleMouseUp = () => {
    endDrag();
  };

  // 모바일 터치 이벤트 핸들러
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>, actionType: 'CREATE' | 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR' = 'CREATE') => {
    if (e.touches.length === 0) return;
    e.stopPropagation();
    const { x, y } = getNormalizedTouchCoordinates(e.touches[0]);
    startDrag(x, y, actionType);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 0) return;
    const { x, y } = getNormalizedTouchCoordinates(e.touches[0]);
    processDrag(x, y);
  };

  const handleTouchEnd = () => {
    endDrag();
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (selectMode !== 'CLICK_POINTS') return;

    const { x, y } = getNormalizedCoordinates(e);

    if (clickPointStep === 1) {
      setFirstPoint({ x, y });
      setClickPointStep(2);
      showNotice('대각선 끝 지점(우하단)을 클릭하여 캡처 영역을 완성하세요.', '📍 2단계 지점 클릭', 'info');
    } else {
      if (!firstPoint) return;
      const minX = Math.min(firstPoint.x, x);
      const minY = Math.min(firstPoint.y, y);
      const width = Math.max(0.04, Math.abs(x - firstPoint.x));
      const height = Math.max(0.04, Math.abs(y - firstPoint.y));

      const updated: CaptureAreaConfig = {
        preset: 'CUSTOM',
        name: '2점 클릭 지정 영역',
        xRatio: minX,
        yRatio: minY,
        widthRatio: Math.min(1 - minX, width),
        heightRatio: Math.min(1 - minY, height)
      };

      setCurrentArea(updated);
      setCaptureAreaConfig(updated);
      setClickPointStep(1);
      setFirstPoint(null);
      showNotice(`2점 꼭짓점 클릭으로 윈도우 캡처 영역이 지정되었습니다!`, '🎉 캡처 영역 지정 완료', 'success');
    }
  };

  const handleSliderChange = (field: keyof CaptureAreaConfig, value: number) => {
    const updated = {
      ...currentArea,
      preset: 'CUSTOM' as CaptureAreaPreset,
      name: '사용자 미세조정',
      [field]: value
    };
    setCurrentArea(updated);
    setCaptureAreaConfig(updated);
  };

  // 현재 해상도 기준 픽셀 계산
  const pixelX = Math.round(currentArea.xRatio * desktopResolution.width);
  const pixelY = Math.round(currentArea.yRatio * desktopResolution.height);
  const pixelW = Math.round(currentArea.widthRatio * desktopResolution.width);
  const pixelH = Math.round(currentArea.heightRatio * desktopResolution.height);

  return (
    <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* 상단 타이틀 */}
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">캡처 영역 & 단어 규칙 스튜디오</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-cyan-50 text-cyan-800 text-[11px] sm:text-xs font-bold border border-cyan-200 flex items-center space-x-1">
              <Monitor className="w-3.5 h-3.5" />
              <span>윈도우 데스크톱 기준</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            윈도우 PC(16:9 모니터)에서 실행 중인 틱톡 라이브 스튜디오 / OBS 화면 위의 댓글창·주문창 캡처 영역을 정밀하게 지정합니다.
          </p>
        </div>

        {/* 윈도우 해상도 선택 셀렉터 (모바일 가로 스크롤) */}
        <div className="flex items-center space-x-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 text-xs overflow-x-auto no-scrollbar max-w-full">
          <span className="text-slate-500 font-bold px-1 flex items-center space-x-1 whitespace-nowrap flex-shrink-0">
            <Tv className="w-3.5 h-3.5 text-brand-600" />
            <span>기준 해상도:</span>
          </span>
          {[
            { width: 3840, height: 2160, name: '3840x2160 (4K UHD)' },
            { width: 2560, height: 1440, name: '2560x1440 (QHD)' },
            { width: 1920, height: 1080, name: '1920x1080 (FHD)' },
          ].map((res) => (
            <button
              key={res.name}
              onClick={() => setDesktopResolution({ ...res, name: `${res.width} x ${res.height}` })}
              className={`px-3 py-1.5 rounded-xl font-bold transition whitespace-nowrap flex-shrink-0 ${
                desktopResolution.width === res.width
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {res.name}
            </button>
          ))}
        </div>
      </div>

      {/* 1. 윈도우 데스크톱 화면 캡처 영역 설정 스튜디오 (핵심) */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center space-x-2">
              <Crop className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" />
              <span>윈도우 데스크톱 캡처 영역 스튜디오</span>
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
              16:9 가로형 모니터 화면에서 댓글창 또는 OBS 송출창 위치를 마우스/터치로 직접 지정하세요.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isScreenConnected ? (
              <>
                <span className="px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] sm:text-xs font-bold flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>화면 연결됨</span>
                </span>

                <button
                  onClick={handleTestCapture}
                  disabled={isTestingCapture}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-500/20 flex items-center space-x-1.5 transition active:scale-95"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{isTestingCapture ? '캡처 중...' : '실시간 즉시 캡처'}</span>
                </button>

                <button
                  onClick={handleChangeScreen}
                  disabled={isTestingCapture}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition"
                  title="다른 윈도우 창 또는 모니터로 화면 변경"
                >
                  변경
                </button>

                <button
                  onClick={handleDisconnectScreen}
                  className="px-2.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold border border-rose-200 transition"
                  title="화면 연결 해제"
                >
                  해제
                </button>
              </>
            ) : (
              <button
                onClick={handleTestCapture}
                disabled={isTestingCapture}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 via-brand-600 to-indigo-600 hover:from-cyan-500 hover:to-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/20 flex items-center justify-center space-x-2 transition transform active:scale-95"
              >
                <Camera className="w-4 h-4" />
                <span>{isTestingCapture ? '화면 연결 중...' : '실시간 캡처 테스트 (1회 화면 연결)'}</span>
              </button>
            )}
          </div>
        </div>

        {/* 툴바 & 프리셋 (모바일 가로 스크롤 지원) */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 bg-slate-50 p-2.5 sm:p-3 rounded-2xl border border-slate-200">
          <div className="grid grid-cols-2 sm:flex items-center gap-1.5 text-xs">
            <button
              onClick={() => setSelectMode('DRAG')}
              className={`px-3 py-2 sm:py-1.5 rounded-xl font-bold flex items-center justify-center space-x-1 transition ${
                selectMode === 'DRAG'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 bg-white sm:bg-transparent border sm:border-0 border-slate-200'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              <span>직접 드래그/터치</span>
            </button>
            <button
              onClick={() => { setSelectMode('CLICK_POINTS'); setClickPointStep(1); setFirstPoint(null); }}
              className={`px-3 py-2 sm:py-1.5 rounded-xl font-bold flex items-center justify-center space-x-1 transition ${
                selectMode === 'CLICK_POINTS'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 bg-white sm:bg-transparent border sm:border-0 border-slate-200'
              }`}
            >
              <MousePointer className="w-3.5 h-3.5" />
              <span>2회 터치 지정</span>
            </button>
          </div>

          <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-1 text-xs">
            <span className="text-slate-500 px-1 font-semibold flex-shrink-0">프리셋:</span>
            {CAPTURE_PRESETS.map((p, idx) => (
              <button
                key={idx}
                onClick={() => handleSelectPreset(p)}
                className={`px-2.5 py-1.5 rounded-xl font-semibold border transition whitespace-nowrap flex-shrink-0 ${
                  currentArea.name === p.name
                    ? 'bg-brand-50 border-brand-300 text-brand-700 font-bold shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* 2열 스튜디오 그리드 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
          {/* 좌측 16:9 와이드 윈도우 데스크톱 캔버스 */}
          <div className="lg:col-span-7 flex flex-col items-center">
            <div className="text-center text-xs font-semibold text-slate-600 mb-2 flex items-center space-x-1">
              <Sparkles className="w-3.5 h-3.5 text-brand-600" />
              <span>
                {selectMode === 'DRAG'
                  ? '화면 위를 손가락/마우스로 드래그하거나 모서리 핸들을 조절하세요'
                  : clickPointStep === 1
                  ? '📍 [1단계] 시작할 좌상단 지점을 터치하세요'
                  : '📍 [2단계] 대각선 끝 우하단 지점을 터치하세요'}
              </span>
            </div>

            {/* 16:9 와이드 데스크톱 프레임 */}
            <div className="w-full bg-slate-800 rounded-3xl p-2.5 sm:p-3 shadow-2xl border-4 border-slate-700">
              {/* 윈도우 타이틀 바 */}
              <div className="flex items-center justify-between px-2 pb-2 text-[10px] sm:text-[11px] text-slate-400 select-none">
                <div className="flex items-center space-x-2 truncate">
                  <Monitor className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <span className="font-bold text-slate-200 truncate">TikTok Live Studio ({desktopResolution.width}x{desktopResolution.height})</span>
                </div>
                <div className="flex items-center space-x-1.5 flex-shrink-0">
                  <span className="w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full bg-slate-500"></span>
                  <span className="w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full bg-slate-500"></span>
                  <span className="w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full bg-rose-500"></span>
                </div>
              </div>

              {/* 16:9 캔버스 본체 (touch-none 적용으로 모바일 터치 드래그 완벽 지원) */}
              <div
                ref={canvasContainerRef}
                onMouseDown={(e) => handleMouseDown(e, 'CREATE')}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onTouchStart={(e) => handleTouchStart(e, 'CREATE')}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onClick={handleCanvasClick}
                className="relative w-full aspect-video bg-slate-950 rounded-2xl overflow-hidden cursor-crosshair select-none border border-slate-700 shadow-inner grid grid-cols-12 gap-1.5 sm:gap-2 p-1.5 sm:p-2 touch-none"
                style={{
                  backgroundImage: 'radial-gradient(circle at 50% 50%, #1e1b4b 0%, #0f172a 100%)'
                }}
              >
                {/* 윈도우 데스크톱 내부 UI: 1) 좌측 도구창 */}
                <div className="col-span-3 bg-slate-900/80 rounded-xl p-1.5 sm:p-2.5 border border-white/5 pointer-events-none flex flex-col justify-between text-[8px] sm:text-[10px]">
                  <div className="space-y-1">
                    <div className="text-cyan-400 font-bold flex items-center space-x-1">
                      <Settings2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      <span className="truncate">스튜디오 설정</span>
                    </div>
                    <div className="bg-white/5 p-1 rounded text-slate-300 truncate">🎙️ Mic</div>
                    <div className="bg-white/5 p-1 rounded text-slate-300 truncate">📹 1080p</div>
                  </div>
                  <div className="p-1 sm:p-1.5 bg-rose-500/20 border border-rose-500/40 rounded text-rose-300 font-bold text-center text-[8px] sm:text-[9px]">
                    🔴 LIVE
                  </div>
                </div>

                {/* 윈도우 데스크톱 내부 UI: 2) 중앙 라이브 방송 메인 프리뷰 */}
                <div className="col-span-5 bg-black/60 rounded-xl p-1.5 sm:p-2 border border-white/5 pointer-events-none flex flex-col justify-between items-center text-center">
                  <div className="w-full flex items-center justify-between text-[8px] sm:text-[10px] text-white">
                    <span className="bg-rose-600 px-1.5 py-0.2 rounded font-bold">LIVE</span>
                    <span className="text-cyan-300 font-bold text-[8px] sm:text-[10px]">3,842명</span>
                  </div>

                  <div className="p-1.5 sm:p-2.5 bg-white/10 rounded-xl border border-white/10 text-white space-y-0.5 sm:space-y-1">
                    <div className="text-[8px] sm:text-[10px] text-amber-300 font-bold">✨ 실시간 특가</div>
                    <div className="text-[9px] sm:text-xs font-bold truncate">린넨 셔츠</div>
                    <div className="text-[10px] sm:text-sm font-black text-white">35,000원</div>
                  </div>

                  <div className="w-full text-[8px] sm:text-[9px] text-slate-400 bg-black/40 py-0.5 rounded truncate">
                    OBS 송출 화면
                  </div>
                </div>

                {/* 윈도우 데스크톱 내부 UI: 3) 우측 틱톡 실시간 댓글 및 주문 패널 */}
                <div className="col-span-4 bg-slate-900/90 rounded-xl p-1.5 sm:p-2.5 border border-white/10 pointer-events-none flex flex-col justify-between text-[8px] sm:text-[10px]">
                  <div className="font-bold text-cyan-300 border-b border-white/10 pb-1 flex items-center justify-between">
                    <span className="truncate">💬 댓글창</span>
                    <span className="text-[8px] text-slate-400">실시간</span>
                  </div>

                  <div className="space-y-1 my-1 overflow-hidden text-left text-[8px] sm:text-[9px]">
                    <div className="bg-white/5 p-1 rounded text-slate-200 truncate">
                      <strong className="text-brand-300">러블리:</strong> 구매확정!
                    </div>
                    <div className="bg-white/5 p-1 rounded text-slate-200 truncate">
                      <strong className="text-purple-300">달콤:</strong> 구매할게요
                    </div>
                  </div>

                  <div className="p-1 bg-brand-500/20 border border-brand-500/30 rounded text-center text-brand-300 font-bold text-[8px]">
                    캡처 타겟
                  </div>
                </div>

                {/* 사용자 인터랙티브 바운딩 박스 (오버레이) */}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'MOVE')}
                  onTouchStart={(e) => handleTouchStart(e, 'MOVE')}
                  className="absolute border-2 border-cyan-400 bg-cyan-400/20 shadow-2xl transition-all cursor-move group z-20 touch-none"
                  style={{
                    left: `${currentArea.xRatio * 100}%`,
                    top: `${currentArea.yRatio * 100}%`,
                    width: `${currentArea.widthRatio * 100}%`,
                    height: `${currentArea.heightRatio * 100}%`
                  }}
                >
                  <div className="absolute -top-5 sm:-top-6 left-0 bg-cyan-500 text-slate-950 text-[9px] sm:text-[10px] font-black px-1.5 py-0.2 sm:py-0.5 rounded shadow whitespace-nowrap z-30">
                    📸 {currentArea.name} ({pixelW}x{pixelH}px)
                  </div>

                  {/* 4개 모서리 리사이즈 핸들 (모바일 터치 타깃 w-5 h-5 이상으로 확대) */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'RESIZE_TL')}
                    onTouchStart={(e) => handleTouchStart(e, 'RESIZE_TL')}
                    className="absolute -top-2.5 -left-2.5 w-5 h-5 bg-white border-2 border-cyan-500 rounded-full cursor-nwse-resize hover:scale-125 active:scale-150 transition-transform shadow z-30 touch-none"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'RESIZE_TR')}
                    onTouchStart={(e) => handleTouchStart(e, 'RESIZE_TR')}
                    className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-white border-2 border-cyan-500 rounded-full cursor-nesw-resize hover:scale-125 active:scale-150 transition-transform shadow z-30 touch-none"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'RESIZE_BL')}
                    onTouchStart={(e) => handleTouchStart(e, 'RESIZE_BL')}
                    className="absolute -bottom-2.5 -left-2.5 w-5 h-5 bg-white border-2 border-cyan-500 rounded-full cursor-nesw-resize hover:scale-125 active:scale-150 transition-transform shadow z-30 touch-none"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'RESIZE_BR')}
                    onTouchStart={(e) => handleTouchStart(e, 'RESIZE_BR')}
                    className="absolute -bottom-2.5 -right-2.5 w-5 h-5 bg-white border-2 border-cyan-500 rounded-full cursor-nwse-resize hover:scale-125 active:scale-150 transition-transform shadow z-30 touch-none"
                  />

                  <div className="w-full h-full flex items-center justify-center opacity-30 pointer-events-none">
                    <Maximize2 className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
                  </div>
                </div>

                {/* 2점 클릭 모드 1단계 핑 애니메이션 */}
                {selectMode === 'CLICK_POINTS' && firstPoint && (
                  <div
                    className="absolute w-5 h-5 bg-rose-500 border-2 border-white rounded-full -translate-x-1/2 -translate-y-1/2 shadow-lg animate-ping z-30 pointer-events-none"
                    style={{ left: `${firstPoint.x * 100}%`, top: `${firstPoint.y * 100}%` }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* 우측 윈도우 데스크톱 수치 정밀 조정 패널 */}
          <div className="lg:col-span-5 space-y-4 bg-slate-50 p-4 sm:p-6 rounded-3xl border border-slate-200">
            <div className="flex items-center justify-between">
              <h4 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-1.5">
                <Sliders className="w-4 h-4 text-brand-600" />
                <span>데스크톱 픽셀 & 비율 미세조정</span>
              </h4>
              <button
                onClick={() => handleSelectPreset(CAPTURE_PRESETS[0])}
                className="text-[10px] sm:text-[11px] text-slate-500 hover:text-slate-800 flex items-center space-x-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>초기화</span>
              </button>
            </div>

            {/* 현재 영역 요약 카드 */}
            <div className="p-3.5 rounded-2xl bg-white border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">현재 영역 이름:</span>
                <span className="font-bold text-slate-900">{currentArea.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">윈도우 환산 해상도:</span>
                <span className="font-black text-brand-600 text-sm">
                  {pixelW} × {pixelH} <span className="text-xs font-normal text-slate-400">px</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">시작 좌표 (X, Y):</span>
                <span className="font-mono text-slate-700">X: {pixelX}px, Y: {pixelY}px</span>
              </div>
            </div>

            {/* 정밀 슬라이더들 */}
            <div className="space-y-3 text-xs pt-1">
              <div>
                <div className="flex justify-between text-slate-600 mb-1">
                  <span>좌측 시작 위치 (X 좌표)</span>
                  <span className="font-bold text-slate-900">{pixelX}px ({Math.round(currentArea.xRatio * 100)}%)</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.9"
                  step="0.01"
                  value={currentArea.xRatio}
                  onChange={(e) => handleSliderChange('xRatio', parseFloat(e.target.value))}
                  className="w-full accent-brand-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-600 mb-1">
                  <span>상단 시작 위치 (Y 좌표)</span>
                  <span className="font-bold text-slate-900">{pixelY}px ({Math.round(currentArea.yRatio * 100)}%)</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.9"
                  step="0.01"
                  value={currentArea.yRatio}
                  onChange={(e) => handleSliderChange('yRatio', parseFloat(e.target.value))}
                  className="w-full accent-brand-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-600 mb-1">
                  <span>캡처 영역 가로 폭 (Width)</span>
                  <span className="font-bold text-slate-900">{pixelW}px ({Math.round(currentArea.widthRatio * 100)}%)</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={currentArea.widthRatio}
                  onChange={(e) => handleSliderChange('widthRatio', parseFloat(e.target.value))}
                  className="w-full accent-brand-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-600 mb-1">
                  <span>캡처 영역 세로 높이 (Height)</span>
                  <span className="font-bold text-slate-900">{pixelH}px ({Math.round(currentArea.heightRatio * 100)}%)</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={currentArea.heightRatio}
                  onChange={(e) => handleSliderChange('heightRatio', parseFloat(e.target.value))}
                  className="w-full accent-brand-600"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => {
                  setCaptureAreaConfig(currentArea);
                  showNotice(`윈도우 캡처 영역(${pixelW}x${pixelH}px) 설정이 안전하게 저장되었습니다! 💾`, '💾 설정 저장 완료', 'success');
                }}
                className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 transition"
              >
                현재 윈도우 영역 설정 저장하기
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 단어 인식 규칙 목록 & 추가 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4 sm:space-y-6">
        <div className="border-b border-slate-100 pb-3 sm:pb-4">
          <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center space-x-2">
            <Sliders className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" />
            <span>음성 키워드 인식 규칙 관리</span>
          </h3>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
            특정 단어 발화 시 실행할 동작(DB 판매 저장, 화면 캡처, 동시 실행)을 관리합니다.
          </p>
        </div>

        {/* 신규 단어 추가 폼 */}
        <form onSubmit={handleAddWord} className="p-3 sm:p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row gap-2.5 sm:gap-3">
          <input
            type="text"
            required
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="인식할 키워드 (예: 구매확정, 주문, 캡처)"
            className="flex-1 px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 font-bold"
          />

          <select
            value={newAction}
            onChange={(e) => setNewAction(e.target.value as RuleAction)}
            className="px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-brand-500"
          >
            <option value="DB_SAVE">💾 DB 판매 자동 저장</option>
            <option value="SCREEN_CAPTURE">📸 지정 윈도우 화면 캡처</option>
            <option value="DB_SAVE_AND_CAPTURE">⚡ DB 저장 + 화면 캡처 동시</option>
          </select>

          <button
            type="submit"
            className="px-4 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-500/20 flex items-center justify-center space-x-1 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>단어 규칙 추가</span>
          </button>
        </form>

        {/* 규칙 목록 테이블 */}
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs hover:border-slate-300 transition"
            >
              <div className="flex items-center space-x-3 w-full sm:w-auto">
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                    rule.isEnabled ? 'bg-brand-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      rule.isEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2 flex-wrap gap-1">
                    <span className="font-bold text-slate-900 text-sm">{rule.word}</span>
                    {rule.isEssential && (
                      <span className="px-2 py-0.2 sm:py-0.5 rounded bg-amber-50 text-amber-800 text-[9px] sm:text-[10px] font-bold border border-amber-200">
                        필수 단어
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-[11px] mt-0.5 truncate">{rule.description || '지정된 동작을 자동 수행합니다.'}</p>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end space-x-3 w-full sm:w-auto border-t sm:border-t-0 border-slate-200/60 pt-2 sm:pt-0">
                <span className={`px-2.5 py-1 rounded-xl text-[10px] sm:text-[11px] font-bold ${
                  rule.action === 'DB_SAVE'
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : rule.action === 'SCREEN_CAPTURE'
                    ? 'bg-cyan-50 text-cyan-700 border border-cyan-200'
                    : 'bg-purple-50 text-purple-700 border border-purple-200'
                }`}>
                  {rule.action === 'DB_SAVE' ? '💾 DB 저장' : rule.action === 'SCREEN_CAPTURE' ? '📸 윈도우 캡처' : '⚡ DB저장 + 캡처'}
                </span>

                {!rule.isEssential && (
                  <button
                    onClick={() => handleDeleteWord(rule.id, rule.word)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                    title="삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 상황 안내 멘트 모달 새 창 */}
      {modalNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className={`p-3 rounded-2xl ${
                  modalNotice.type === 'success'
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                    : modalNotice.type === 'warning'
                    ? 'bg-rose-50 text-rose-600 border border-rose-200'
                    : 'bg-brand-50 text-brand-600 border border-brand-200'
                }`}>
                  {modalNotice.type === 'success' ? (
                    <CheckCircle2 className="w-6 h-6" />
                  ) : modalNotice.type === 'warning' ? (
                    <AlertCircle className="w-6 h-6" />
                  ) : (
                    <Sparkles className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">{modalNotice.title}</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">VoiceCAP 시스템 상황 안내</p>
                </div>
              </div>
              <button
                onClick={() => setModalNotice(null)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-sm text-slate-800 font-semibold leading-relaxed">
              {modalNotice.message}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setModalNotice(null)}
                className={`w-full py-3 rounded-xl text-white font-bold text-xs shadow-md transition ${
                  modalNotice.type === 'success'
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20'
                    : modalNotice.type === 'warning'
                    ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-500/20'
                    : 'bg-brand-600 hover:bg-brand-500 shadow-brand-500/20'
                }`}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 실시간 캡처 테스트 결과 모달 */}
      {testCaptureUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <Camera className="w-5 h-5 text-cyan-600" />
                  <span>실시간 윈도우 캡처 테스트 결과</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  지정한 윈도우 영역({pixelW}x{pixelH}px)이 잘 캡처되었는지 확인하세요.
                </p>
              </div>
              <button
                onClick={() => setTestCaptureUrl(null)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-950 flex items-center justify-center p-2">
              <img src={testCaptureUrl} alt="캡처 테스트 결과" className="max-h-[350px] w-auto rounded-lg object-contain" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setTestCaptureUrl(null)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
              >
                확인 및 닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
