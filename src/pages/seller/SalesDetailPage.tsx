import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { SaleStatus } from '../../types/live';
import {
  ShoppingBag,
  ArrowLeft,
  Trash2,
  Save,
  Camera,
  CheckCircle2,
  AlertCircle,
  ExternalLink
} from 'lucide-react';

export const SalesDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sales, updateSale, deleteSale } = useSales();

  const sale = sales.find((s) => s.id === id);

  const [buyerNickname, setBuyerNickname] = useState(sale?.buyerNickname || '');
  const [amount, setAmount] = useState(sale?.amount.toString() || '0');
  const [status, setStatus] = useState<SaleStatus>(sale?.status || '자동저장');
  const [note, setNote] = useState(sale?.note || '');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  if (!sale) {
    return (
      <div className="p-12 text-center text-xs text-slate-500">
        해당 판매 내역을 찾을 수 없습니다.{' '}
        <Link to="/sales" className="text-brand-600 underline font-bold">
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = {
      ...sale,
      buyerNickname,
      amount: parseInt(amount, 10) || 0,
      status,
      note
    };
    updateSale(updated);
    setToastMsg('판매 정보가 성공적으로 수정 저장되었습니다.');
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleDelete = () => {
    if (window.confirm('정말 이 판매 내역을 삭제하시겠습니까?')) {
      deleteSale(sale.id);
      navigate('/sales');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* 상단 네비게이션 */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center space-x-1 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>판매 목록으로 돌아가기</span>
        </button>

        <button
          onClick={handleDelete}
          className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 text-xs font-bold flex items-center space-x-1 transition border border-rose-200"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>삭제하기</span>
        </button>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 메인 상세 및 수정 카드 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900">판매 상세 정보</h1>
              <p className="text-xs text-slate-400 font-mono">ID: {sale.id}</p>
            </div>
          </div>

          <span
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              sale.status === '보류'
                ? 'bg-amber-400 text-slate-950'
                : sale.status === '수동수정'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            현재 상태: {sale.status}
          </span>
        </div>

        {/* 원본 발화 문장 */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            🎙️ AI STT 원본 발화 문장 (전사 기록)
          </span>
          <p className="text-sm font-semibold text-slate-900">"{sale.rawTranscript}"</p>
          <div className="text-[11px] text-slate-400 mt-2 flex items-center space-x-2">
            <span>인식 시각: {new Date(sale.recognizedAt).toLocaleString('ko-KR')}</span>
            <span>•</span>
            <span>방송 회차: {sale.sessionId}</span>
          </div>
        </div>

        {/* 수정 폼 */}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">구매자 닉네임</label>
              <input
                type="text"
                required
                value={buyerNickname}
                onChange={(e) => setBuyerNickname(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">판매 금액 (원)</label>
              <input
                type="number"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">처리 상태</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SaleStatus)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-brand-500"
              >
                <option value="확정">✅ 확정</option>
                <option value="자동저장">📦 자동저장</option>
                <option value="수동수정">✏️ 수동수정</option>
                <option value="보류">⚠️ 보류 (추가 확인 필요)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">관리자/판매자 메모</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="특이사항 메모..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 flex items-center justify-center space-x-1.5 transition"
          >
            <Save className="w-4 h-4" />
            <span>수정사항 저장하기</span>
          </button>
        </form>

        {/* 연결된 화면 캡처 이미지 */}
        {sale.captureImageUrls && sale.captureImageUrls.length > 0 && (
          <div className="border-t border-slate-100 pt-6 space-y-3">
            <h3 className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
              <Camera className="w-4 h-4 text-cyan-600" />
              <span>연결된 댓글창 화면 캡처 ({sale.captureImageUrls.length}장)</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {sale.captureImageUrls.map((imgUrl: string, idx: number) => (
                <div
                  key={idx}
                  className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 relative group shadow-sm"
                >
                  <img src={imgUrl} alt={`캡처 ${idx + 1}`} className="w-full h-40 object-cover" />
                  <Link
                    to={`/sales/${sale.id}/capture`}
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs text-white font-bold transition space-x-1"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>전체화면 보기</span>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
