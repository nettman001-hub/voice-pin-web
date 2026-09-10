import React, { useState } from 'react';
import { useProductSales } from '../../context/ProductSalesContext';
import { getNextProductCodeForSession } from '../../services/storageService';
import { ProductRegistrationPreview } from '../../components/live/ProductRegistrationPreview';
import { Package, Plus, Settings as SettingsIcon, Check, RefreshCw, ShoppingCart } from 'lucide-react';
import { CommitSaleBuyer, LiveComment } from '../../types/productSales';

export const ProductSalesPage: React.FC = () => {
  const {
    bootstrap,
    activeProduct,
    activeSession,
    settings,
    feed,
    candidate,
    isLoading,
    loadBootstrap,
    registerProduct,
    commitSales,
    cancelCandidate,
    pauseCandidate,
    resumeCandidate,
  } = useProductSales();

  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [inputCodeOrName, setInputCodeOrName] = useState('');
  const [inputPrice, setInputPrice] = useState('');
  const [selectedBuyerMap, setSelectedBuyerMap] = useState<Map<string, { quantity: number; commentIds: string[]; nickname: string }>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Handle comment selection
  const handleToggleComment = (commentId: string, buyerId: string, nickname: string) => {
    setSelectedBuyerMap((prev) => {
      const next = new Map(prev);
      if (next.has(buyerId)) {
        const existing = next.get(buyerId)!;
        if (existing.commentIds.includes(commentId)) {
          const filtered = existing.commentIds.filter((id) => id !== commentId);
          if (filtered.length === 0) {
            next.delete(buyerId);
          } else {
            next.set(buyerId, { ...existing, commentIds: filtered });
          }
        } else {
          // Multiple comments by same buyer coalesce: default quantity remains 1 per contract!
          next.set(buyerId, { ...existing, commentIds: [...existing.commentIds, commentId] });
        }
      } else {
        // Newly selected buyer: quantity defaults to 1
        next.set(buyerId, { quantity: 1, commentIds: [commentId], nickname });
      }
      return next;
    });
  };

  const handleAdjustQuantity = (buyerId: string, delta: number) => {
    setSelectedBuyerMap((prev) => {
      const next = new Map(prev);
      if (next.has(buyerId)) {
        const existing = next.get(buyerId)!;
        const newQty = Math.max(1, existing.quantity + delta);
        next.set(buyerId, { ...existing, quantity: newQty });
      }
      return next;
    });
  };

  const nextAutoCode = getNextProductCodeForSession(
    activeSession?.id,
    undefined,
    activeProduct?.productCode
  );

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const trimmed = inputCodeOrName.trim();
      const isDigitsOnly = /^\d+$/.test(trimmed);
      const requestedCode = isDigitsOnly && trimmed.length > 0
        ? trimmed
        : (!trimmed ? nextAutoCode : undefined);
      const name = !isDigitsOnly && trimmed.length > 0 ? trimmed : undefined;
      const price = inputPrice ? parseInt(inputPrice.replace(/,/g, ''), 10) : undefined;

      // 웹 수동 입력에는 카메라 촬영 단계가 없으므로 번호가 표시된 임시이미지를 실제 저장소에 올린다.
      await registerProduct({
        requestedProductCode: requestedCode || nextAutoCode,
        name,
        unitPrice: price ?? 0,
        imageKind: 'NUMBER_IMAGE',
      });

      setIsRegisterOpen(false);
      setInputCodeOrName('');
      setInputPrice('');
    } catch (err: any) {
      alert(err.message || '상품 등록 실패');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCommitSalesSubmit = async () => {
    if (selectedBuyerMap.size === 0) return;
    try {
      setIsSubmitting(true);
      const buyers: CommitSaleBuyer[] = Array.from(selectedBuyerMap.entries()).map(([bId, data]) => ({
        buyerId: bId,
        quantity: data.quantity,
        sourceCommentIds: data.commentIds,
      }));

      await commitSales(buyers);
      setSelectedBuyerMap(new Map());
    } catch (err: any) {
      alert(err.message || '판매 확정 실패');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalSelectedQuantity = Array.from(selectedBuyerMap.values()).reduce((sum, b) => sum + b.quantity, 0);
  const unitPrice = activeProduct?.unitPrice || 0;
  const totalSelectedAmount = totalSelectedQuantity * unitPrice;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6 pb-28">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-brand-600" />
            상품 중심 판매관리
          </h1>
          <p className="text-xs text-slate-500">
            {activeSession ? `${activeSession.displayCode} (v${activeSession.revision})` : '진행 중인 회차 없음'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadBootstrap()}
            className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
            title="새로고침"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          {settings?.productRegistrationEnabled && (
            <button
              type="button"
              onClick={() => setIsRegisterOpen(true)}
              className="px-3 py-2 bg-brand-600 text-white text-xs font-bold rounded-lg flex items-center gap-1 hover:bg-brand-700 shadow-sm"
            >
              <Plus className="w-4 h-4" /> 상품등록
            </button>
          )}
        </div>
      </div>

      {/* 2.5s Candidate Preview Bar & Active Product */}
      <ProductRegistrationPreview
        activeProduct={activeProduct}
        candidate={candidate}
        onCancelCandidate={cancelCandidate}
        onEditCandidate={pauseCandidate}
        onResumeCandidate={resumeCandidate}
      />

      {/* Product Registration Modal */}
      {isRegisterOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 mb-4">신규 상품 등록</h2>
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  상품번호 또는 상품명
                </label>
                <input
                  type="text"
                  value={inputCodeOrName}
                  onChange={(e) => setInputCodeOrName(e.target.value)}
                  placeholder={`예: ${nextAutoCode} (미입력 시 ${nextAutoCode}번 자동 부여)`}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-brand-500"
                />
                <p className="text-xs text-slate-400 mt-1">
                  미입력 시 현재 회차 다음 상품번호({nextAutoCode}번)가 자동으로 부여됩니다. 숫자만 입력 시 선행 0이 유지됩니다 (예: 0007).
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">판매 단가 (원)</label>
                <input
                  type="number"
                  value={inputPrice}
                  onChange={(e) => setInputPrice(e.target.value)}
                  placeholder="예: 35000"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-brand-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRegisterOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-brand-600 text-white text-xs font-bold rounded-lg hover:bg-brand-700 disabled:opacity-50"
                >
                  {isSubmitting ? '등록 중...' : '등록 완료'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Real-time Comments Feed */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm text-slate-800">
            실시간 댓글 ({feed?.comments.length || 0}건)
          </h2>
          <span className="text-xs text-slate-400">동일 구매자 댓글은 1인으로 묶여 기본수량 1이 부여됩니다</span>
        </div>

        <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
          {feed?.comments && feed.comments.length > 0 ? (
            feed.comments.map((c: LiveComment) => {
              const bId = c.buyerId || c.nicknameSnapshot;
              const isSelected = selectedBuyerMap.has(bId) && selectedBuyerMap.get(bId)!.commentIds.includes(c.id);
              const bData = selectedBuyerMap.get(bId);

              return (
                <div
                  key={c.id}
                  className={`p-3 flex items-center justify-between transition-colors ${
                    isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div
                    className="flex items-center gap-3 cursor-pointer flex-1"
                    onClick={() => handleToggleComment(c.id, bId, c.nicknameSnapshot)}
                  >
                    <div
                      className={`w-5 h-5 rounded border flex items-center justify-center ${
                        isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{c.nicknameSnapshot}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(c.capturedAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700">{c.content}</p>
                    </div>
                  </div>

                  {/* Quantity controls if selected */}
                  {isSelected && bData && (
                    <div className="flex items-center gap-1.5 ml-4">
                      <button
                        type="button"
                        onClick={() => handleAdjustQuantity(bId, -1)}
                        className="w-7 h-7 bg-white border border-slate-200 rounded text-slate-700 font-bold text-xs hover:bg-slate-100"
                      >
                        -
                      </button>
                      <span className="text-xs font-bold text-slate-900 w-6 text-center">
                        {bData.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAdjustQuantity(bId, 1)}
                        className="w-7 h-7 bg-white border border-slate-200 rounded text-slate-700 font-bold text-xs hover:bg-slate-100"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center text-xs text-slate-400">
              수집된 댓글이 없습니다.
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900 text-white p-4 shadow-2xl border-t border-slate-800 z-40">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">선택한 구매자</div>
            <div className="font-bold text-sm">
              {selectedBuyerMap.size}명 (총 {totalSelectedQuantity}개) ·{' '}
              <span className="text-brand-400">₩{totalSelectedAmount.toLocaleString()}</span>
            </div>
          </div>

          <button
            type="button"
            disabled={selectedBuyerMap.size === 0 || isSubmitting}
            onClick={handleCommitSalesSubmit}
            className="px-5 py-2.5 bg-brand-600 text-white font-bold text-sm rounded-xl hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg transition-all"
          >
            {isSubmitting ? '저장 중...' : '판매등록완료'}
          </button>
        </div>
      </div>
    </div>
  );
};
