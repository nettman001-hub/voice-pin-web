import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useSales } from '../../context/SalesContext';
import { useLive } from '../../context/LiveContext';
import { User } from '../../types/auth';
import { ReportItem } from '../../types/admin';
import {
  Users,
  AlertTriangle,
  Radio,
  CreditCard,
  ArrowRight,
  TrendingUp,
  Activity,
  Server,
  KeyRound,
  CheckCircle2,
  Save,
  Lock,
  Sparkles
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const { allMembers, reports } = useAppData();
  const { sales } = useSales();
  const {
    deepgramApiKey,
    setDeepgramApiKey,
    sonioxApiKey,
    setSonioxApiKey,
    sttProvider,
    setSttProvider
  } = useLive();

  const [inputKey, setInputKey] = useState(deepgramApiKey);
  const [sonioxInputKey, setSonioxInputKey] = useState(sonioxApiKey);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showSonioxKey, setShowSonioxKey] = useState(false);

  useEffect(() => setInputKey(deepgramApiKey), [deepgramApiKey]);
  useEffect(() => setSonioxInputKey(sonioxApiKey), [sonioxApiKey]);

  const totalMembers = allMembers.length;
  const activeMembers = allMembers.filter((m: User) => m.status === '활성').length;
  const pendingReports = reports.filter((r: ReportItem) => r.status === '접수').length;
  const totalRevenue = sales.filter((s) => s.status !== '보류').reduce((sum, s) => sum + s.amount, 0);
  const sellerMembers = allMembers.filter((m: User) => m.role === '판매자');
  const allowedSellersCount = sellerMembers.filter((m: User) => m.allowAdminSttKey).length;

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDeepgramApiKey(inputKey.trim());
      setToastMsg('Deepgram Nova-3 API Key가 클라우드에 저장되어 허락된 모든 판매자에게 적용됩니다. 🎉');
    } catch (error) {
      setToastMsg(error instanceof Error ? error.message : 'Deepgram API Key 저장에 실패했습니다.');
    }
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleSaveSonioxApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setSonioxApiKey(sonioxInputKey.trim());
      setToastMsg('Soniox API Key가 클라우드에 저장되어 허락된 모든 판매자에게 적용됩니다.');
    } catch (error) {
      setToastMsg(error instanceof Error ? error.message : 'Soniox API Key 저장에 실패했습니다.');
    }
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleSelectSttProvider = async (provider: 'DEEPGRAM' | 'SONIOX') => {
    try {
      await setSttProvider(provider);
    } catch (error) {
      setToastMsg(error instanceof Error ? error.message : '기본 STT 서비스 저장에 실패했습니다.');
      setTimeout(() => setToastMsg(null), 3500);
      return;
    }
    const providerName = provider === 'SONIOX' ? 'Soniox v5' : 'Deepgram Nova-3';
    setToastMsg(`${providerName}가 기본 STT 서비스로 선택되었습니다.`);
    setTimeout(() => setToastMsg(null), 3500);
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">관리자 통합 대시보드</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-[10px] sm:text-xs font-bold border border-purple-200">
              전체 시스템 관제
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
            VoiceCAP 서비스의 핵심 KPI 지표, 회원 현황, STT 클라우드 API Key 및 신고 처리 상태를 중앙 관제합니다.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span>기본 STT: {sttProvider === 'SONIOX' ? 'Soniox v5' : 'Deepgram Nova-3'}</span>
          </span>
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 관리자 전용 기본 STT 공급자 선택 및 Soniox API Key 관리 */}
      <div className="bg-gradient-to-br from-white via-cyan-50/20 to-sky-50/40 border-2 border-cyan-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-600 text-white flex items-center justify-center shadow-md shadow-cyan-500/20 flex-shrink-0">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">기본 STT 서비스 선택</h3>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                관리자가 선택한 서비스가 이후 시작되는 모든 라이브 음성인식 세션에 적용됩니다.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-cyan-100 text-cyan-800">
            현재: {sttProvider === 'SONIOX' ? 'Soniox v5' : 'Deepgram Nova-3'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="기본 STT 서비스">
          <button
            type="button"
            role="radio"
            aria-checked={sttProvider === 'DEEPGRAM'}
            onClick={() => handleSelectSttProvider('DEEPGRAM')}
            className={`p-4 rounded-2xl border-2 text-left transition active:scale-[0.99] ${
              sttProvider === 'DEEPGRAM'
                ? 'border-brand-500 bg-brand-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-brand-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-black text-slate-900">Deepgram Nova-3</span>
              <span className={`w-4 h-4 rounded-full border-4 ${sttProvider === 'DEEPGRAM' ? 'border-brand-600 bg-white' : 'border-slate-300'}`} />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">기존 한국어 실시간 STT · 키워드 바이어싱</p>
            <p className={`mt-2 text-[10px] font-bold ${deepgramApiKey ? 'text-emerald-700' : 'text-amber-700'}`}>
              {deepgramApiKey ? 'API Key 등록됨' : 'API Key 미등록'}
            </p>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={sttProvider === 'SONIOX'}
            onClick={() => handleSelectSttProvider('SONIOX')}
            className={`p-4 rounded-2xl border-2 text-left transition active:scale-[0.99] ${
              sttProvider === 'SONIOX'
                ? 'border-cyan-500 bg-cyan-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-cyan-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-black text-slate-900">Soniox STT v5</span>
              <span className={`w-4 h-4 rounded-full border-4 ${sttProvider === 'SONIOX' ? 'border-cyan-600 bg-white' : 'border-slate-300'}`} />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">한국어 단일 언어 제한 · 자동 엔드포인트/화자 분할 사용 안 함</p>
            <p className={`mt-2 text-[10px] font-bold ${sonioxApiKey ? 'text-emerald-700' : 'text-amber-700'}`}>
              {sonioxApiKey ? 'API Key 등록됨' : 'API Key 미등록'}
            </p>
          </button>
        </div>

        {/* 💻 오프라인 무료 로컬 STT (내 PC Whisper) 안내 */}
        <div className="p-3.5 rounded-2xl bg-white/80 border border-cyan-200/60 text-xs text-slate-600 flex items-start space-x-2.5">
          <span className="text-base">💻</span>
          <div className="space-y-0.5">
            <span className="font-black text-slate-800">무료 오프라인 STT 안내</span>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              판매자는 라이브 청취 홈에서 <span className="font-bold text-brand-700">[내 PC 무료 STT]</span>를 선택하여 클라우드 API 사용료 없이 사용자 PC의 faster-whisper 모델로 직접 음성인식을 실행할 수 있습니다. 위 클라우드 기본 설정은 [클라우드 STT] 모드를 사용하는 판매자에게 적용됩니다.
            </p>
          </div>
        </div>

        {/* 🔑 허락된 판매자 STT API 키 자동 지원 현황 */}
        <div className="p-4 rounded-2xl bg-white border border-cyan-200 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-100 text-cyan-800 flex items-center justify-center font-bold flex-shrink-0">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-1">
                <span className="font-bold text-slate-800">허락된 판매자 STT API 키 자동 지원</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black border border-emerald-200">
                  {allowedSellersCount}명 허락됨 / 총 {sellerMembers.length}명
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                여기서 등록한 API 키는 관리자가 허락한 판매자가 로그인 시 키 입력 없이 자동으로 연동됩니다.
              </p>
            </div>
          </div>
          <Link
            to="/admin/members"
            className="px-3 py-1.5 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200 text-xs font-bold flex items-center space-x-1 whitespace-nowrap self-stretch sm:self-auto justify-center transition"
          >
            <span>판매자별 권한 관리</span>
            <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
          </Link>
        </div>

        {/* 🔑 Deepgram Nova-3 클라우드 STT API Key 중앙 관리 카드 (관리자 전용) */}
        <div className="bg-gradient-to-br from-white via-brand-50/20 to-purple-50/30 border-2 border-brand-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-md shadow-brand-500/20 flex-shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2 flex-wrap gap-1">
                  <h3 className="text-sm sm:text-base font-black text-slate-900">Deepgram Nova-3 음성인식 API Key 관리</h3>
                  <span className={`text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    deepgramApiKey ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {deepgramApiKey ? '✅ API Key 등록됨' : '⚠️ API Key 미등록'}
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                  여기서 등록한 API Key는 모든 판매자의 라이브 방송 음성인식(Nova-3 한국어)에 자동으로 공통 적용됩니다.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveApiKey} className="pt-2">
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch">
              <div className="relative flex-1">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type={showKey ? 'text' : 'password'}
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="Deepgram Nova-3 API Key (예: 8f3a9b2c...)"
                  className="w-full pl-10 pr-24 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-2.5 text-[11px] font-bold text-slate-400 hover:text-slate-700"
                >
                  {showKey ? '숨기기' : '보기'}
                </button>
              </div>

              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 flex items-center justify-center space-x-1.5 transition active:scale-95"
              >
                <Save className="w-4 h-4" />
                <span>API Key 저장 & 전체 적용</span>
              </button>
            </div>
          </form>
        </div>

        <div className="bg-gradient-to-br from-white via-cyan-50/20 to-sky-50/30 border-2 border-cyan-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-cyan-600 text-white flex items-center justify-center shadow-md shadow-cyan-500/20 flex-shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2 flex-wrap gap-1">
                  <h3 className="text-sm sm:text-base font-black text-slate-900">Soniox 음성인식 API Key 관리</h3>
                  <span className={`text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    sonioxApiKey ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {sonioxApiKey ? '✅ API Key 등록됨' : '⚠️ API Key 미등록'}
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                  stt-rt-v5 · 한국어(ko) 엄격 제한 · 자동 엔드포인트/화자 분할 비활성
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveSonioxApiKey} className="pt-2">
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch">
              <div className="relative flex-1">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type={showSonioxKey ? 'text' : 'password'}
                  value={sonioxInputKey}
                  onChange={(e) => setSonioxInputKey(e.target.value)}
                  placeholder="Soniox API Key"
                  autoComplete="off"
                  className="w-full pl-10 pr-24 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-cyan-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSonioxKey(!showSonioxKey)}
                  className="absolute right-3 top-2.5 text-[11px] font-bold text-slate-400 hover:text-slate-700"
                >
                  {showSonioxKey ? '숨기기' : '보기'}
                </button>
              </div>

              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md shadow-cyan-500/20 flex items-center justify-center space-x-1.5 transition active:scale-95"
              >
                <Save className="w-4 h-4" />
                <span>API Key 저장 & 전체 적용</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 4대 KPI 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <Link
          to="/admin/members"
          className="p-3.5 sm:p-5 rounded-3xl bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition block group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] sm:text-xs font-medium">전체 회원 수</span>
            <Users className="w-4 h-4 text-brand-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 mt-1 sm:mt-2 truncate">
            {totalMembers} <span className="text-xs font-normal text-slate-400">명</span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-emerald-600 mt-1 sm:mt-2 flex items-center font-semibold truncate">
            <span>활성: {activeMembers}명</span>
          </div>
        </Link>

        <Link
          to="/admin/reports"
          className="p-3.5 sm:p-5 rounded-3xl bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition block group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] sm:text-xs font-medium">신규 접수 신고</span>
            <AlertTriangle className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-lg sm:text-2xl font-black text-amber-600 mt-1 sm:mt-2 truncate">
            {pendingReports} <span className="text-xs font-normal text-slate-400">건</span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-400 mt-1 sm:mt-2 truncate">
            <span>처리기한 준수</span>
          </div>
        </Link>

        <Link
          to="/sales"
          className="p-3.5 sm:p-5 rounded-3xl bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition block group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] sm:text-xs font-medium">총 누적 거래액</span>
            <CreditCard className="w-4 h-4 text-brand-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 mt-1 sm:mt-2 truncate">
            {totalRevenue.toLocaleString()} <span className="text-xs font-normal text-slate-400">원</span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-brand-600 mt-1 sm:mt-2 truncate font-semibold">
            <span>실시간 정산 연동</span>
          </div>
        </Link>

        <Link
          to="/admin/stats"
          className="p-3.5 sm:p-5 rounded-3xl bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition block group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] sm:text-xs font-medium">STT 인식 성공률</span>
            <Activity className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-lg sm:text-2xl font-black text-emerald-600 mt-1 sm:mt-2 truncate">
            99.2 <span className="text-xs font-normal text-slate-400">%</span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-emerald-600 mt-1 sm:mt-2 truncate font-semibold">
            <span>{sttProvider === 'SONIOX' ? 'Soniox v5 실시간' : 'Nova-3 180ms'}</span>
          </div>
        </Link>
      </div>

      {/* 최근 신고 및 주요 관리자 숏컷 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>최근 접수된 사용자 신고 목록</span>
            </h3>
            <Link to="/admin/reports" className="text-xs text-brand-600 hover:underline font-bold flex items-center">
              <span>전체 보기</span>
              <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </div>

          <div className="space-y-3">
            {reports.slice(0, 3).map((r: ReportItem) => (
              <div
                key={r.id}
                className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900">{r.memberNickname}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      r.status === '접수' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'
                    }`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="text-slate-500 mt-0.5">{r.reason}</p>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">{r.createdAt}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Server className="w-4 h-4 text-brand-600" />
            <span>빠른 관리 메뉴</span>
          </h3>

          <div className="space-y-2">
            <Link
              to="/admin/members"
              className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-xs font-bold text-slate-800 transition block"
            >
              <span>👥 회원 관리 및 부정 사용자 정지</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </Link>
            <Link
              to="/admin/reports"
              className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-xs font-bold text-slate-800 transition block"
            >
              <span>🚨 신고 처리 센터 및 소명 관리</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </Link>
            <Link
              to="/admin/stats"
              className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-xs font-bold text-slate-800 transition block"
            >
              <span>📊 상세 통계 및 시스템 에러 로그</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
