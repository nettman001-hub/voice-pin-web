import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { Camera, Download, ZoomIn, ZoomOut, ArrowLeft, X } from 'lucide-react';

export const CaptureViewerModal: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sales } = useSales();

  const sale = sales.find((s) => s.id === id);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);

  if (!sale || !sale.captureImageUrls || sale.captureImageUrls.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
        <div className="bg-white p-6 rounded-3xl text-center space-y-4 max-w-sm w-full shadow-2xl">
          <p className="text-xs text-slate-500">해당 주문에 연결된 캡처 이미지가 없습니다.</p>
          <button
            onClick={() => navigate(-1)}
            className="w-full py-2 bg-brand-600 text-white rounded-xl text-xs font-bold"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  const currentUrl = sale.captureImageUrls[currentImageIndex];

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = currentUrl;
    a.download = `VoiceCAP_캡처_${sale.buyerNickname}_${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full flex flex-col max-h-[92vh] overflow-hidden shadow-2xl">
        {/* 상단 툴바 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center space-x-2">
            <Camera className="w-5 h-5 text-cyan-600" />
            <h3 className="text-sm font-bold text-slate-900">
              {sale.buyerNickname}님 캡처 뷰어 ({currentImageIndex + 1}/{sale.captureImageUrls.length})
            </h3>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setZoomLevel((prev) => Math.min(prev + 0.25, 2.5))}
              className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
              title="확대"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoomLevel((prev) => Math.max(prev - 0.25, 0.75))}
              className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
              title="축소"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold flex items-center space-x-1 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>다운로드</span>
            </button>
            <button
              onClick={() => navigate(-1)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 메인 뷰어 */}
        <div className="flex-1 bg-slate-100 p-6 flex items-center justify-center overflow-auto min-h-[350px]">
          <img
            src={currentUrl}
            alt="댓글 캡처"
            className="rounded-2xl shadow-lg transition-transform duration-200 object-contain max-h-[65vh]"
            style={{ transform: `scale(${zoomLevel})` }}
          />
        </div>

        {/* 하단 썸네일 스트립 (복수 장일 때) */}
        {sale.captureImageUrls.length > 1 && (
          <div className="p-3 bg-white border-t border-slate-100 flex space-x-2 overflow-x-auto justify-center">
            {sale.captureImageUrls.map((url: string, idx: number) => (
              <button
                key={idx}
                onClick={() => setCurrentImageIndex(idx)}
                className={`w-14 h-14 rounded-xl overflow-hidden border-2 transition ${
                  idx === currentImageIndex ? 'border-brand-500 shadow-md' : 'border-slate-200 opacity-60'
                }`}
              >
                <img src={url} alt={`썸네일 ${idx}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
