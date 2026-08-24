import React, { useState, useRef, useEffect } from 'react';
import { useAppData, CAPTURE_PRESETS } from '../../context/AppDataContext';
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

  const [newWord, setNewWord] = useState('');
  const [newAction, setNewAction] = useState<RuleAction>('DB_SAVE');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

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

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCurrentArea(captureAreaConfig);
  }, [captureAreaConfig]);

  const handleAddWord = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const res = addRule(newWord, newAction);
    if (!res.success) {
      setErrorMsg(res.message || '단어 추가에 실패했습니다.');
    } else {
      setNewWord('');
      setToastMsg(`'${newWord}' 단어가 인식 규칙에 추가되었습니다.`);
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  const handleDeleteWord = (id: string, word: string) => {
    setErrorMsg(null);
    const res = deleteRule(id);
    if (!res.success) {
      setErrorMsg(res.message || '삭제할 수 없습니다.');
    } else {
      setToastMsg(`'${word}' 단어가 삭제되었습니다.`);
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  const handleSelectPreset = (preset: CaptureAreaConfig) => {
    setCurrentArea(preset);
    setCaptureAreaConfig(preset);
    setToastMsg(`'${preset.name}' 윈도우 데스크톱 영역 프리셋이 적용되었습니다.`);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const getNormalizedCoordinates = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasContainerRef.current) return { x: 0, y: 0 };
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>, actionType: 'CREATE' | 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR' = 'CREATE') => {
    if (selectMode === 'CLICK_POINTS') return;

    e.stopPropagation();
    const { x, y } = getNormalizedCoordinates(e);
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

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart || selectMode === 'CLICK_POINTS') return;

    const { x, y } = getNormalizedCoordinates(e);

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

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      setDragAction(null);
      setDragStart(null);
      setCaptureAreaConfig(currentArea);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (selectMode !== 'CLICK_POINTS') return;

    const { x, y } = getNormalizedCoordinates(e);

    if (clickPointStep === 1) {
      setFirstPoint({ x, y });
      setClickPointStep(2);
      setToastMsg('📍 [1단계 완료] 대각선 끝 지점(우하단)을 클릭하세요.');
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
      setToastMsg('🎉 2점 꼭짓점 클릭으로 윈도우 캡처 영역이 지정되었습니다!');
      setTimeout(() => setToastMsg(null), 3000);
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

  // 실시간 윈도우 화면 캡처 테스트
  const handleTestCapture = async () => {
    setIsTestingCapture(true);
    setToastMsg('🪟 캡처할 윈도우 창(틱톡 라이브 스튜디오 / OBS) 또는 화면을 선택해 주세요.');
    try {
      const imgUrl = await screenCaptureService.captureArea(null, currentArea, {
        nickname: '러블리샵',
        amount: 35000,
        timestamp: new Date().toLocaleTimeString('ko-KR')
      });
      if (imgUrl) {
        setTestCaptureUrl(imgUrl);
        setToastMsg('📸 선택한 윈도우 영역의 실시간 캡처가 완료되었습니다!');
      }
    } catch (e) {
      console.error(e);
      alert('화면 캡처 테스트 중 오류가 발생했습니다.');
    } finally {
      setIsTestingCapture(false);
    }
  };

  // 현재 해상도 기준 픽셀 계산
  const pixelX = Math.round(currentArea.xRatio * desktopResolution.width);
  const pixelY = Math.round(currentArea.yRatio * desktopResolution.height);
  const pixelW = Math.round(currentArea.widthRatio * desktopResolution.width);
  const pixelH = Math.round(currentArea.heightRatio * desktopResolution.height);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* 상단 타이틀 */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">캡처 영역 & 단어 규칙 스튜디오</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-cyan-50 text-cyan-800 text-xs font-bold border border-cyan-200 flex items-center space-x-1">
              <Monitor className="w-3.5 h-3.5" />
              <span>윈도우 데스크톱 기준</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            윈도우 PC(16:9 모니터)에서 실행 중인 틱톡 라이브 스튜디오 / OBS 화면 위의 댓글창·주문창 캡처 영역을 정밀하게 지정합니다.
          </p>
        </div>

        {/* 윈도우 해상도 선택 셀렉터 (스크롤 없이 컴팩트) */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 text-xs">
          <span className="text-slate-500 font-bold px-1 flex items-center space-x-1 whitespace-nowrap">
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
              className={`px-3 py-1.5 rounded-xl font-bold transition whitespace-nowrap ${
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

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 1. 윈도우 데스크톱 화면 캡처 영역 설정 스튜디오 (핵심) */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-black text-slate-900 flex items-center space-x-2">
              <Crop className="w-5 h-5 text-brand-600" />
              <span>윈도우 데스크톱 캡처 영역 스튜디오</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              16:9 가로형 윈도우 모니터 화면에서 틱톡 라이브 스튜디오 댓글창 또는 OBS 송출창 위치를 마우스로 직접 지정하세요.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleTestCapture}
              disabled={isTestingCapture}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-brand-600 hover:from-cyan-500 hover:to-brand-500 text-white text-xs font-bold shadow-md shadow-cyan-500/20 flex items-center space-x-1.5 transition"
            >
              <Camera className="w-4 h-4" />
              <span>{isTestingCapture ? '캡처 중...' : '실시간 캡처 테스트'}</span>
            </button>
          </div>
        </div>

        {/* 툴바 & 프리셋 (스크롤 없이 flex-wrap) */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-bold px-1">조작 모드:</span>
            <button
              onClick={() => setSelectMode('DRAG')}
              className={`px-3 py-1.5 rounded-xl font-bold flex items-center space-x-1 transition ${
                selectMode === 'DRAG'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              <span>마우스 직접 드래그</span>
            </button>
            <button
              onClick={() => { setSelectMode('CLICK_POINTS'); setClickPointStep(1); setFirstPoint(null); }}
              className={`px-3 py-1.5 rounded-xl font-bold flex items-center space-x-1 transition ${
                selectMode === 'CLICK_POINTS'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MousePointer className="w-3.5 h-3.5" />
              <span>끝 꼭짓점 2회 클릭</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500 px-1 font-semibold">윈도우 프리셋:</span>
            {CAPTURE_PRESETS.map((p, idx) => (
              <button
                key={idx}
                onClick={() => handleSelectPreset(p)}
                className={`px-2.5 py-1.5 rounded-xl font-semibold border transition whitespace-nowrap ${
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* 좌측 16:9 와이드 윈도우 데스크톱 캔버스 */}
          <div className="lg:col-span-7 flex flex-col items-center">
            <div className="text-center text-xs font-semibold text-slate-600 mb-2 flex items-center space-x-1">
              <Sparkles className="w-3.5 h-3.5 text-brand-600" />
              <span>
                {selectMode === 'DRAG'
                  ? '윈도우 모니터 위를 마우스로 드래그하거나 모서리 핸들을 조절하세요'
                  : clickPointStep === 1
                  ? '📍 [1단계] 시작할 좌상단 꼭짓점을 클릭하세요'
                  : '📍 [2단계] 대각선 끝 우하단 꼭짓점을 클릭하세요'}
              </span>
            </div>

            {/* 16:9 와이드 데스크톱 프레임 */}
            <div className="w-full bg-slate-800 rounded-3xl p-3 shadow-2xl border-4 border-slate-700">
              {/* 윈도우 타이틀 바 */}
              <div className="flex items-center justify-between px-2 pb-2 text-[11px] text-slate-400 select-none">
                <div className="flex items-center space-x-2">
                  <Monitor className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-bold text-slate-200">Windows Desktop - TikTok Live Studio ({desktopResolution.width}x{desktopResolution.height})</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-500"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-500"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                </div>
              </div>

              {/* 16:9 캔버스 본체 */}
              <div
                ref={canvasContainerRef}
                onMouseDown={(e) => handleMouseDown(e, 'CREATE')}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onClick={handleCanvasClick}
                className="relative w-full aspect-video bg-slate-950 rounded-2xl overflow-hidden cursor-crosshair select-none border border-slate-700 shadow-inner grid grid-cols-12 gap-2 p-2"
                style={{
                  backgroundImage: 'radial-gradient(circle at 50% 50%, #1e1b4b 0%, #0f172a 100%)'
                }}
              >
                {/* 윈도우 데스크톱 내부 UI: 1) 좌측 도구창 */}
                <div className="col-span-3 bg-slate-900/80 rounded-xl p-2.5 border border-white/5 pointer-events-none flex flex-col justify-between text-[10px]">
                  <div className="space-y-1.5">
                    <div className="text-cyan-400 font-bold flex items-center space-x-1">
                      <Settings2 className="w-3 h-3" />
                      <span>스튜디오 설정</span>
                    </div>
                    <div className="bg-white/5 p-1.5 rounded text-slate-300">🎙️ 마이크: Realtek Audio</div>
                    <div className="bg-white/5 p-1.5 rounded text-slate-300">📹 카메라: 1080p 60fps</div>
                    <div className="bg-white/5 p-1.5 rounded text-slate-300">🌐 송출 비트레이트: 6000k</div>
                  </div>
                  <div className="p-2 bg-rose-500/20 border border-rose-500/40 rounded text-rose-300 font-bold text-center">
                    🔴 LIVE 송출 중
                  </div>
                </div>

                {/* 윈도우 데스크톱 내부 UI: 2) 중앙 라이브 방송 메인 프리뷰 */}
                <div className="col-span-5 bg-black/60 rounded-xl p-2 border border-white/5 pointer-events-none flex flex-col justify-between items-center text-center">
                  <div className="w-full flex items-center justify-between text-[10px] text-white">
                    <span className="bg-rose-600 px-2 py-0.5 rounded font-bold">LIVE</span>
                    <span className="text-cyan-300 font-bold">시청자 3,842명</span>
                  </div>

                  <div className="p-3 bg-white/10 rounded-xl border border-white/10 text-white space-y-1">
                    <div className="text-[10px] text-amber-300 font-bold">✨ 실시간 특가 판매 중</div>
                    <div className="text-xs font-bold">프리미엄 린넨 셔츠</div>
                    <div className="text-sm font-black text-white">35,000원</div>
                  </div>

                  <div className="w-full text-[10px] text-slate-400 bg-black/40 py-1 rounded">
                    중앙 OBS 송출 화면
                  </div>
                </div>

                {/* 윈도우 데스크톱 내부 UI: 3) 우측 틱톡 실시간 댓글 및 주문 패널 */}
                <div className="col-span-4 bg-slate-900/90 rounded-xl p-2.5 border border-white/10 pointer-events-none flex flex-col justify-between text-[10px]">
                  <div className="font-bold text-cyan-300 border-b border-white/10 pb-1 flex items-center justify-between">
                    <span>💬 틱톡 실시간 댓글 & 주문창</span>
                    <span className="text-[9px] text-slate-400">실시간</span>
                  </div>

                  <div className="space-y-1.5 my-1 overflow-hidden text-left">
                    <div className="bg-white/5 p-1.5 rounded text-slate-200">
                      <strong className="text-brand-300">러블리:</strong> 구매확정합니다! 입금완료요~
                    </div>
                    <div className="bg-white/5 p-1.5 rounded text-slate-200">
                      <strong className="text-purple-300">달콤한하루:</strong> 저도 바로 구매할게요!!
                    </div>
                    <div className="bg-white/5 p-1.5 rounded text-slate-300">
                      <strong className="text-emerald-300">민트초코:</strong> 35,000원 확인 부탁드려요
                    </div>
                    <div className="bg-white/5 p-1.5 rounded text-slate-400">
                      <strong className="text-slate-400">햇살가득:</strong> 캡처 부탁드립니다!
                    </div>
                  </div>

                  <div className="p-1 bg-brand-500/20 border border-brand-500/30 rounded text-center text-brand-300 font-bold text-[9px]">
                    ✨ VoiceCAP 자동 캡처 타겟 패널
                  </div>
                </div>

                {/* 사용자 인터랙티브 바운딩 박스 (오버레이) */}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'MOVE')}
                  className="absolute border-2 border-cyan-400 bg-cyan-400/20 shadow-2xl transition-all cursor-move group z-20"
                  style={{
                    left: `${currentArea.xRatio * 100}%`,
                    top: `${currentArea.yRatio * 100}%`,
                    width: `${currentArea.widthRatio * 100}%`,
                    height: `${currentArea.heightRatio * 100}%`
                  }}
                >
                  <div className="absolute -top-6 left-0 bg-cyan-500 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded shadow whitespace-nowrap z-30">
                    📸 {currentArea.name} ({pixelW}x{pixelH}px)
                  </div>

                  {/* 4개 모서리 리사이즈 핸들 */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'RESIZE_TL')}
                    className="absolute -top-2 -left-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full cursor-nwse-resize hover:scale-125 transition-transform shadow z-30"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'RESIZE_TR')}
                    className="absolute -top-2 -right-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full cursor-nesw-resize hover:scale-125 transition-transform shadow z-30"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'RESIZE_BL')}
                    className="absolute -bottom-2 -left-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full cursor-nesw-resize hover:scale-125 transition-transform shadow z-30"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'RESIZE_BR')}
                    className="absolute -bottom-2 -right-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full cursor-nwse-resize hover:scale-125 transition-transform shadow z-30"
                  />

                  <div className="w-full h-full flex items-center justify-center opacity-30 pointer-events-none">
                    <Maximize2 className="w-6 h-6 text-white" />
                  </div>
                </div>

                {/* 2점 클릭 모드 1단계 핑 애니메이션 */}
                {selectMode === 'CLICK_POINTS' && firstPoint && (
                  <div
                    className="absolute w-5 h-5 bg-rose-500 border-2 border-white rounded-full -translate-x-1/2 -translate-y-1/2 shadow-lg animate-ping z-30"
                    style={{ left: `${firstPoint.x * 100}%`, top: `${firstPoint.y * 100}%` }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* 우측 윈도우 데스크톱 수치 정밀 조정 패널 */}
          <div className="lg:col-span-5 space-y-4 bg-slate-50 p-6 rounded-3xl border border-slate-200">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5">
                <Sliders className="w-4 h-4 text-brand-600" />
                <span>데스크톱 픽셀 & 비율 미세조정</span>
              </h4>
              <button
                onClick={() => handleSelectPreset(CAPTURE_PRESETS[0])}
                className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center space-x-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>기본값 초기화</span>
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
                  setToastMsg('윈도우 데스크톱 캡처 설정이 성공적으로 저장되었습니다! 💾');
                  setTimeout(() => setToastMsg(null), 3000);
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
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
        <div className="border-b border-slate-100 pb-4">
          <h3 className="text-base font-black text-slate-900 flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-brand-600" />
            <span>음성 키워드 인식 규칙 관리</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            특정 단어 발화 시 실행할 동작(DB 판매 저장, 화면 캡처, 동시 실행)을 관리합니다.
          </p>
        </div>

        {/* 신규 단어 추가 폼 */}
        <form onSubmit={handleAddWord} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            required
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="인식할 키워드 (예: 구매확정, 주문, 캡처)"
            className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 font-bold"
          />

          <select
            value={newAction}
            onChange={(e) => setNewAction(e.target.value as RuleAction)}
            className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-brand-500"
          >
            <option value="DB_SAVE">💾 DB 판매 자동 저장</option>
            <option value="SCREEN_CAPTURE">📸 지정 윈도우 화면 캡처</option>
            <option value="DB_SAVE_AND_CAPTURE">⚡ DB 저장 + 화면 캡처 동시</option>
          </select>

          <button
            type="submit"
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-500/20 flex items-center justify-center space-x-1 transition"
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
              className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs hover:border-slate-300 transition"
            >
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${
                    rule.isEnabled ? 'bg-brand-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      rule.isEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>

                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900 text-sm">{rule.word}</span>
                    {rule.isEssential && (
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
                        필수 단어
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-[11px] mt-0.5">{rule.description || '지정된 동작을 자동 수행합니다.'}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <span className={`px-2.5 py-1 rounded-xl text-[11px] font-bold ${
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
