import React from 'react';
import { VoiceSaleCandidate } from '../../services/voiceSaleCandidate';
import { ProductSalesProduct } from '../../types/productSales';
import { Package, Camera, AlertCircle, CheckCircle, Clock, X, Pause, Play } from 'lucide-react';

interface ProductRegistrationPreviewProps {
  activeProduct: ProductSalesProduct | null;
  candidate: VoiceSaleCandidate | null;
  onEditCandidate?: () => void;
  onResumeCandidate?: () => void;
  onCancelCandidate?: () => void;
  onImmediateCommit?: () => void;
}

export const ProductRegistrationPreview: React.FC<ProductRegistrationPreviewProps> = ({
  activeProduct,
  candidate,
  onEditCandidate,
  onResumeCandidate,
  onCancelCandidate,
  onImmediateCommit,
}) => {
  return (
    <div className="flex flex-col gap-3">
      {/* 1. Active Product Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 font-bold border border-brand-100 overflow-hidden">
            {activeProduct?.imageUrl ? (
              <img
                src={activeProduct.imageUrl}
                alt={activeProduct.name || activeProduct.productCode}
                className="w-full h-full object-cover"
              />
            ) : (
              <Package className="w-6 h-6" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-brand-100 text-brand-700">
                {activeProduct?.imageKind === 'NUMBER_IMAGE' ? '번호이미지' : '상품사진'}
              </span>
              {activeProduct?.source && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                  {activeProduct.source === 'ANDROID' ? '앱 등록' : activeProduct.source === 'WEB_VOICE' ? '음성 등록' : '웹 등록'}
                </span>
              )}
              <h3 className="font-bold text-slate-800">
                {activeProduct ? activeProduct.productCode : '현재 활성 상품 없음'}
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              {activeProduct?.name || '상품명을 입력하지 않음'} ·{' '}
              <span className="font-bold text-brand-600">
                {activeProduct?.unitPrice != null
                  ? `₩${activeProduct.unitPrice.toLocaleString()}`
                  : '가격 미정'}
              </span>
            </p>
          </div>
        </div>
        {activeProduct && (
          <div className="text-right text-xs text-slate-500">
            버전 {activeProduct.revision} · 판매 {activeProduct.salesRevision}회
          </div>
        )}
      </div>

      {/* 2. Candidate Preview Card (2.5s countdown) */}
      {candidate && (
        <div
          className={`border rounded-xl p-4 shadow-sm transition-all ${
            candidate.state === 'ERROR'
              ? 'bg-rose-50 border-rose-200'
              : candidate.state === 'SAVING'
              ? 'bg-amber-50 border-amber-200'
              : candidate.state === 'SAVED'
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-indigo-50 border-indigo-200'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {candidate.state === 'ERROR' ? (
                <AlertCircle className="w-5 h-5 text-rose-600" />
              ) : candidate.state === 'SAVED' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              ) : (
                <Clock className="w-5 h-5 text-indigo-600 animate-pulse" />
              )}
              <span className="font-bold text-sm text-slate-800">
                {candidate.type === 'PRODUCT_REGISTRATION' ? '상품등록 음성 후보' : '판매확정 음성 후보'}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-white/70 font-semibold text-slate-600">
                {candidate.state}
              </span>
            </div>

            {/* Countdown timer badge */}
            {candidate.state === 'COUNTDOWN' && (
              <span className="text-xs font-mono font-bold text-indigo-700 bg-white px-2 py-0.5 rounded-full border border-indigo-200">
                {(candidate.countdownMs / 1000).toFixed(1)}초 후 자동 저장
              </span>
            )}
          </div>

          {/* Details */}
          <div className="text-sm text-slate-700 mb-3 space-y-1">
            {candidate.type === 'SALE' && (
              <div>
                구매자:{' '}
                <span className="font-bold text-slate-900">
                  {candidate.buyerNickname || '알 수 없음'}
                </span>{' '}
                · 수량: <span className="font-bold">{candidate.quantity}개</span> · 금액:{' '}
                <span className="font-bold text-brand-600">
                  {candidate.unitPrice != null
                    ? `₩${(candidate.unitPrice * candidate.quantity).toLocaleString()}`
                    : '가격 미정'}
                </span>
              </div>
            )}
            {candidate.error && (
              <p className="text-xs font-semibold text-rose-600">{candidate.error}</p>
            )}
          </div>

          {/* Countdown Progress Bar */}
          {candidate.state === 'COUNTDOWN' && (
            <div className="w-full bg-indigo-100 rounded-full h-2 mb-3 overflow-hidden">
              <div
                className="bg-indigo-600 h-2 transition-all duration-100"
                style={{
                  width: `${(candidate.countdownMs / candidate.totalMs) * 100}%`,
                }}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2">
            {candidate.state === 'COUNTDOWN' && onEditCandidate && (
              <button
                type="button"
                onClick={onEditCandidate}
                className="px-3 py-1 bg-white border border-indigo-300 text-indigo-700 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-indigo-50"
              >
                <Pause className="w-3.5 h-3.5" /> 일시정지 / 수정
              </button>
            )}
            {candidate.state === 'EDITING' && onResumeCandidate && (
              <button
                type="button"
                onClick={onResumeCandidate}
                className="px-3 py-1 bg-white border border-indigo-300 text-indigo-700 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-indigo-50"
              >
                <Play className="w-3.5 h-3.5" /> 재개
              </button>
            )}
            {onCancelCandidate && (
              <button
                type="button"
                onClick={onCancelCandidate}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-slate-50"
              >
                <X className="w-3.5 h-3.5" /> 취소
              </button>
            )}
            {onImmediateCommit && candidate.state !== 'ERROR' && candidate.state !== 'SAVED' && (
              <button
                type="button"
                onClick={onImmediateCommit}
                className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700"
              >
                즉시 저장
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
