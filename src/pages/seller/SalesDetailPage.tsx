import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { SaleRecord } from '../../types/live';
import { CaptureViewerModal } from './CaptureViewerModal';
import {
  ArrowLeft,
  Edit3,
  Trash2,
  Check,
  X,
  Camera,
  Calendar,
  DollarSign,
  User,
  FileText,
  Clock,
  CheckCircle2
} from 'lucide-react';

export const SalesDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sales, updateSale, deleteSale } = useSales();

  const sale = sales.find((s) => s.id === id);

  const [isEditing, setIsEditing] = useState(false);
  const [nickname, setNickname] = useState(sale?.buyerNickname || '');
  const [amount, setAmount] = useState(sale?.amount?.toString() || '0');
  const [status, setStatus] = useState(sale?.status || '자동저장');
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  if (!sale) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center space-y-4">
        <h2 className="text-xl font-bold text-white">판매 내역을 찾을 수 없습니다.</h2>
        <Link to="/sales" className="text-xs text-brand-400 hover:underline">
          판매 내역 목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedAmount = parseInt(amount.replace(/,/g, ''), 10) || 0;
    const updated: SaleRecord = {
      ...sale,
      buyerNickname: nickname.trim(),
      amount: updatedAmount,
      status: '수동수정'
    };
    updateSale(updated);
    setIsEditing(false);
    setToastMsg('판매 내역이 성공적으로 수정되었습니다.');
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleDelete = () => {
    if (window.confirm('이 판매 내역을 삭제하시겠습니까?')) {
      deleteSale(sale.id);
      navigate('/sales');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* 뒤로가기 & 헤더 */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/sales')}
          className="flex items-center space-x-1 text-xs text-slate-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>판매 내역 목록으로</span>
        </button>

        <div className="flex items-center space-x-2">
          {!isEditing ? (
            <>
              <button
                onClick={() => setIsEditing(true)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>수정하기</span>
              </button>
              <button
                onClick={handleDelete}
                className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-bold border border-rose-500/30 flex items-center space-x-1.5 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>삭제하기</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(false)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white text-xs font-bold flex items-center space-x-1.5"
            >
              <X className="w-3.5 h-3.5" />
              <span>수정 취소</span>
            </button>
          )}
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 메인 상세 정보 카드 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl space-y-6">
        <div className="flex items-center justify-between pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-2xl font-black text-white">{sale.buyerNickname}</h1>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                sale.status === '보류'
                  ? 'bg-amber-400 text-slate-950'
                  : sale.status === '수동수정'
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'bg-emerald-500/20 text-emerald-300'
              }`}>
                {sale.status}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              방송 회차 ID: <strong className="text-slate-200">{sale.sessionId}</strong>
            </p>
          </div>

          <div className="text-right">
            <span className="text-xs text-slate-400">판매 금액</span>
            <div className="text-3xl font-black text-brand-400 mt-0.5">
              {sale.amount.toLocaleString()}원
            </div>
          </div>
        </div>

        {/* 인라인 수정 모드 */}
        {isEditing ? (
          <form onSubmit={handleSaveEdit} className="p-6 bg-slate-950 rounded-2xl border border-brand-500/50 space-y-4">
            <h4 className="text-xs font-bold text-brand-300 uppercase tracking-wider">판매 정보 수정</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">구매자 닉네임</label>
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">금액 (원)</label>
                <input
                  type="number"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-md"
            >
              수정 내용 저장
            </button>
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400 flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1" /> 인식 시각
              </span>
              <p className="text-sm font-semibold text-slate-200">
                {new Date(sale.recognizedAt).toLocaleString('ko-KR')}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400 flex items-center">
                <FileText className="w-3.5 h-3.5 mr-1" /> 전사 원본 발화 문장
              </span>
              <p className="text-xs text-slate-300 italic">
                "{sale.rawTranscript}"
              </p>
            </div>
          </div>
        )}

        {/* 연결된 캡처 이미지 섹션 */}
        <div className="pt-4 border-t border-slate-800">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center space-x-2">
            <Camera className="w-4 h-4 text-tiktok-cyan" />
            <span>연결된 캡처 이미지</span>
          </h3>

          {sale.captureImageUrls && sale.captureImageUrls.length > 0 ? (
            <div className="flex gap-4">
              {sale.captureImageUrls.map((url, idx) => (
                <div
                  key={idx}
                  onClick={() => setIsCaptureModalOpen(true)}
                  className="w-32 h-44 rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 cursor-pointer hover:opacity-85 transition relative group"
                >
                  <img src={url} alt="캡처" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs text-white font-bold transition">
                    크게 보기
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-slate-950/40 border border-dashed border-slate-800 text-center text-xs text-slate-400">
              이 판매 건에 저장된 화면 캡처 이미지가 없습니다.
            </div>
          )}
        </div>
      </div>

      {/* 캡처 이미지 뷰어 모달 (PG-011) */}
      <CaptureViewerModal
        isOpen={isCaptureModalOpen}
        onClose={() => setIsCaptureModalOpen(false)}
        images={sale.captureImageUrls || []}
        saleInfo={{
          nickname: sale.buyerNickname,
          amount: sale.amount,
          time: new Date(sale.recognizedAt).toLocaleString('ko-KR')
        }}
      />
    </div>
  );
};
