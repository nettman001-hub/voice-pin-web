import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/common/Modal';
import { useAppData, CAPTURE_PRESETS } from '../../context/AppDataContext';
import { useLive } from '../../context/LiveContext';
import { CaptureAreaConfig } from '../../types/rules';
import { screenCaptureService, ScreenCaptureConnectionState } from '../../services/screenCaptureService';
import {
  Crop,
  Camera,
  Save,
  Monitor,
  RefreshCw,
  Maximize2,
  CheckCircle2,
  VideoOff
} from 'lucide-react';

interface CaptureAreaStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type DragAction = 'CREATE' | 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR';

/**
 * 실시간 공유 화면 위에서 캡처 영역을 직접 지정하는 스튜디오 모달.
 * 공유 항목의 전체 화면을 라이브 비디오로 보여주고 그 위에 캡처 영역 박스를 드래그/리사이즈한다.
 */
export const CaptureAreaStudioModal: React.FC<CaptureAreaStudioModalProps> = ({ isOpen, onClose }) => {
  const { captureAreaConfig, setCaptureAreaConfig } = useAppData();
  const { captureCurrentScreen, isListening, stopListening } = useLive();

  const [stream, setStream] = useState<MediaStream | null>(() => screenCaptureService.getActiveStream());
  const [connection, setConnection] = useState<ScreenCaptureConnectionState>(() => screenCaptureService.getConnectionState());
  const [area, setArea] = useState<CaptureAreaConfig>(captureAreaConfig);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [lastCaptureUrl, setLastCaptureUrl] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ action: DragAction | null; startX: number; startY: number }>({
    action: null,
    startX: 0,
    startY: 0
  });

  // 열릴 때 저장된 설정과 현재 공유 스트림을 동기화한다.
  useEffect(() => {
    if (isOpen) {
      setArea(captureAreaConfig);
      setStream(screenCaptureService.getActiveStream());
      setLastCaptureUrl(null);
      setSavedFlash(false);
    }
  }, [isOpen, captureAreaConfig]);

  // 공유 연결 상태 변경을 실시간 반영한다.
  useEffect(() => screenCaptureService.subscribeConnection((state) => {
    setConnection(state);
    setStream(screenCaptureService.getActiveStream());
  }), []);

  // 라이브 비디오에 공유 스트림을 연결한다.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isOpen) return;

    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
    }
  }, [stream, isOpen]);

  const getNormalized = (clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    };
  };

  const moveDrag = (clientX: number, clientY: number) => {
    const { action, startX, startY } = dragState.current;
    if (!action) return;
    const { x, y } = getNormalized(clientX, clientY);

    if (action === 'CREATE') {
      setArea((prev) => {
        const minX = Math.min(startX, x);
        const minY = Math.min(startY, y);
        const width = Math.max(0.04, Math.abs(x - startX));
        const height = Math.max(0.04, Math.abs(y - startY));
        return {
          ...prev,
          preset: 'CUSTOM',
          name: '사용자 지정 영역',
          xRatio: minX,
          yRatio: minY,
          widthRatio: Math.min(1 - minX, width),
          heightRatio: Math.min(1 - minY, height)
        };
      });
    } else if (action === 'MOVE') {
      setArea((prev) => ({
        ...prev,
        xRatio: Math.max(0, Math.min(1 - prev.widthRatio, prev.xRatio + (x - startX))),
        yRatio: Math.max(0, Math.min(1 - prev.heightRatio, prev.yRatio + (y - startY)))
      }));
      dragState.current.startX = x;
      dragState.current.startY = y;
    } else if (action === 'RESIZE_BR') {
      setArea((prev) => ({
        ...prev,
        widthRatio: Math.max(0.04, Math.min(1 - prev.xRatio, x - prev.xRatio)),
        heightRatio: Math.max(0.04, Math.min(1 - prev.yRatio, y - prev.yRatio))
      }));
    } else if (action === 'RESIZE_TL') {
      setArea((prev) => {
        const newX = Math.max(0, Math.min(prev.xRatio + prev.widthRatio - 0.04, x));
        const newY = Math.max(0, Math.min(prev.yRatio + prev.heightRatio - 0.04, y));
        return {
          ...prev,
          xRatio: newX,
          yRatio: newY,
          widthRatio: prev.xRatio + prev.widthRatio - newX,
          heightRatio: prev.yRatio + prev.heightRatio - newY
        };
      });
    } else if (action === 'RESIZE_TR') {
      setArea((prev) => {
        const newY = Math.max(0, Math.min(prev.yRatio + prev.heightRatio - 0.04, y));
        const newWidth = Math.max(0.04, Math.min(1 - prev.xRatio, x - prev.xRatio));
        return {
          ...prev,
          yRatio: newY,
          widthRatio: newWidth,
          heightRatio: prev.yRatio + prev.heightRatio - newY
        };
      });
    } else if (action === 'RESIZE_BL') {
      setArea((prev) => {
        const newX = Math.max(0, Math.min(prev.xRatio + prev.widthRatio - 0.04, x));
        const newHeight = Math.max(0.04, Math.min(1 - prev.yRatio, y - prev.yRatio));
        return {
          ...prev,
          xRatio: newX,
          widthRatio: prev.xRatio + prev.widthRatio - newX,
          heightRatio: newHeight
        };
      });
    }
  };

  // 드래그 중에는 창 밖에서도 좌표를 추적한다 (모바일 터치 드래그 포함).
  useEffect(() => {
    if (!isOpen) return;

    const onMouseMove = (e: MouseEvent) => moveDrag(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (dragState.current.action && e.touches[0]) {
        e.preventDefault();
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onEnd = () => {
      dragState.current.action = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isOpen]);

  const beginDrag = (action: DragAction) => (clientX: number, clientY: number) => {
    const { x, y } = getNormalized(clientX, clientY);
    dragState.current = { action, startX: x, startY: y };

    if (action === 'CREATE') {
      setArea((prev) => ({
        ...prev,
        preset: 'CUSTOM',
        name: '사용자 지정 영역',
        xRatio: x,
        yRatio: y,
        widthRatio: 0.05,
        heightRatio: 0.05
      }));
    }
  };

  const handleSave = () => {
    setCaptureAreaConfig(area);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  const handleCapture = async () => {
    setIsCapturing(true);
    try {
      const url = await captureCurrentScreen(area, '영역 스튜디오 즉시 캡처');
      if (url) setLastCaptureUrl(url);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleReconnect = async () => {
    // 처리용 오디오가 이전 탭을 참조하지 않도록 변경 전에 청취를 종료한다.
    if (isListening) stopListening();
    setIsReconnecting(true);
    try {
      const newStream = await screenCaptureService.getOrCreateStream(true);
      if (newStream) setStream(newStream);
    } finally {
      setIsReconnecting(false);
    }
  };

  const pixelW = videoSize ? Math.round(videoSize.width * area.widthRatio) : Math.round(1920 * area.widthRatio);
  const pixelH = videoSize ? Math.round(videoSize.height * area.heightRatio) : Math.round(1080 * area.heightRatio);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="실시간 화면 캡처 영역 설정"
      maxWidth="max-w-4xl"
    >
      <div className="space-y-4">
        {/* 연결 상태 바 */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-3">
          <div className="flex items-center space-x-2 text-xs font-bold">
            {connection.isConnected ? (
              <span className="px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>공유 화면 연결됨 — 아래 실시간 화면 위에서 영역을 조절하세요</span>
              </span>
            ) : (
              <span className="px-2.5 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 flex items-center space-x-1.5">
                <VideoOff className="w-3.5 h-3.5" />
                <span>공유 화면이 연결되어 있지 않습니다</span>
              </span>
            )}
          </div>

          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 flex items-center space-x-1.5 transition disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
            <span>{connection.isConnected ? '화면 변경' : '화면 연결'}</span>
          </button>
        </div>

        {/* 실시간 공유 화면 + 캡처 영역 오버레이 */}
        <div className="bg-slate-800 rounded-3xl p-2.5 shadow-2xl border-4 border-slate-700">
          <div className="flex items-center justify-between px-2 pb-2 text-[11px] text-slate-400 select-none">
            <div className="flex items-center space-x-2 truncate">
              <Monitor className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-bold text-slate-200 truncate">
                선택한 공유 화면 실시간 뷰 {videoSize ? `(${videoSize.width}x${videoSize.height})` : ''}
              </span>
            </div>
            <span className="text-[10px] font-semibold text-cyan-300 whitespace-nowrap">
              드래그로 이동/생성 · 모서리로 크기 조절
            </span>
          </div>

          <div
            ref={canvasRef}
            onMouseDown={(e) => { e.preventDefault(); beginDrag('CREATE')(e.clientX, e.clientY); }}
            onTouchStart={(e) => { if (e.touches[0]) beginDrag('CREATE')(e.touches[0].clientX, e.touches[0].clientY); }}
            className="relative w-full overflow-hidden rounded-2xl bg-slate-950 touch-none select-none cursor-crosshair"
            style={{ aspectRatio: videoSize ? `${videoSize.width} / ${videoSize.height}` : '16 / 9' }}
          >
            <video
              ref={videoRef}
              muted
              autoPlay
              playsInline
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) {
                  setVideoSize({ width: v.videoWidth, height: v.videoHeight });
                }
              }}
              className="absolute inset-0 w-full h-full object-fill pointer-events-none"
            />

            {!connection.isConnected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-2 text-slate-400 text-xs bg-slate-950/80">
                <VideoOff className="w-8 h-8" />
                <span className="font-bold">공유 화면이 없습니다</span>
                <span className="text-[11px]">우측 상단 [화면 연결]을 눌러 캡처할 화면을 선택해 주세요.</span>
              </div>
            )}

            {/* 캡처 영역 바운딩 박스 */}
            <div
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); beginDrag('MOVE')(e.clientX, e.clientY); }}
              onTouchStart={(e) => { e.stopPropagation(); if (e.touches[0]) beginDrag('MOVE')(e.touches[0].clientX, e.touches[0].clientY); }}
              className="absolute border-2 border-cyan-400 bg-cyan-400/20 shadow-2xl cursor-move z-20 touch-none"
              style={{
                left: `${area.xRatio * 100}%`,
                top: `${area.yRatio * 100}%`,
                width: `${area.widthRatio * 100}%`,
                height: `${area.heightRatio * 100}%`
              }}
            >
              <div className="absolute -top-6 left-0 bg-cyan-500 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded shadow whitespace-nowrap z-30">
                📸 {area.name} ({pixelW}x{pixelH}px)
              </div>

              {(['RESIZE_TL', 'RESIZE_TR', 'RESIZE_BL', 'RESIZE_BR'] as const).map((action) => (
                <div
                  key={action}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); beginDrag(action)(e.clientX, e.clientY); }}
                  onTouchStart={(e) => { e.stopPropagation(); if (e.touches[0]) beginDrag(action)(e.touches[0].clientX, e.touches[0].clientY); }}
                  className={`absolute w-5 h-5 bg-white border-2 border-cyan-500 rounded-full shadow z-30 touch-none transition-transform hover:scale-125 active:scale-150 ${
                    action === 'RESIZE_TL' ? '-top-2.5 -left-2.5 cursor-nwse-resize'
                    : action === 'RESIZE_TR' ? '-top-2.5 -right-2.5 cursor-nesw-resize'
                    : action === 'RESIZE_BL' ? '-bottom-2.5 -left-2.5 cursor-nesw-resize'
                    : '-bottom-2.5 -right-2.5 cursor-nwse-resize'
                  }`}
                />
              ))}

              <div className="w-full h-full flex items-center justify-center opacity-30 pointer-events-none">
                <Maximize2 className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        </div>

        {/* 프리셋 */}
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-1 text-xs">
          <span className="text-slate-500 px-1 font-semibold flex-shrink-0 flex items-center space-x-1">
            <Crop className="w-3.5 h-3.5" />
            <span>프리셋:</span>
          </span>
          {CAPTURE_PRESETS.map((p, idx) => (
            <button
              key={idx}
              onClick={() => setArea(p)}
              className={`px-2.5 py-1.5 rounded-xl font-semibold border transition whitespace-nowrap flex-shrink-0 ${
                area.name === p.name
                  ? 'bg-brand-50 border-brand-300 text-brand-700 font-bold shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* 캡처 결과 미리보기 */}
        {lastCaptureUrl && (
          <div className="flex items-center space-x-3 bg-cyan-50 border border-cyan-200 rounded-2xl p-3">
            <img src={lastCaptureUrl} alt="캡처 결과" className="w-20 h-14 object-cover rounded-xl border border-cyan-200 shadow-sm" />
            <div className="text-xs text-cyan-900 font-bold">
              <CheckCircle2 className="w-4 h-4 inline mr-1 text-cyan-600" />
              캡처가 완료되어 최근 캡처와 판매 내역에 저장되었습니다.
            </div>
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-1">
          <button
            onClick={handleSave}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold border flex items-center justify-center space-x-1.5 transition ${
              savedFlash
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{savedFlash ? '저장 완료!' : '영역 설정 저장'}</span>
          </button>

          <button
            onClick={handleCapture}
            disabled={isCapturing || !connection.isConnected}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 via-brand-600 to-indigo-600 hover:from-cyan-500 hover:to-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/20 flex items-center justify-center space-x-1.5 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{isCapturing ? '캡처 중...' : '📸 이 영역으로 즉시 캡처'}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
