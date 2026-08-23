import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Download, Trash2, Share2, ZoomIn, ZoomOut } from 'lucide-react';

interface CaptureViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: string[];
  saleInfo?: {
    nickname?: string;
    amount?: number;
    time?: string;
  };
}

export const CaptureViewerModal: React.FC<CaptureViewerModalProps> = ({
  isOpen,
  onClose,
  images,
  saleInfo
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);

  if (!isOpen || images.length === 0) return null;

  const currentImage = images[currentIndex] || images[0];

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    setZoomLevel(1);
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    setZoomLevel(1);
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = currentImage;
    link.download = `다들려_캡처_${saleInfo?.nickname || '판매'}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: '다들려 틱톡 라이브 판매 캡처',
        text: `구매자: ${saleInfo?.nickname}, 금액: ${saleInfo?.amount?.toLocaleString()}원`,
        url: window.location.href
      }).catch(() => {});
    } else {
      alert('공유 링크가 클립보드에 복사되었습니다.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[95vh]">
        {/* 상단 바 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center space-x-3">
            <span className="font-bold text-sm text-white">캡처 이미지 뷰어</span>
            <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
              {currentIndex + 1} / {images.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.25))}
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
              title="확대"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoomLevel((z) => Math.max(1, z - 0.25))}
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
              title="축소"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white shadow"
              title="다운로드"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handleShare}
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
              title="공유"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 메인 이미지 뷰어 영역 */}
        <div className="flex-1 bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden min-h-[420px]">
          {images.length > 1 && (
            <>
              <button
                onClick={handlePrev}
                className="absolute left-4 p-3 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-700 shadow-xl transition"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                onClick={handleNext}
                className="absolute right-4 p-3 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-700 shadow-xl transition"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}

          <div
            className="transition-transform duration-200 ease-out max-h-[60vh] overflow-hidden flex items-center justify-center"
            style={{ transform: `scale(${zoomLevel})` }}
          >
            <img
              src={currentImage}
              alt="캡처"
              className="max-h-[60vh] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800"
            />
          </div>
        </div>

        {/* 하단 캡처 정보 바 */}
        <div className="px-6 py-4 bg-slate-950/90 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-300 gap-2">
          <div className="flex items-center space-x-4">
            <span>구매자: <strong className="text-white">{saleInfo?.nickname || '미확인'}</strong></span>
            <span>•</span>
            <span>금액: <strong className="text-brand-400">{saleInfo?.amount ? `${saleInfo.amount.toLocaleString()}원` : '0원'}</strong></span>
            <span>•</span>
            <span>시각: {saleInfo?.time || new Date().toLocaleTimeString('ko-KR')}</span>
          </div>

          <div className="text-slate-400 text-[11px]">
            * 마우스 드래그 또는 줌 버튼으로 확대/축소 가능합니다.
          </div>
        </div>
      </div>
    </div>
  );
};
