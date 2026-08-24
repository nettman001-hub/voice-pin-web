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
  AlertCircle
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
      setToastMsg(`'${newWord}' 단어가 인식 규칙 및 Deepgram 키워드 바이어싱에 추가되었습니다.`);
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
    setToastMsg(`'${preset.name}' 영역 프리셋이 적용되었습니다.`);
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
    setDragStart({ x, y });
    setDragAction(actionType);

    if (actionType === 'CREATE') {
      setCurrentArea({
        preset: 'CUSTOM',
        name: '사용자 직접 드래그 영역',
        xRatio: x,
        yRatio: y,
        widthRatio: 0.01,
        heightRatio: 0.01
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart) return;
    const { x, y } = getNormalizedCoordinates(e);

    if (dragAction === 'CREATE') {
      const minX = Math.min(dragStart.x, x);
      const minY = Math.min(dragStart.y, y);
      const width = Math.max(0.05, Math.abs(x - dragStart.x));
      const height = Math.max(0.05, Math.abs(y - dragStart.y));

      setCurrentArea({
        preset: 'CUSTOM',
        name: '사용자 지정 영역',
        xRatio: Math.min(1 - width, minX),
        yRatio: Math.min(1 - height, minY),
        widthRatio: Math.min(1, width),
        heightRatio: Math.min(1, height)
      });
    } else if (dragAction === 'MOVE') {
      const dx = x - dragStart.x;
      const dy = y - dragStart.y;
      setDragStart({ x, y });

      setCurrentArea((prev) => ({
        ...prev,
        preset: 'CUSTOM',
        name: '사용자 지정 영역',
        xRatio: Math.max(0, Math.min(1 - prev.widthRatio, prev.xRatio + dx)),
        yRatio: Math.max(0, Math.min(1 - prev.heightRatio, prev.yRatio + dy))
      }));
    } else if (dragAction === 'RESIZE_BR') {
      const width = Math.max(0.05, Math.min(1 - currentArea.xRatio, x - currentArea.xRatio));
      const height = Math.max(0.05, Math.min(1 - currentArea.yRatio, y - currentArea.yRatio));
      setCurrentArea((prev) => ({ ...prev, widthRatio: width, heightRatio: height }));
    } else if (dragAction === 'RESIZE_TL') {
      const right = currentArea.xRatio + currentArea.widthRatio;
      const bottom = currentArea.yRatio + currentArea.heightRatio;
      const newX = Math.max(0, Math.min(right - 0.05, x));
      const newY = Math.max(0, Math.min(bottom - 0.05, y));
      setCurrentArea((prev) => ({
        ...prev,
        xRatio: newX,
        yRatio: newY,
        widthRatio: right - newX,
        heightRatio: bottom - newY
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
      setToastMsg('1단계 시작점(좌상단) 지정 완료! 이제 대각선 끝점(우하단)을 클릭하세요.');
    } else if (firstPoint) {
      const minX = Math.min(firstPoint.x, x);
      const minY = Math.min(firstPoint.y, y);
      const width = Math.max(0.05, Math.abs(x - firstPoint.x));
      const height = Math.max(0.05, Math.abs(y - firstPoint.y));

      const newCfg: CaptureAreaConfig = {
        preset: 'CUSTOM',
        name: '꼭짓점 2점 지정 영역',
        xRatio: minX,
        yRatio: minY,
        widthRatio: width,
        heightRatio: height
      };

      setCurrentArea(newCfg);
      setCaptureAreaConfig(newCfg);
      setClickPointStep(1);
      setFirstPoint(null);
      setToastMsg('2개 꼭짓점 좌표로 영역 지정이 완료되었습니다! ✨');
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  const handleSliderChange = (key: 'xRatio' | 'yRatio' | 'widthRatio' | 'heightRatio', val: number) => {
    const updated = {
      ...currentArea,
      preset: 'CUSTOM' as CaptureAreaPreset,
      name: '사용자 미세조정 영역',
      [key]: val
    };
    setCurrentArea(updated);
    setCaptureAreaConfig(updated);
  };

  const handleTestCapture = async () => {
    setIsTestingCapture(true);
    try {
      const img = await screenCaptureService.captureArea(null, currentArea, {
        nickname: '러블리마켓',
        amount: 35000,
        timestamp: new Date().toLocaleTimeString('ko-KR')
      });
      setTestCaptureUrl(img);
    } finally {
      setIsTestingCapture(false);
    }
  };

  const pixelX = Math.round(currentArea.xRatio * 1080);
  const pixelY = Math.round(currentArea.yRatio * 1920);
  const pixelW = Math.round(currentArea.widthRatio * 1080);
  const pixelH = Math.round(currentArea.heightRatio * 1920);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
        <div className="flex items-center space-x-2">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">인식 단어 & 캡처 영역 스튜디오</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-bold border border-brand-200">
            정밀 영역 드래그 에디터 탑재
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          방송 중 인식할 키워드와, '캡처' 단어가 나왔을 때 자동으로 잘라낼 틱톡 방송 화면 영역을 마우스로 직접 드래그하여 정밀 지정합니다.
        </p>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 1. 자동 화면 캡처 영역 정밀 지정 스튜디오 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-black text-slate-900 flex items-center space-x-2">
              <Crop className="w-5 h-5 text-brand-600" />
              <span>화면 캡처 영역 인터랙티브 설정기</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              틱톡 화면 위를 **마우스로 직접 드래그**하거나 **모서리 꼭짓점을 클릭**하여 원하는 위치를 자유자재로 지정하세요.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleTestCapture}
              disabled={isTestingCapture}
              className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/20 flex items-center space-x-1.5 transition"
            >
              <Eye className="w-4 h-4" />
              <span>{isTestingCapture ? '캡처 중...' : '실시간 캡처 테스트'}</span>
            </button>
          </div>
        </div>

        {/* 인터랙티브 모드 툴바 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 text-xs">
            <span className="text-slate-500 px-2 font-bold">지정 모드:</span>
            <button
              onClick={() => { setSelectMode('DRAG'); setClickPointStep(1); setFirstPoint(null); }}
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

          <div className="flex items-center space-x-1.5 overflow-x-auto text-xs">
            <span className="text-slate-500 px-1 font-semibold">프리셋:</span>
            {CAPTURE_PRESETS.map((p) => (
              <button
                key={p.preset}
                onClick={() => handleSelectPreset(p)}
                className={`px-2.5 py-1.5 rounded-xl font-semibold border transition ${
                  currentArea.preset === p.preset && currentArea.name === p.name
                    ? 'bg-brand-50 border-brand-300 text-brand-700 font-bold shadow-sm'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* 2열 스튜디오 그리드 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* 좌측 캔버스 */}
          <div className="lg:col-span-6 flex flex-col items-center">
            <div className="text-center text-xs font-semibold text-slate-600 mb-2 flex items-center space-x-1">
              <Sparkles className="w-3.5 h-3.5 text-brand-600" />
              <span>
                {selectMode === 'DRAG'
                  ? '화면 위를 드래그하여 사각형 박스를 그리거나 크기를 조절하세요'
                  : clickPointStep === 1
                  ? '📍 [1단계] 시작할 좌상단 꼭짓점을 클릭하세요'
                  : '📍 [2단계] 대각선 끝 우하단 꼭짓점을 클릭하세요'}
              </span>
            </div>

            <div
              ref={canvasContainerRef}
              onMouseDown={(e) => handleMouseDown(e, 'CREATE')}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onClick={handleCanvasClick}
              className="relative w-[300px] h-[533px] bg-slate-900 rounded-3xl border-4 border-slate-800 shadow-xl overflow-hidden cursor-crosshair select-none flex flex-col justify-between"
              style={{
                backgroundImage: 'linear-gradient(180deg, #161623 0%, #2b173a 50%, #0d0d17 100%)'
              }}
            >
              {/* 상단 라이브 헤더 */}
              <div className="p-3 flex items-center justify-between pointer-events-none">
                <div className="flex items-center space-x-2 bg-black/40 px-2.5 py-1 rounded-full border border-white/10">
                  <div className="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center text-[10px] font-bold text-white">LIVE</div>
                  <span className="text-[11px] font-bold text-white">VoiceCAP 스토어</span>
                </div>
                <span className="text-[10px] text-cyan-300 font-bold bg-black/40 px-2 py-0.5 rounded-full">🔥 3.8k</span>
              </div>

              {/* 중앙 상품 배너 */}
              <div className="mx-3 p-3 bg-white/5 border border-white/10 rounded-xl pointer-events-none text-left">
                <div className="text-[10px] text-cyan-300 font-bold">✨ [실시간 특가 판매]</div>
                <div className="text-xs font-bold text-white mt-0.5">인기 프리미엄 라이브 의류</div>
                <div className="text-sm font-black text-amber-300 mt-1">35,000원</div>
              </div>

              {/* 하단 댓글창 */}
              <div className="p-3 bg-black/60 rounded-t-2xl border-t border-white/10 pointer-events-none space-y-1.5 text-left text-[10px]">
                <div className="text-cyan-300 font-bold pb-1">💬 틱톡 실시간 댓글 목록</div>
                <div className="text-slate-300">
                  <strong className="text-brand-300">러블리:</strong> 구매확정합니다! 입금완료요~
                </div>
                <div className="text-slate-300">
                  <strong className="text-purple-300">달콤한하루:</strong> 저도 바로 구매할게요!!
                </div>
                <div className="text-slate-400">
                  <strong className="text-slate-400">민트초코:</strong> 캡처 부탁드려요
                </div>
              </div>

              {/* 상호작용 바운딩 박스 */}
              <div
                onMouseDown={(e) => handleMouseDown(e, 'MOVE')}
                className="absolute border-2 border-cyan-400 bg-cyan-400/20 shadow-2xl transition-all cursor-move group"
                style={{
                  left: `${currentArea.xRatio * 100}%`,
                  top: `${currentArea.yRatio * 100}%`,
                  width: `${currentArea.widthRatio * 100}%`,
                  height: `${currentArea.heightRatio * 100}%`
                }}
              >
                <div className="absolute -top-6 left-0 bg-cyan-500 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                  📸 {currentArea.name} ({pixelW}x{pixelH}px)
                </div>

                <div
                  onMouseDown={(e) => handleMouseDown(e, 'RESIZE_TL')}
                  className="absolute -top-2 -left-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full cursor-nwse-resize hover:scale-125 transition-transform shadow"
                />
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'RESIZE_TR')}
                  className="absolute -top-2 -right-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full cursor-nesw-resize hover:scale-125 transition-transform shadow"
                />
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'RESIZE_BL')}
                  className="absolute -bottom-2 -left-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full cursor-nesw-resize hover:scale-125 transition-transform shadow"
                />
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'RESIZE_BR')}
                  className="absolute -bottom-2 -right-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full cursor-nwse-resize hover:scale-125 transition-transform shadow"
                />

                <div className="w-full h-full flex items-center justify-center opacity-30 pointer-events-none">
                  <Maximize2 className="w-6 h-6 text-white" />
                </div>
              </div>

              {selectMode === 'CLICK_POINTS' && firstPoint && (
                <div
                  className="absolute w-5 h-5 bg-rose-500 border-2 border-white rounded-full -translate-x-1/2 -translate-y-1/2 shadow-lg animate-ping"
                  style={{ left: `${firstPoint.x * 100}%`, top: `${firstPoint.y * 100}%` }}
                />
              )}
            </div>
          </div>

          {/* 우측 수치 조절 패널 */}
          <div className="lg:col-span-6 space-y-4 bg-slate-50 p-6 rounded-3xl border border-slate-200">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5">
                <Sliders className="w-4 h-4 text-brand-600" />
                <span>정밀 픽셀 & 비율 미세조정</span>
              </h4>
              <button
                onClick={() => handleSelectPreset(CAPTURE_PRESETS[0])}
                className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center space-x-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>초기화</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                <span className="text-[10px] text-slate-500">X 시작점</span>
                <div className="font-bold text-slate-900 mt-0.5">{pixelX}px ({Math.round(currentArea.xRatio * 100)}%)</div>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                <span className="text-[10px] text-slate-500">Y 시작점</span>
                <div className="font-bold text-slate-900 mt-0.5">{pixelY}px ({Math.round(currentArea.yRatio * 100)}%)</div>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                <span className="text-[10px] text-slate-500">가로 너비 (W)</span>
                <div className="font-bold text-brand-600 mt-0.5">{pixelW}px ({Math.round(currentArea.widthRatio * 100)}%)</div>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                <span className="text-[10px] text-slate-500">세로 높이 (H)</span>
                <div className="font-bold text-brand-600 mt-0.5">{pixelH}px ({Math.round(currentArea.heightRatio * 100)}%)</div>
              </div>
            </div>

            <div className="space-y-3 pt-2 text-xs">
              <div>
                <div className="flex justify-between text-slate-700 font-semibold mb-1">
                  <span>가로 시작 위치 (X 좌표)</span>
                  <span className="text-brand-600 font-mono">{Math.round(currentArea.xRatio * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.9"
                  step="0.01"
                  value={currentArea.xRatio}
                  onChange={(e) => handleSliderChange('xRatio', parseFloat(e.target.value))}
                  className="w-full accent-brand-600 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-700 font-semibold mb-1">
                  <span>세로 시작 위치 (Y 좌표)</span>
                  <span className="text-brand-600 font-mono">{Math.round(currentArea.yRatio * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.9"
                  step="0.01"
                  value={currentArea.yRatio}
                  onChange={(e) => handleSliderChange('yRatio', parseFloat(e.target.value))}
                  className="w-full accent-brand-600 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-700 font-semibold mb-1">
                  <span>크롭 영역 너비 (Width)</span>
                  <span className="text-brand-600 font-mono">{Math.round(currentArea.widthRatio * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.01"
                  value={currentArea.widthRatio}
                  onChange={(e) => handleSliderChange('widthRatio', parseFloat(e.target.value))}
                  className="w-full accent-brand-600 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-700 font-semibold mb-1">
                  <span>크롭 영역 높이 (Height)</span>
                  <span className="text-brand-600 font-mono">{Math.round(currentArea.heightRatio * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.01"
                  value={currentArea.heightRatio}
                  onChange={(e) => handleSliderChange('heightRatio', parseFloat(e.target.value))}
                  className="w-full accent-brand-600 cursor-pointer"
                />
              </div>
            </div>

            <div className="p-3 bg-brand-50 border border-brand-200 rounded-2xl text-[11px] text-brand-800">
              💡 마우스 드래그 또는 슬라이더 조절 시 변경 사항이 즉시 자동 반영되어 다음 라이브 방송 캡처에 적용됩니다.
            </div>
          </div>
        </div>
      </div>

      {/* 2. 새로운 인식 단어 추가 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
          <Plus className="w-4 h-4 text-brand-600" />
          <span>새로운 인식 단어 추가</span>
        </h3>

        <form onSubmit={handleAddWord} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-6">
            <input
              type="text"
              required
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder="인식할 단어 입력 (예: 입금확인, 사은품, 특가)"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
            />
          </div>

          <div className="sm:col-span-4">
            <select
              value={newAction}
              onChange={(e) => setNewAction(e.target.value as RuleAction)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-brand-500 transition"
            >
              <option value="DB_SAVE">📦 DB 자동 저장</option>
              <option value="SCREEN_CAPTURE">📸 댓글 화면 캡처</option>
              <option value="DB_SAVE_AND_CAPTURE">⚡ DB 저장 + 화면 캡처 동시</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-500/20 transition"
            >
              추가하기
            </button>
          </div>
        </form>
      </div>

      {/* 등록된 단어 규칙 목록 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
          <Sliders className="w-4 h-4 text-brand-600" />
          <span>현재 활성화된 인식 단어 규칙 ({rules.length}개)</span>
        </h3>

        <div className="space-y-2.5">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`p-4 rounded-2xl border transition flex items-center justify-between gap-4 ${
                rule.isEnabled ? 'bg-slate-50 border-slate-200' : 'bg-slate-50/40 border-slate-100 opacity-60'
              }`}
            >
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={rule.isEnabled}
                  onChange={() => toggleRule(rule.id)}
                  className="rounded border-slate-300 text-brand-600 w-4 h-4 cursor-pointer"
                />
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-black text-slate-900">{rule.word}</span>
                    {rule.isEssential && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] text-slate-700 font-semibold border border-slate-300 flex items-center space-x-1">
                        <Shield className="w-3 h-3 text-brand-600" />
                        <span>필수 단어</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{rule.description || '사용자 정의 단어'}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <select
                  value={rule.action}
                  onChange={(e) => updateRule({ ...rule, action: e.target.value as RuleAction })}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none"
                >
                  <option value="DB_SAVE">📦 DB 저장</option>
                  <option value="SCREEN_CAPTURE">📸 화면 캡처</option>
                  <option value="DB_SAVE_AND_CAPTURE">⚡ 저장 + 캡처</option>
                </select>

                <button
                  onClick={() => handleDeleteWord(rule.id, rule.word)}
                  disabled={rule.isEssential}
                  title={rule.isEssential ? '필수 단어는 삭제할 수 없습니다.' : '삭제'}
                  className={`p-2 rounded-lg transition ${
                    rule.isEssential
                      ? 'text-slate-300 cursor-not-allowed'
                      : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 캡처 테스트 결과 모달 */}
      {testCaptureUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5">
                <Eye className="w-4 h-4 text-brand-600" />
                <span>지정 영역 캡처 테스트 결과 미리보기</span>
              </h3>
              <button onClick={() => setTestCaptureUrl(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-2 rounded-2xl border border-slate-200 flex items-center justify-center max-h-[60vh] overflow-hidden">
              <img src={testCaptureUrl} alt="테스트 캡처" className="rounded-xl max-h-[55vh] object-contain shadow" />
            </div>

            <p className="text-xs text-slate-500 text-center">
              현재 설정된 좌표 (X:{pixelX}px, Y:{pixelY}px, W:{pixelW}px, H:{pixelH}px) 기준으로 깔끔하게 크롭되었습니다!
            </p>

            <button
              onClick={() => setTestCaptureUrl(null)}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-500/20"
            >
              확인 및 닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
