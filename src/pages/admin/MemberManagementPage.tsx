import React, { useState, useEffect } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { User } from '../../types/auth';
import { SellerSttUsageSummary, SttUsageLogItem } from '../../types/admin';
import { remoteWorkspaceService } from '../../services/remoteWorkspaceService';
import {
  Users,
  Search,
  Shield,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  X,
  Key,
  Sparkles,
  RefreshCw,
  Cloud,
  Database,
  Activity,
  Clock,
  FileText,
  ChevronRight
} from 'lucide-react';

const formatDuration = (seconds: number) => {
  if (!seconds || seconds <= 0) return '0초';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}초`;
  if (secs === 0) return `${mins}분`;
  return `${mins}분 ${secs}초`;
};

export const MemberManagementPage: React.FC = () => {
  const {
    allMembers,
    suspendMember,
    unsuspendMember,
    setMemberSttAccess,
    refreshMembers,
    isSyncingMembers,
    memberSyncError
  } = useAppData();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | '활성' | '정지'>('ALL');
  const [selectedMemberForSuspend, setSelectedMemberForSuspend] = useState<User | null>(null);
  const [suspendReason, setSuspendReason] = useState('허위 판매 멘트 및 비정상 트래픽 유발');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // STT 사용량 상태 관리
  const [sttSummaryMap, setSttSummaryMap] = useState<Record<string, SellerSttUsageSummary>>({});
  const [isLoadingStt, setIsLoadingStt] = useState(false);
  const [selectedMemberForSttLogs, setSelectedMemberForSttLogs] = useState<User | null>(null);
  const [sttLogs, setSttLogs] = useState<SttUsageLogItem[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // STT 사용량 요약 목록 로드
  const loadSttSummaries = async () => {
    setIsLoadingStt(true);
    try {
      const summaries = await remoteWorkspaceService.fetchSttUsageSummary();
      const map: Record<string, SellerSttUsageSummary> = {};
      summaries.forEach((s) => {
        map[s.userId] = s;
      });
      setSttSummaryMap(map);
    } catch (err) {
      console.error('STT 사용량 요약 로드 실패:', err);
    } finally {
      setIsLoadingStt(false);
    }
  };

  useEffect(() => {
    loadSttSummaries();
  }, []);

  // 특정 회원의 세부 STT 로그 조회
  const handleOpenSttLogs = async (member: User) => {
    setSelectedMemberForSttLogs(member);
    setIsLoadingLogs(true);
    try {
      const logs = await remoteWorkspaceService.fetchSttUsageLogs(member.id);
      setSttLogs(logs);
    } catch (err) {
      console.error('STT 세부 로그 로드 실패:', err);
      setSttLogs([]);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleToggleSttAccess = async (member: User) => {
    const nextState = !member.allowAdminSttKey;
    const success = await setMemberSttAccess(member.id, nextState);
    if (!success) return;
    setToastMsg(
      nextState
        ? `'${member.nickname}' 판매자에게 관리자 STT API 키 이용을 허락했습니다! 🎉`
        : `'${member.nickname}' 판매자의 관리자 STT API 키 이용 권한을 해제했습니다.`
    );
    setTimeout(() => setToastMsg(null), 3000);
  };

  const filteredMembers = allMembers.filter((m: User) => {
    const matchSearch =
      m.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.nickname.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchSearch) return false;
    if (statusFilter !== 'ALL' && m.status !== statusFilter) return false;
    return true;
  });

  const handleConfirmSuspend = async () => {
    if (!selectedMemberForSuspend) return;
    const success = await suspendMember(selectedMemberForSuspend.id, suspendReason);
    if (!success) return;
    setSelectedMemberForSuspend(null);
    setToastMsg(`'${selectedMemberForSuspend.nickname}' 회원이 정지 처리되었습니다.`);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleRelease = async (member: User) => {
    const success = await unsuspendMember(member.id);
    if (!success) return;
    setToastMsg(`'${member.nickname}' 회원의 정지가 해제되었습니다.`);
    setTimeout(() => setToastMsg(null), 3000);
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">회원 관리 & STT 모니터링</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] sm:text-xs font-bold border border-brand-200">
              총 {allMembers.length}명
            </span>
            {allMembers.some((m) => m.isCloudUser) && (
              <span className="px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 text-[10px] sm:text-xs font-bold border border-sky-200 flex items-center space-x-1">
                <Cloud className="w-3 h-3 text-sky-500" />
                <span>클라우드 {allMembers.filter((m) => m.isCloudUser).length}명 연동됨</span>
              </span>
            )}
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
            등록된 판매자 목록을 조회하고, 회원별 <strong>클라우드 STT(Deepgram, Soniox) 실시간 사용시간</strong>을 모니터링 및 정지/해제 관리합니다.
          </p>
          <div className="mt-2 text-[10px] sm:text-[11px] text-emerald-700 bg-emerald-50/80 px-2.5 py-1 rounded-xl border border-emerald-100 inline-flex items-center space-x-1.5">
            <Database className="w-3 h-3 text-emerald-600 flex-shrink-0" />
            <span>타 서비스(설교 가이드 등)와 DB를 공유 중이므로, VoiceCAP 전용 데이터만 100% 안전하게 격리·조회됩니다.</span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={async () => {
              const success = await refreshMembers();
              await loadSttSummaries();
              setToastMsg(success ? 'VoiceCAP 클라우드 판매자 및 STT 사용량을 최신으로 동기화했습니다! ☁️' : null);
              setTimeout(() => setToastMsg(null), 3000);
            }}
            disabled={isSyncingMembers || isLoadingStt}
            className={`flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl text-xs font-bold transition shadow-sm ${
              isSyncingMembers || isLoadingStt
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 active:scale-95'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingMembers || isLoadingStt ? 'animate-spin text-brand-500' : 'text-brand-600'}`} />
            <span>{isSyncingMembers || isLoadingStt ? '동기화 중...' : '클라우드 & STT 동기화'}</span>
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {memberSyncError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>클라우드 회원을 불러오지 못했습니다: {memberSyncError}</span>
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
                <th className="py-3 px-4">클라우드 STT 사용시간</th>
                <th className="py-3 px-4">상태</th>
                <th className="py-3 px-4 text-center">STT API 키 지원</th>
                <th className="py-3 px-4 text-right">계정 관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMembers.map((m: User) => {
                const sttSummary = sttSummaryMap[m.id];
                const deepgramSec = sttSummary?.deepgramSeconds || 0;
                const sonioxSec = sttSummary?.sonioxSeconds || 0;
                const totalSec = sttSummary?.totalSeconds || 0;

                return (
                  <tr key={m.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-bold text-slate-900">{m.nickname}</span>
                        {m.isCloudUser && (
                          <span
                            className="inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 text-[9px] font-extrabold border border-sky-200"
                            title="Supabase 클라우드 실시간 연동 판매자"
                          >
                            <Cloud className="w-2.5 h-2.5 text-sky-500" />
                            <span>클라우드</span>
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">{m.email}</div>
                      {m.workspaceName && (
                        <div className="text-[10px] text-slate-400 truncate max-w-[180px] font-medium">
                          작업공간: {m.workspaceName}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-brand-50 text-brand-700 text-[10px] font-bold border border-brand-200 mr-1.5">
                        {m.role}
                      </span>
                      <span className="text-slate-600 font-medium">{m.subscriptionPlan}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono">{m.createdAt}</td>

                    {/* 클라우드 STT 사용시간 컬럼 */}
                    <td className="py-3 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-extrabold text-slate-800 text-[11px]">
                            총 {formatDuration(totalSec)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenSttLogs(m)}
                            className="px-1.5 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] border border-indigo-200 transition"
                            title="STT 사용 상세 내역 보기"
                          >
                            세부 내역
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-[10px]">
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-sky-50 text-sky-700 font-medium border border-sky-100">
                            Deepgram: {formatDuration(deepgramSec)}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-medium border border-emerald-100">
                            Soniox: {formatDuration(sonioxSec)}
                          </span>
                        </div>
                      </div>
                    </td>

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
                    <td className="py-3 px-4 text-center">
                      {m.role === '관리자' ? (
                        <span className="text-[10px] text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                          관리자 기본허용
                        </span>
                      ) : m.allowAdminSttKey ? (
                        <button
                          type="button"
                          onClick={() => handleToggleSttAccess(m)}
                          className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-300 text-[11px] font-bold inline-flex items-center gap-1 transition active:scale-95 shadow-sm"
                          title="클릭 시 STT API 키 지원을 해제합니다"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>허락됨 (키 지원)</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleSttAccess(m)}
                          className="px-2.5 py-1 rounded-xl bg-slate-50 text-slate-500 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-300 border border-slate-200 text-[11px] font-medium inline-flex items-center gap-1 transition active:scale-95"
                          title="클릭 시 관리자 STT API 키 무료 이용을 허락합니다"
                        >
                          <Key className="w-3.5 h-3.5 text-slate-400" />
                          <span>미허락 (클릭시 허락)</span>
                        </button>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* STT 상세 로그 모달 */}
      {selectedMemberForSttLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-indigo-600" />
                  <span>'{selectedMemberForSttLogs.nickname}' 판매자의 클라우드 STT 사용 상세 로그</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{selectedMemberForSttLogs.email}</p>
              </div>
              <button
                onClick={() => setSelectedMemberForSttLogs(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 상단 통계 카드 */}
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                <span className="text-[10px] text-slate-500 font-bold block">총 누적 시간</span>
                <span className="text-sm font-black text-slate-900">
                  {formatDuration(sttSummaryMap[selectedMemberForSttLogs.id]?.totalSeconds || 0)}
                </span>
              </div>
              <div className="p-3 bg-sky-50 border border-sky-100 rounded-2xl">
                <span className="text-[10px] text-sky-600 font-bold block">Deepgram 누적</span>
                <span className="text-sm font-black text-sky-900">
                  {formatDuration(sttSummaryMap[selectedMemberForSttLogs.id]?.deepgramSeconds || 0)}
                </span>
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                <span className="text-[10px] text-emerald-600 font-bold block">Soniox 누적</span>
                <span className="text-sm font-black text-emerald-900">
                  {formatDuration(sttSummaryMap[selectedMemberForSttLogs.id]?.sonioxSeconds || 0)}
                </span>
              </div>
            </div>

            {/* 로그 목록 테이블 */}
            <div className="flex-1 overflow-y-auto border border-slate-100 rounded-2xl">
              {isLoadingLogs ? (
                <div className="py-12 text-center text-xs text-slate-400 flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
                  <span>STT 사용 상세 로그를 불러오는 중입니다...</span>
                </div>
              ) : sttLogs.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-bold">기록된 클라우드 STT 사용 내역이 없습니다.</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    판매자가 Deepgram 또는 Soniox 모드로 라이브 청취를 시작하면 초 단위로 클라우드에 자동 적재됩니다.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 sticky top-0 border-b border-slate-200 text-slate-500 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">일시</th>
                      <th className="py-2.5 px-3">STT 공급자</th>
                      <th className="py-2.5 px-3">세션 ID</th>
                      <th className="py-2.5 px-3 text-right">사용 시간</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sttLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/60 transition">
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                          {new Date(log.createdAt).toLocaleString('ko-KR')}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              log.provider === 'DEEPGRAM'
                                ? 'bg-sky-50 text-sky-700 border-sky-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            {log.provider === 'DEEPGRAM' ? 'Deepgram' : 'Soniox'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-[10px] font-mono text-slate-400 truncate max-w-[140px]">
                          {log.sessionId || '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-slate-900">
                          {formatDuration(log.durationSeconds)}
                          <span className="text-[10px] text-slate-400 font-normal ml-1">
                            ({log.durationSeconds}초)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedMemberForSttLogs(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

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
