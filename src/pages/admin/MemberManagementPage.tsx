import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { User } from '../../types/auth';
import {
  Users,
  Search,
  Shield,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  X
} from 'lucide-react';

export const MemberManagementPage: React.FC = () => {
  const { allMembers, suspendMember, unsuspendMember } = useAppData();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | '활성' | '정지'>('ALL');
  const [selectedMemberForSuspend, setSelectedMemberForSuspend] = useState<User | null>(null);
  const [suspendReason, setSuspendReason] = useState('허위 판매 멘트 및 비정상 트래픽 유발');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const filteredMembers = allMembers.filter((m: User) => {
    const matchSearch =
      m.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.nickname.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchSearch) return false;
    if (statusFilter !== 'ALL' && m.status !== statusFilter) return false;
    return true;
  });

  const handleConfirmSuspend = () => {
    if (!selectedMemberForSuspend) return;
    suspendMember(selectedMemberForSuspend.id, suspendReason);
    setSelectedMemberForSuspend(null);
    setToastMsg(`'${selectedMemberForSuspend.nickname}' 회원이 정지 처리되었습니다.`);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleRelease = (member: User) => {
    unsuspendMember(member.id);
    setToastMsg(`'${member.nickname}' 회원의 정지가 해제되었습니다.`);
    setTimeout(() => setToastMsg(null), 3000);
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">회원 관리</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] sm:text-xs font-bold border border-brand-200">
              총 {allMembers.length}명
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
            등록된 판매자 및 관리자 계정 목록을 조회하고, 비정상 활동 사용자를 정지/해제합니다.
          </p>
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 검색 및 필터 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3 sm:space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-full sm:max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="이메일 또는 닉네임 검색..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-1 text-xs">
            <span className="text-slate-500 flex-shrink-0">상태:</span>
            {(['ALL', '활성', '정지'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex-shrink-0 ${
                  statusFilter === st
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {st === 'ALL' ? '전체' : st}
              </button>
            ))}
          </div>
        </div>

        {/* 회원 테이블 */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-3 px-4">회원 정보</th>
                <th className="py-3 px-4">구분 / 플랜</th>
                <th className="py-3 px-4">가입일</th>
                <th className="py-3 px-4">상태</th>
                <th className="py-3 px-4 text-right">계정 관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMembers.map((m: User) => (
                <tr key={m.id} className="hover:bg-slate-50/80 transition">
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-900">{m.nickname}</div>
                    <div className="text-[11px] text-slate-400">{m.email}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-brand-50 text-brand-700 text-[10px] font-bold border border-brand-200 mr-1.5">
                      {m.role}
                    </span>
                    <span className="text-slate-600 font-medium">{m.subscriptionPlan}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 font-mono">{m.createdAt}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      m.status === '활성'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {m.status}
                    </span>
                    {m.suspendedReason && (
                      <span className="block text-[10px] text-rose-500 mt-0.5 truncate max-w-xs">
                        사유: {m.suspendedReason}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {m.status === '활성' ? (
                      <button
                        onClick={() => setSelectedMemberForSuspend(m)}
                        className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs border border-rose-200 transition"
                      >
                        계정 정지
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRelease(m)}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs border border-slate-200 transition"
                      >
                        정지 해제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 정지 사유 입력 모달 */}
      {selectedMemberForSuspend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                <span>계정 정지 사유 입력</span>
              </h3>
              <button onClick={() => setSelectedMemberForSuspend(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              <strong>{selectedMemberForSuspend.nickname}</strong> ({selectedMemberForSuspend.email}) 회원을 정지하시겠습니까?
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">정지 사유</label>
              <textarea
                rows={3}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setSelectedMemberForSuspend(null)}
                className="w-1/2 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold"
              >
                취소
              </button>
              <button
                onClick={handleConfirmSuspend}
                className="w-1/2 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-500/20"
              >
                정지 확정
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
