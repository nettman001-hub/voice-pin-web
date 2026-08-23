import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { User } from '../../types/auth';
import { Users, Search, ShieldAlert, ShieldCheck, CheckCircle2, X } from 'lucide-react';

export const MemberManagementPage: React.FC = () => {
  const { allMembers, suspendMember, unsuspendMember } = useAppData();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | '활성' | '정지'>('ALL');
  const [selectedMember, setSelectedMember] = useState<User | null>(null);

  // 정지 사유 모달
  const [suspendingMember, setSuspendingMember] = useState<User | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const filteredMembers = allMembers.filter((m) => {
    const matchesSearch =
      m.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.nickname.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;

    if (statusFilter !== 'ALL' && m.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const handleOpenSuspend = (member: User) => {
    setSuspendingMember(member);
    setSuspendReason('부적절한 음성 학습 단어 등록 및 이용약관 위반');
  };

  const handleConfirmSuspend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendingMember || !suspendReason.trim()) return;

    suspendMember(suspendingMember.id, suspendReason);
    setToastMsg(`${suspendingMember.nickname} 회원이 정지 처리되었습니다.`);
    setSuspendingMember(null);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleUnsuspend = (member: User) => {
    if (window.confirm(`${member.nickname} 회원의 정지를 해제하시겠습니까?`)) {
      unsuspendMember(member.id);
      setToastMsg(`${member.nickname} 회원의 정지가 해제되었습니다.`);
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">회원 관리 센터</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold">
              총 {allMembers.length}명
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">전체 판매자 및 관리자 계정 상태를 조회하고 계정을 정지/해제합니다.</p>
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 검색 & 필터 바 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-8 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="회원 이메일, 닉네임으로 검색..."
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="sm:col-span-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none"
            >
              <option value="ALL">전체 상태 (활성 + 정지)</option>
              <option value="활성">활성 회원만</option>
              <option value="정지">정지된 회원만</option>
            </select>
          </div>
        </div>

        {/* 회원 목록 테이블 */}
        <div className="space-y-3 pt-2">
          {filteredMembers.map((member) => (
            <div
              key={member.id}
              className={`p-4 rounded-2xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                member.status === '정지'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                  : 'bg-slate-950 border-slate-800 text-slate-200'
              }`}
            >
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-sm text-white">{member.nickname}</span>
                  <span className="text-xs text-slate-400 font-mono">({member.email})</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      member.status === '정지'
                        ? 'bg-rose-500 text-white'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {member.status}
                  </span>
                  <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                    {member.role}
                  </span>
                </div>

                <div className="flex items-center space-x-3 text-[11px] text-slate-400 mt-1">
                  <span>가입일: {member.createdAt}</span>
                  <span>•</span>
                  <span>구독: {member.subscriptionPlan ? `${member.subscriptionPlan} 플랜` : '미구독'}</span>
                  {member.suspendedReason && (
                    <>
                      <span>•</span>
                      <span className="text-rose-400 font-bold">정지 사유: {member.suspendedReason}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setSelectedMember(member)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  상세 보기
                </button>

                {member.status === '활성' ? (
                  <button
                    onClick={() => handleOpenSuspend(member)}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold"
                  >
                    회원 정지
                  </button>
                ) : (
                  <button
                    onClick={() => handleUnsuspend(member)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold"
                  >
                    정지 해제
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 회원 상세 모달 */}
      {selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">회원 상세 정보</h3>
              <button onClick={() => setSelectedMember(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">닉네임 / 이메일</span>
                <p className="text-sm font-bold text-white mt-0.5">{selectedMember.nickname} ({selectedMember.email})</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-400">계정 상태</span>
                  <p className="text-sm font-bold text-emerald-400 mt-0.5">{selectedMember.status}</p>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-400">구독 플랜</span>
                  <p className="text-sm font-bold text-brand-400 mt-0.5">{selectedMember.subscriptionPlan || '없음'}</p>
                </div>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">가입 일자</span>
                <p className="text-xs font-semibold text-slate-200 mt-0.5">{selectedMember.createdAt}</p>
              </div>
            </div>

            <button
              onClick={() => setSelectedMember(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 정지 사유 입력 모달 */}
      {suspendingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-rose-400" />
              <span>회원 계정 이용 정지</span>
            </h3>

            <p className="text-xs text-slate-400">
              <strong>{suspendingMember.nickname}</strong> ({suspendingMember.email}) 회원을 정지 처리합니다. 정지 사유를 입력해주세요.
            </p>

            <form onSubmit={handleConfirmSuspend} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">정지 사유 (필수)</label>
                <textarea
                  required
                  rows={3}
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="예: 부적절한 음성 학습 단어 등록 및 반복 신고"
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSuspendingMember(null)}
                  className="w-1/3 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="w-2/3 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg"
                >
                  정지 처리 확정
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
