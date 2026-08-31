import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useLive } from '../../context/LiveContext';
import { useCommentCapture, getCommentStatusBadge } from '../../context/CommentCaptureContext';
import { RecognitionWordRule, RuleAction, CaptureAreaPreset, CaptureAreaConfig } from '../../types/rules';
import { COMMENT_HELPER_DOWNLOAD_URL, DEFAULT_COMMENT_SERVER_URL } from '../../types/comment';
import { screenCaptureService } from '../../services/screenCaptureService';
import { storageService } from '../../services/storageService';
import {
  Sliders,
  Plus,
  Trash2,
  Shield,
  Crop,
  Maximize2,
  Sparkles,
  X,
  CheckCircle2,
  AlertCircle,
  Monitor,
  Camera,
  MessageSquareText,
  BellRing,
  Play,
  Square,
  ArrowRight,
  Download
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
  const {
    config: commentConfig,
    saveConfig: saveCommentConfig,
    isActive: isCommentActive,
    isRunning: isCommentRunning,
    serverStatus: commentServerStatus,
    serverMessage: commentServerMessage,
    newCount: commentNewCount,
    startCapture: startCommentCapture,
    stopCapture: stopCommentCapture
  } = useCommentCapture();

  const [commentUsername, setCommentUsername] = useState(commentConfig.tiktokUsername);
  const [commentAlertWords, setCommentAlertWords] = useState(commentConfig.alertWords.join(', '));
  const [commentAlertDuration, setCommentAlertDuration] = useState(String(commentConfig.alertDurationSec));
  const [commentAlertCommand, setCommentAlertCommand] = useState(commentConfig.alertVoiceCommand);

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

  const [savedPreview, setSavedPreview] = useState(() => storageService.getCaptureAreaSnapshot());

  // 윈도우 데스크톱 해상도 기준 설정
  const [desktopResolution, setDesktopResolution] = useState<{ width: number; height: number; name: string }>(() => ({
    width: savedPreview?.width || 1920,
    height: savedPreview?.height || 1080,
    name: savedPreview
      ? `${savedPreview.width} x ${savedPreview.height}`
      : '1920 x 1080 (FHD 데스크톱 기본)'
  }));

  // 선택 모드
  const [currentArea, setCurrentArea] = useState<CaptureAreaConfig>({
    ...captureAreaConfig,
    preset: 'CUSTOM',
    name: '사용자 지정 영역'
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragAction, setDragAction] = useState<'CREATE' | 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR' | null>(null);

  const [isTestingCapture, setIsTestingCapture] = useState(false);
  const [isScreenConnected, setIsScreenConnected] = useState<boolean>(() => !!screenCaptureService.getActiveStream());
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setCurrentArea({
      ...captureAreaConfig,
      preset: 'CUSTOM',
      name: '사용자 지정 영역'
    });
  }, [captureAreaConfig]);

  useEffect(() => screenCaptureService.subscribeConnection((state) => {
    setIsScreenConnected(state.isConnected);
    if (!state.isConnected) setPreviewStream(null);
  }), []);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;

    video.srcObject = previewStream;
    if (previewStream) {
      void video.play().catch(() => {});
    }
  }, [previewStream]);

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
        setPreviewStream(stream);
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
    setPreviewStream(null);
    showNotice('윈도우 화면 연결이 정상적으로 해제되었습니다.', '🔌 연결 해제 안내', 'info');
  };

  // 실시간 윈도우 창/화면 캡처 (1회 연결 후 다음부터는 공유창 없이 즉시 캡처)
  // 선택한 공유 화면을 페이지 안의 빈 캡처 박스에 표시한다.
  const handleTestCapture = async () => {
    setIsTestingCapture(true);
    try {
      const stream = await screenCaptureService.getOrCreateStream(false);
      if (stream) {
        setIsScreenConnected(true);
        setPreviewStream(stream);
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
    if (!isDragging || !dragStart) return;

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
    } else if (dragAction === 'RESIZE_TR') {
      const newY = Math.max(0, Math.min(currentArea.yRatio + currentArea.heightRatio - 0.04, y));
      const newWidth = Math.max(0.04, Math.min(1 - currentArea.xRatio, x - currentArea.xRatio));
      setCurrentArea((prev) => ({
        ...prev,
        yRatio: newY,
        widthRatio: newWidth,
        heightRatio: prev.yRatio + prev.heightRatio - newY
      }));
    } else if (dragAction === 'RESIZE_BL') {
      const newX = Math.max(0, Math.min(currentArea.xRatio + currentArea.widthRatio - 0.04, x));
      const newHeight = Math.max(0.04, Math.min(1 - currentArea.yRatio, y - currentArea.yRatio));
      setCurrentArea((prev) => ({
        ...prev,
        xRatio: newX,
        widthRatio: prev.xRatio + prev.widthRatio - newX,
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

  const handleSaveCaptureArea = () => {
    setCaptureAreaConfig(currentArea);

    const video = previewVideoRef.current;
    if (previewStream && isScreenConnected && video?.videoWidth && video.videoHeight) {
      const maxPreviewWidth = 960;
      const scale = Math.min(1, maxPreviewWidth / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

      const context = canvas.getContext('2d');
      if (!context) {
        showNotice('영역 설정은 저장했지만 현재 화면을 고정하지 못했습니다.', '⚠️ 화면 저장 실패', 'warning');
        return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const snapshot = {
        imageUrl: canvas.toDataURL('image/jpeg', 0.72),
        width: video.videoWidth,
        height: video.videoHeight,
        savedAt: new Date().toISOString()
      };

      // 영구 저장 결과와 관계없이 화면은 즉시 고정하고 메뉴 이동 시 메모리에서 복원한다.
      setSavedPreview(snapshot);
      setPreviewStream(null);
      const isPersisted = storageService.saveCaptureAreaSnapshot(snapshot);

      if (!isPersisted) {
        showNotice('현재 화면은 고정되었지만 브라우저 저장 공간 부족으로 브라우저를 완전히 닫은 뒤에는 복원되지 않을 수 있습니다.', '⚠️ 화면 고정 완료', 'warning');
        return;
      }

      showNotice(`윈도우 캡처 영역(${pixelW}x${pixelH}px)과 현재 화면이 저장되었습니다! 💾`, '💾 설정 저장 완료', 'success');
      return;
    }

    if (savedPreview) {
      showNotice(`윈도우 캡처 영역(${pixelW}x${pixelH}px)과 고정 화면이 저장되어 있습니다. 💾`, '💾 설정 저장 완료', 'success');
    } else {
      showNotice('영역 설정은 저장했지만 고정할 실시간 화면이 없습니다. 먼저 실시간 캡처영역설정을 실행해 주세요.', '⚠️ 화면 없음', 'warning');
    }
  };

  // 현재 해상도 기준 픽셀 계산
  const pixelX = Math.round(currentArea.xRatio * desktopResolution.width);
  const pixelY = Math.round(currentArea.yRatio * desktopResolution.height);
  const pixelW = Math.round(currentArea.widthRatio * desktopResolution.width);
  const pixelH = Math.round(currentArea.heightRatio * desktopResolution.height);
  const hasLivePreview = !!(previewStream && isScreenConnected);
  const hasDisplayedScreen = hasLivePreview || !!savedPreview;
  const localServerStatusLabel = commentServerStatus === 'DISCONNECTED'
    ? '댓글 도우미 미연결'
    : commentServerStatus === 'CONNECTING'
      ? '댓글 도우미 연결중'
      : '댓글 도우미 대기중';

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
              [실시간 캡처영역설정] 버튼으로 화면을 불러온 후 원하는 캡처 영역을 설정하세요.
            </p>
          </div>

          {hasDisplayedScreen && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2.5 py-1.5 rounded-xl border text-[11px] sm:text-xs font-bold flex items-center space-x-1.5 ${
                hasLivePreview
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-sky-50 text-sky-800 border-sky-200'
              }`}>
                <span className={`w-2 h-2 rounded-full ${hasLivePreview ? 'bg-emerald-500 animate-pulse' : 'bg-sky-500'}`}></span>
                <span>{hasLivePreview ? '화면 연결됨' : '저장 화면 표시 중'}</span>
              </span>

              <button
                onClick={handleTestCapture}
                disabled={isTestingCapture}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-500/20 flex items-center space-x-1.5 transition active:scale-95"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{isTestingCapture ? '화면 불러오는 중...' : '실시간 캡처영역설정'}</span>
              </button>

              {hasLivePreview && (
                <>
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
              )}
            </div>
          )}
        </div>

        {/* 2열 스튜디오 그리드 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
          {/* 좌측 16:9 와이드 윈도우 데스크톱 캔버스 */}
          <div className="lg:col-span-7 flex flex-col items-center">
            <div className={`w-full overflow-hidden rounded-3xl border-2 ${
              hasDisplayedScreen
                ? 'bg-slate-900 border-slate-700 shadow-2xl'
                : 'bg-white border-dashed border-slate-300'
            }`}>
              {hasDisplayedScreen && (
                <div className="flex items-center space-x-2 px-3 py-2 text-[10px] sm:text-[11px] text-slate-300 select-none">
                  <Monitor className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="font-bold truncate">
                    {hasLivePreview ? '선택한 공유 화면' : '마지막 저장 화면'} ({desktopResolution.width}x{desktopResolution.height})
                  </span>
                </div>
              )}

              <div
                ref={canvasContainerRef}
                onMouseDown={hasDisplayedScreen ? (e) => handleMouseDown(e, 'CREATE') : undefined}
                onMouseMove={hasDisplayedScreen ? handleMouseMove : undefined}
                onMouseUp={hasDisplayedScreen ? handleMouseUp : undefined}
                onMouseLeave={hasDisplayedScreen ? handleMouseUp : undefined}
                onTouchStart={hasDisplayedScreen ? (e) => handleTouchStart(e, 'CREATE') : undefined}
                onTouchMove={hasDisplayedScreen ? handleTouchMove : undefined}
                onTouchEnd={hasDisplayedScreen ? handleTouchEnd : undefined}
                className={`relative w-full overflow-hidden select-none touch-none ${
                  hasDisplayedScreen ? 'bg-black cursor-crosshair' : 'bg-white'
                }`}
                style={{ aspectRatio: `${desktopResolution.width} / ${desktopResolution.height}` }}
                aria-label={hasDisplayedScreen ? '선택한 공유 화면의 캡처 영역 설정' : '비어 있는 캡처 화면 영역'}
              >
                {!hasDisplayedScreen && (
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <button
                      type="button"
                      onClick={handleTestCapture}
                      disabled={isTestingCapture}
                      className="px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-600 via-brand-600 to-indigo-600 hover:from-cyan-500 hover:to-brand-500 disabled:opacity-60 disabled:cursor-wait text-white text-xs sm:text-sm font-bold shadow-lg shadow-brand-500/25 flex items-center justify-center space-x-2 transition transform active:scale-95"
                    >
                      <Camera className="w-4 h-4" />
                      <span>{isTestingCapture ? '화면 연결 중...' : '실시간 캡처영역설정'}</span>
                    </button>
                  </div>
                )}

                {hasLivePreview && (
                  <video
                    ref={previewVideoRef}
                    muted
                    autoPlay
                    playsInline
                    onLoadedMetadata={(e) => {
                      const video = e.currentTarget;
                      if (video.videoWidth && video.videoHeight) {
                        setDesktopResolution({
                          width: video.videoWidth,
                          height: video.videoHeight,
                          name: `${video.videoWidth} x ${video.videoHeight}`
                        });
                      }
                    }}
                    className="absolute inset-0 w-full h-full object-fill pointer-events-none"
                  />
                )}

                {!hasLivePreview && savedPreview && (
                  <img
                    src={savedPreview.imageUrl}
                    alt="마지막으로 저장한 캡처 영역 화면"
                    className="absolute inset-0 w-full h-full object-fill pointer-events-none"
                  />
                )}

                {hasDisplayedScreen && (
                  <div
                      onMouseDown={(e) => handleMouseDown(e, 'MOVE')}
                      onTouchStart={(e) => handleTouchStart(e, 'MOVE')}
                      className="absolute border-2 border-cyan-400 bg-cyan-400/20 shadow-2xl cursor-move z-20 touch-none"
                      style={{
                        left: `${currentArea.xRatio * 100}%`,
                        top: `${currentArea.yRatio * 100}%`,
                        width: `${currentArea.widthRatio * 100}%`,
                        height: `${currentArea.heightRatio * 100}%`
                      }}
                    >
                      <div className="absolute -top-5 sm:-top-6 left-0 bg-cyan-500 text-slate-950 text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded shadow whitespace-nowrap z-30">
                        📸 {currentArea.name} ({pixelW}x{pixelH}px)
                      </div>

                      {(['RESIZE_TL', 'RESIZE_TR', 'RESIZE_BL', 'RESIZE_BR'] as const).map((action) => (
                        <div
                          key={action}
                          onMouseDown={(e) => handleMouseDown(e, action)}
                          onTouchStart={(e) => handleTouchStart(e, action)}
                          className={`absolute w-5 h-5 bg-white border-2 border-cyan-500 rounded-full shadow z-30 touch-none transition-transform hover:scale-125 active:scale-150 ${
                            action === 'RESIZE_TL' ? '-top-2.5 -left-2.5 cursor-nwse-resize'
                            : action === 'RESIZE_TR' ? '-top-2.5 -right-2.5 cursor-nesw-resize'
                            : action === 'RESIZE_BL' ? '-bottom-2.5 -left-2.5 cursor-nesw-resize'
                            : '-bottom-2.5 -right-2.5 cursor-nwse-resize'
                          }`}
                        />
                      ))}

                      <div className="w-full h-full flex items-center justify-center opacity-30 pointer-events-none">
                        <Maximize2 className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
                      </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 우측 윈도우 데스크톱 수치 정밀 조정 패널 */}
          <div className="lg:col-span-5 space-y-4 bg-slate-50 p-4 sm:p-6 rounded-3xl border border-slate-200">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-1.5">
              <Sliders className="w-4 h-4 text-brand-600" />
              <span>데스크톱 픽셀 & 비율 미세조정</span>
            </h4>

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
                onClick={handleSaveCaptureArea}
                className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 transition"
              >
                현재 윈도우 영역 설정 저장하기
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 1-5. 댓글 자동 캡처 & 키워드 알림 설정 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4 sm:space-y-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center space-x-2">
              <MessageSquareText className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-600" />
              <span>댓글 자동 캡처 & 키워드 알림</span>
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
              VoiceCAP 댓글 도우미가 틱톡 라이브 댓글을 실시간으로 받아 닉네임과 내용을 자동 기록합니다. 설정 단어가 잡히면 큰 알림창이 뜹니다.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border ${
              isCommentRunning
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : isCommentActive
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}>
              {isCommentRunning ? '실시간 수집 동작 중' : isCommentActive ? '대기 중 (라이브 청취 필요)' : '중지됨'}
            </span>

            <button
              onClick={() => (isCommentActive ? stopCommentCapture() : startCommentCapture())}
              className={`px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md flex items-center space-x-1.5 transition active:scale-95 ${
                isCommentActive
                  ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-500/20'
                  : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20'
              }`}
            >
              {isCommentActive ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isCommentActive ? '댓글 수집 정지' : '댓글 수집 시작'}</span>
            </button>
          </div>
        </div>

        {/* 상태 요약 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="text-slate-500 text-[10px] font-bold">신규 누적</div>
            <div className="text-lg font-black text-slate-900">{commentNewCount} <span className="text-[10px] font-normal text-slate-400">건</span></div>
          </div>
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="text-slate-500 text-[10px] font-bold">댓글 도우미 상태</div>
            <div className="text-sm font-black text-slate-900 truncate">{localServerStatusLabel}</div>
          </div>
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="text-slate-500 text-[10px] font-bold">수집 대상</div>
            <div className="text-sm font-black text-slate-900 truncate">{commentConfig.tiktokUsername ? `@${commentConfig.tiktokUsername}` : '-'}</div>
          </div>
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div className="text-slate-500 text-[10px] font-bold">캡처 기록</div>
            <Link to="/comments" className="text-brand-600 hover:underline font-bold text-[11px] flex items-center">
              보기 <ArrowRight className="w-3 h-3 ml-0.5" />
            </Link>
          </div>
        </div>

        {isCommentActive && (commentServerStatus === 'DISCONNECTED' || commentServerStatus === 'ERROR') && (
          <div className="px-3.5 py-3 rounded-2xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <p className="text-rose-700 text-[11px] font-bold break-words">
              ⚠️ {commentServerMessage || 'VoiceCAP 댓글 도우미가 실행 중인지 확인하세요.'}
            </p>
            <a
              href={COMMENT_HELPER_DOWNLOAD_URL}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-black shadow-sm transition"
            >
              <Download className="w-3.5 h-3.5" />
              댓글 도우미 설치
            </a>
          </div>
        )}

        {/* 세부 설정 폼 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700 flex items-center space-x-1">
              <MessageSquareText className="w-3.5 h-3.5 text-cyan-600" />
              <span>수집 대상 틱톡 ID (@ 제외)</span>
            </label>
            <input
              type="text"
              value={commentUsername}
              onChange={(e) => setCommentUsername(e.target.value.replace(/^@/, '').trim())}
              placeholder="예: my_shop_official"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-mono text-slate-900 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-slate-700 flex items-center space-x-1">
              <BellRing className="w-3.5 h-3.5 text-rose-400" />
              <span>알림 단어 (쉼표 구분, 예: 저요, 구매)</span>
            </label>
            <input
              type="text"
              value={commentAlertWords}
              onChange={(e) => setCommentAlertWords(e.target.value)}
              placeholder="저요, 구매"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-slate-700">알림창 자동 닫힘 시간 (초)</label>
            <input
              type="number"
              min={3}
              value={commentAlertDuration}
              onChange={(e) => setCommentAlertDuration(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-mono text-slate-900 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-slate-700">알림창 닫는 음성 명령 (쉼표 구분)</label>
            <input
              type="text"
              value={commentAlertCommand}
              onChange={(e) => setCommentAlertCommand(e.target.value)}
              placeholder="닫아, 알림 닫기"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => {
              const username = commentUsername.trim().replace(/^@/, '');
              const duration = Math.max(3, parseInt(commentAlertDuration, 10) || 15);
              const words = commentAlertWords.split(',').map((w) => w.trim()).filter(Boolean);
              const commands = Array.from(new Set(
                commentAlertCommand.split(',').map((command) => command.trim()).filter(Boolean)
              ));
              const command = commands.length > 0 ? commands.join(', ') : '닫아';
              saveCommentConfig({
                tiktokUsername: username,
                serverUrl: DEFAULT_COMMENT_SERVER_URL,
                alertWords: words,
                alertDurationSec: duration,
                alertVoiceCommand: command
              });
              setCommentUsername(username);
              setCommentAlertDuration(String(duration));
              setCommentAlertCommand(command);
              showNotice(`댓글 수집 설정이 저장되었습니다. (@${username || '미설정'} · 알림 단어 ${words.length}개 · 알림 ${duration}초)`, '💬 댓글 수집 설정 저장', 'success');
            }}
            className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 transition"
          >
            댓글 수집 설정 저장하기
          </button>
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

    </div>
  );
};
