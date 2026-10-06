import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Maximize2
} from 'lucide-react';

interface ImageViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: string[];
  initialIndex?: number;
  titlePrefix?: string;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  isOpen,
  onClose,
  images,
  initialIndex = 0,
  titlePrefix = '이미지'
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoomLevel, setZoomLevel] = useState(1);

  // 모달이 열릴 때 초기 인덱스 및 줌 레벨 동기화
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(Math.max(0, Math.min(initialIndex, images.length - 1)));
      setZoomLevel(1);
    }
  }, [isOpen, initialIndex, images.length]);

  // 이미지 인덱스가 변경될 때 줌 초기화
  useEffect(() => {
    setZoomLevel(1);
  }, [currentIndex]);

  const handlePrev = useCallback(() => {
    if (images.length <= 1) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  }, [images.length]);

  const handleNext = useCallback(() => {
    if (images.length <= 1) return;
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  }, [images.length]);

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
  };

  const handleDoubleZoom = () => {
    setZoomLevel((prev) => (prev === 1 ? 2 : 1));
  };

  // 키보드 네비게이션 & ESC 닫기
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-') {
        handleZoomOut();
      } else if (e.key === '0') {
        handleResetZoom();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext]);

  // 바디 스크롤 방지
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen || images.length === 0 || typeof document === 'undefined') {
    return null;
  }

  const currentUrl = images[currentIndex] || '';

  const handleDownload = () => {
    if (!currentUrl) return;
    const a = document.createElement('a');
    a.href = currentUrl;
    a.download = `VoiceCAP_${titlePrefix.replace(/\s+/g, '_')}_${currentIndex + 1}_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleOpenExternal = () => {
    if (!currentUrl) return;
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex flex-col bg-slate-950/90 backdrop-blur-md text-white select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* 상단 툴바 */}
      <header
        className="flex items-center justify-between px-4 py-3 sm:px-6 bg-slate-900/80 border-b border-slate-800 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Maximize2 className="w-5 h-5 text-brand-400 flex-shrink-0" />
          <h3 className="text-sm font-bold text-slate-100 truncate">
            {titlePrefix}
            {images.length > 1 && (
              <span className="ml-2 font-mono text-xs font-normal text-slate-400">
                ({currentIndex + 1} / {images.length})
              </span>
            )}
          </h3>
          <span className="hidden sm:inline-block text-[11px] text-slate-400 px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
            {Math.round(zoomLevel * 100)}%
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* 확대 / 축소 버튼 */}
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:text-white transition"
            title="확대 (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:text-white transition"
            title="축소 (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          {zoomLevel !== 1 && (
            <button
              type="button"
              onClick={handleResetZoom}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:text-white transition"
              title="원래 크기 (0)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}

          <div className="w-[1px] h-5 bg-slate-800 mx-1 hidden sm:block" />

          {/* 새 탭 열기 */}
          <button
            type="button"
            onClick={handleOpenExternal}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:text-white transition"
            title="새 탭에서 원본 보기"
          >
            <ExternalLink className="w-4 h-4" />
          </button>

          {/* 다운로드 */}
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-sm transition"
            title="원본 이미지 다운로드"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">다운로드</span>
          </button>

          {/* 닫기 */}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-rose-900/60 hover:text-rose-200 text-slate-300 border border-slate-700 transition ml-1"
            title="닫기 (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 중앙 메인 뷰어 영역 */}
      <main
        className="relative flex-1 flex items-center justify-center overflow-auto p-4 sm:p-6"
        onClick={onClose}
      >
        {/* 이전 이미지 버튼 */}
        {images.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2.5 sm:p-3 rounded-2xl bg-slate-900/80 hover:bg-brand-600 border border-slate-700 text-white shadow-xl transition backdrop-blur-sm"
            title="이전 이미지 (←)"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* 메인 이미지 */}
        <div
          className="relative max-w-full max-h-full flex items-center justify-center cursor-zoom-in"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={handleDoubleZoom}
          title="더블클릭 시 확대/원래 크기 전환"
        >
          <img
            src={currentUrl}
            alt={`${titlePrefix} ${currentIndex + 1}`}
            className="max-h-[78vh] max-w-[92vw] object-contain rounded-lg shadow-2xl transition-transform duration-200 ease-out"
            style={{ transform: `scale(${zoomLevel})` }}
            draggable={false}
          />
        </div>

        {/* 다음 이미지 버튼 */}
        {images.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2.5 sm:p-3 rounded-2xl bg-slate-900/80 hover:bg-brand-600 border border-slate-700 text-white shadow-xl transition backdrop-blur-sm"
            title="다음 이미지 (→)"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </main>

      {/* 하단 썸네일 스트립 (복수 이미지일 때) */}
      {images.length > 1 && (
        <footer
          className="px-4 py-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-center gap-2 overflow-x-auto z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((url, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              className={`relative h-14 w-14 rounded-lg overflow-hidden border-2 transition flex-shrink-0 bg-slate-800 ${
                idx === currentIndex
                  ? 'border-brand-500 ring-2 ring-brand-500/50 scale-105'
                  : 'border-slate-700 opacity-60 hover:opacity-100'
              }`}
            >
              <img
                src={url}
                alt={`썸네일 ${idx + 1}`}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-0.5 right-1 text-[9px] font-bold text-white bg-slate-950/80 px-1 rounded">
                {idx + 1}
              </span>
            </button>
          ))}
        </footer>
      )}
    </div>,
    document.body
  );
};
