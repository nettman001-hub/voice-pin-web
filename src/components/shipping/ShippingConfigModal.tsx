import React, { useState, useEffect } from 'react';
import { Truck, X, Save, CheckCircle2, RotateCcw, Sparkles } from 'lucide-react';
import { ShippingConfig, ShippingConditionType } from '../../types/shipping';
import { shippingService, DEFAULT_SHIPPING_CONFIG } from '../../services/shippingService';
import { useAuth } from '../../context/AuthContext';

interface ShippingConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (newConfig: ShippingConfig) => void;
}

export const ShippingConfigModal: React.FC<ShippingConfigModalProps> = ({
  isOpen,
  onClose,
  onSaved
}) => {
  const { workspaceId } = useAuth();
  const [config, setConfig] = useState<ShippingConfig>(() => shippingService.getConfig(workspaceId));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(shippingService.getConfig(workspaceId));
      if (workspaceId) {
        shippingService.fetchRemoteConfig(workspaceId)
          .then((remote) => setConfig(remote))
          .catch(() => {});
      }
    }
  }, [isOpen, workspaceId]);

  if (!isOpen) return null;

  const handleTypeChange = (type: ShippingConditionType) => {
    setConfig((prev) => ({ ...prev, type }));
  };

  const handleNumberChange = (field: 'defaultFee' | 'freeThreshold' | 'remoteAreaFee', value: string) => {
    const num = parseInt(value.replace(/[^0-9]/g, ''), 10) || 0;
    setConfig((prev) => ({ ...prev, [field]: num }));
  };

  const handleResetDefaults = () => {
    if (window.confirm('택배비 설정을 기본값(50,000원 이상 무료, 미만 3,000원)으로 초기화하시겠습니까?')) {
      setConfig({ ...DEFAULT_SHIPPING_CONFIG, updatedAt: new Date().toISOString() });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await shippingService.saveConfig(config, workspaceId);
      onSaved?.(config);
      onClose();
    } catch (err) {
      alert('설정 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-50 border border-brand-200 text-brand-600">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-sm sm:text-base">택배비 조건 설정</h3>
              <p className="text-[11px] text-slate-500">방송 및 판매 주문에 기본 적용되는 배송비 정책을 설정합니다.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 설정 내용 */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* 배송비 정책 라디오 선택 */}
          <div className="space-y-2.5">
            <label className="block text-xs font-black text-slate-800">택배비 정책 유형 선택</label>
            
            {/* 1. 조건부 무료 */}
            <div
              onClick={() => handleTypeChange('CONDITIONAL_FREE')}
              className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                config.type === 'CONDITIONAL_FREE'
                  ? 'border-brand-500 bg-brand-50/50 shadow-xs ring-1 ring-brand-500'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="shippingType"
                checked={config.type === 'CONDITIONAL_FREE'}
                onChange={() => handleTypeChange('CONDITIONAL_FREE')}
                className="mt-0.5 text-brand-600 focus:ring-brand-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900">금액별 조건부 무료배송</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-100 text-brand-700">권장</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  일정 금액 이상 구매 시 무료배송, 미만 시 기본 택배비를 부과합니다.
                </p>
                {config.type === 'CONDITIONAL_FREE' && (
                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-brand-200/60">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">무료배송 기준 금액</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={config.freeThreshold.toLocaleString()}
                          onChange={(e) => handleNumberChange('freeThreshold', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded-lg text-right pr-6 focus:outline-none focus:border-brand-500"
                        />
                        <span className="absolute right-2 top-1.5 text-xs text-slate-400">원</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">미만 시 기본 택배비</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={config.defaultFee.toLocaleString()}
                          onChange={(e) => handleNumberChange('defaultFee', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded-lg text-right pr-6 focus:outline-none focus:border-brand-500"
                        />
                        <span className="absolute right-2 top-1.5 text-xs text-slate-400">원</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 2. 무조건 고정 배송비 */}
            <div
              onClick={() => handleTypeChange('FIXED')}
              className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                config.type === 'FIXED'
                  ? 'border-brand-500 bg-brand-50/50 shadow-xs ring-1 ring-brand-500'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="shippingType"
                checked={config.type === 'FIXED'}
                onChange={() => handleTypeChange('FIXED')}
                className="mt-0.5 text-brand-600 focus:ring-brand-500"
              />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold text-slate-900">택배비 무조건 고정 부과</span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  구매 금액과 관계없이 모든 주문 건에 동일한 택배비를 부과합니다.
                </p>
                {config.type === 'FIXED' && (
                  <div className="mt-3 pt-3 border-t border-brand-200/60 max-w-[12rem]">
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">고정 택배비 금액</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={config.defaultFee.toLocaleString()}
                        onChange={(e) => handleNumberChange('defaultFee', e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded-lg text-right pr-6 focus:outline-none focus:border-brand-500"
                      />
                      <span className="absolute right-2 top-1.5 text-xs text-slate-400">원</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 3. 조건 없이 무료배송 */}
            <div
              onClick={() => handleTypeChange('FREE')}
              className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                config.type === 'FREE'
                  ? 'border-brand-500 bg-brand-50/50 shadow-xs ring-1 ring-brand-500'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="shippingType"
                checked={config.type === 'FREE'}
                onChange={() => handleTypeChange('FREE')}
                className="mt-0.5 text-brand-600 focus:ring-brand-500"
              />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold text-slate-900">조건 없이 전 상품 무료배송 (0원)</span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  모든 주문 건의 배송비를 0원으로 처리합니다.
                </p>
              </div>
            </div>
          </div>

          {/* 키핑(보관) 묶음배송 무료 조건 합산 옵션 */}
          <div className="p-3.5 rounded-xl bg-purple-50/70 border border-purple-200 space-y-2">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.includeKeepingInThreshold}
                onChange={(e) => setConfig((prev) => ({ ...prev, includeKeepingInThreshold: e.target.checked }))}
                className="mt-0.5 rounded text-purple-600 focus:ring-purple-500"
              />
              <div className="text-xs">
                <span className="font-bold text-purple-900 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  키핑(보관) 상품 금액도 무료배송 기준에 합산
                </span>
                <p className="text-[11px] text-purple-700 leading-relaxed mt-0.5">
                  고객이 이전 회차에 보관(키핑)해둔 금액과 이번 회차 구매 금액을 합쳐서 무료배송 기준(예: {config.freeThreshold.toLocaleString()}원)을 달성하면 자동으로 무료배송을 적용합니다.
                </p>
              </div>
            </label>
          </div>

          {/* 안내 배너 */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>판매내역 화면에서 각 고객별로 택배비를 <strong>직접 수정하거나 0원으로 면제, 추가</strong>할 수도 있습니다.</span>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 bg-slate-50">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" /> 기본값 복원
          </button>
          
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? '저장 중...' : '설정 저장'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
