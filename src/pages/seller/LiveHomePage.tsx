import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLive } from '../../context/LiveContext';
import { useSales } from '../../context/SalesContext';
import { AudioVisualizer } from '../../components/common/AudioVisualizer';
import {
  Radio,
  Square,
  Play,
  Volume2,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Sliders,
  HelpCircle,
  Clock,
  ArrowRight,
  RefreshCw,
  Edit3
} from 'lucide-react';

export const LiveHomePage: React.FC = () => {
  const {
    isListening,
    currentSessionId,
    audioLevel,
    waveform,
    currentInterimTranscript,
    transcriptLogs,
    recentCaptures,
    isVoiceEditing,
    editingFieldInfo,
    startListening,
    stopListening,
    injectTestMent,
    captureCurrentScreen
  } = useLive();

  const { sales } = useSales();
  const [selectedCaptureModal, setSelectedCaptureModal] = useState<string | null>(null);
  const [testInputText, setTestInputText] = useState('');

  // 현재 세션의 판매 내역 필터링
  const currentSessionSales = sales.filter((s) => s.sessionId === currentSessionId);
  const todayTotalAmount = currentSessionSales
    .filter((s) => s.status !== '보류')
    .reduce((sum, item) => sum + item.amount, 0);

  const handleToggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening('MIC');
    }
  };

  const handleQuickInject = (text: string) => {
    injectTestMent(text);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* 상단 헤더 & 제어 바 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl">
        <div className="flex items-center space-x-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all ${
            isListening
              ? 'bg-rose-500 text-white shadow-rose-500/30 animate-pulse'
              : 'bg-slate-800 text-slate-400'
          }`}>
            <Radio className={`w-8 h-8 ${isListening ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-2xl font-black text-white tracking-tight">라이브 청취 홈</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                isListening ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-400'
              }`}>
                {isListening ? 'ON AIR' : '대기 중'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center space-x-2">
              <span>현재 방송 회차: <strong className="text-slate-200 font-mono">{currentSessionId}</strong></span>
              <span>•</span>
              <span>Deepgram Nova-3 실시간 엔진</span>
            </p>
          </div>
        </div>

        {/* 시작/중지 버튼 & 수동 캡처 버튼 */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => captureCurrentScreen()}
            disabled={!isListening}
            className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-bold border border-slate-700 flex items-center space-x-2 transition"
          >
            <Camera className="w-4 h-4 text-tiktok-cyan" />
            <span>화면 즉시 캡처</span>
          </button>

          <button
            onClick={handleToggleListening}
            className={`px-6 py-3 rounded-xl font-black text-sm shadow-xl flex items-center space-x-2 transition transform hover:-translate-y-0.5 ${
              isListening
                ? 'bg-slate-800 hover:bg-slate-700 text-rose-400 border border-rose-500/40 shadow-rose-500/10'
                : 'bg-gradient-to-r from-brand-600 via-brand-500 to-tiktok-pink text-white shadow-brand-500/30'
            }`}
          >
            {isListening ? (
              <>
                <Square className="w-4 h-4 fill-current" />
                <span>청취 중지하기</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>라이브 청취 시작</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 음성 수정 명령 활성 알림 배너 */}
      {isVoiceEditing && (
        <div className="p-4 rounded-2xl bg-amber-500/20 border-2 border-amber-500 text-amber-200 text-xs font-bold flex items-center justify-between animate-pulse">
          <div className="flex items-center space-x-3">
            <Edit3 className="w-5 h-5 text-amber-400" />
            <div>
              <span className="text-sm font-black">🎙️ 방송 중 음성 수정 모드 작동 중!</span>
              <p className="text-xs text-amber-300 font-normal mt-0.5">{editingFieldInfo}</p>
            </div>
          </div>
          <span className="text-[11px] bg-amber-400 text-slate-950 px-2 py-1 rounded font-black">
            "수정 완료"를 말씀하세요
          </span>
        </div>
      )}

      {/* 메인 2열 그리드: 좌측 실시간 파형 & 자막 로그 / 우측 자동 저장된 판매 내역 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측 영역 (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* 오디오 파형 & 실시간 자막 박스 */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Volume2 className="w-4 h-4 text-brand-400" />
                <span>실시간 오디오 스트림 & 파형 분석</span>
              </h3>
              <div className="text-xs text-slate-400 font-mono">
                입력 볼륨: <span className="text-tiktok-cyan font-bold">{audioLevel}%</span>
              </div>
            </div>

            <AudioVisualizer waveform={waveform} audioLevel={audioLevel} isActive={isListening} />

            {/* 실시간 전사 자막 */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 min-h-[90px] flex flex-col justify-center">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center">
                <span className={`w-2 h-2 rounded-full mr-1.5 ${isListening ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`}></span>
                실시간 STT 변환 자막
              </div>
              <p className="text-sm text-slate-200 font-medium">
                {currentInterimTranscript ? (
                  <span className="text-brand-300 animate-pulse font-semibold">{currentInterimTranscript}</span>
                ) : isListening ? (
                  <span className="text-slate-400 text-xs italic">판매 멘트를 듣고 있습니다... ("구매확정, 닉네임, 금액")</span>
                ) : (
                  <span className="text-slate-400 text-xs">상단의 [라이브 청취 시작] 버튼을 눌러 청취를 시작하세요.</span>
                )}
              </p>
            </div>
          </div>

          {/* 최근 실시간 전사 로그 목록 */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Clock className="w-4 h-4 text-tiktok-cyan" />
                <span>최근 실시간 전사 로그 ({transcriptLogs.length}건)</span>
              </h3>
              <span className="text-[11px] text-slate-400">자동 스크롤</span>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {transcriptLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  아직 전사된 발화 로그가 없습니다.
                </div>
              ) : (
                transcriptLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-3 rounded-xl border text-xs transition ${
                      log.actionTriggered === 'SALE_SAVED'
                        ? 'bg-brand-500/10 border-brand-500/30 text-brand-200'
                        : log.actionTriggered === 'SCREEN_CAPTURED'
                        ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200'
                        : log.actionTriggered === 'VOICE_EDIT_START' || log.actionTriggered === 'VOICE_EDIT_DONE'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-slate-400 font-mono">{log.timestamp}</span>
                      {log.actionTriggered === 'SALE_SAVED' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300">
                          🛍️ 판매 자동 저장됨
                        </span>
                      )}
                      {log.actionTriggered === 'SCREEN_CAPTURED' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-tiktok-cyan">
                          📸 댓글창 캡처됨
                        </span>
                      )}
                      {log.actionTriggered === 'VOICE_EDIT_START' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                          ✏️ 수정 모드 진입
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-slate-100">{log.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 테스트 멘트 주입 툴바 (편의성 도구) */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 text-xs">
            <p className="font-bold text-slate-300 mb-2 flex items-center">
              <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
              <span>빠른 시연 & 테스트 멘트 주입 버튼</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleQuickInject('구매확정 됐습니다! 구매하신 분은 러블리님 이시구요 금액은 3만5천원입니다.')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px]"
              >
                + "러블리님 35,000원"
              </button>
              <button
                onClick={() => handleQuickInject('구매확정! 닉네임 민트초코님 가격 19,900원입니다. 댓글 캡처 부탁드려요.')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px]"
              >
                + "민트초코 19,900원 + 캡처"
              </button>
              <button
                onClick={() => handleQuickInject('수정 시작')}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px]"
              >
                + "수정 시작"
              </button>
              <button
                onClick={() => handleQuickInject('닉네임은 달콤한하루님, 금액은 48,000원')}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px]"
              >
                + "닉네임/금액 수정"
              </button>
              <button
                onClick={() => handleQuickInject('수정 완료')}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px]"
              >
                + "수정 완료"
              </button>
            </div>
          </div>
        </div>

        {/* 우측 영역 (5 cols): 이번 방송 회차 저장된 판매 내역 & 캡처 갤러리 */}
        <div className="lg:col-span-5 space-y-6">
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 font-medium">이번 회차 판매</span>
              <div className="text-2xl font-black text-white mt-1">
                {currentSessionSales.length} <span className="text-xs font-normal text-slate-400">건</span>
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 font-medium">실시간 합계</span>
              <div className="text-2xl font-black text-brand-400 mt-1">
                {todayTotalAmount.toLocaleString()} <span className="text-xs font-normal text-slate-400">원</span>
              </div>
            </div>
          </div>

          {/* 최근 판매 내역 카드 리스트 */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>자동 적재된 판매 내역</span>
              </h3>
              <Link to="/sales/review" className="text-xs text-brand-400 hover:text-brand-300 font-semibold flex items-center">
                <span>일괄 검토</span>
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </div>

            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {currentSessionSales.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-2xl">
                  이번 방송 회차에서 저장된 판매 내역이 없습니다.<br />
                  "구매확정" 멘트를 말씀하시면 자동 등록됩니다.
                </div>
              ) : (
                currentSessionSales.map((sale) => (
                  <Link
                    key={sale.id}
                    to={`/sales/${sale.id}`}
                    className={`block p-4 rounded-2xl border transition hover:scale-[1.01] ${
                      sale.status === '보류'
                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
                        : sale.status === '수동수정'
                        ? 'bg-purple-500/10 border-purple-500/30 text-slate-100'
                        : 'bg-slate-950 border-slate-800 text-slate-100'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-sm text-white">{sale.buyerNickname}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                            sale.status === '보류'
                              ? 'bg-amber-400 text-slate-950'
                              : sale.status === '수동수정'
                              ? 'bg-purple-500/30 text-purple-300'
                              : 'bg-emerald-500/20 text-emerald-300'
                          }`}>
                            {sale.status}
                          </span>
                        </div>
                        <div className="text-base font-black text-brand-400 mt-1">
                          {sale.amount > 0 ? `${sale.amount.toLocaleString()}원` : '금액 미확인'}
                        </div>
                      </div>

                      {sale.captureImageUrls && sale.captureImageUrls.length > 0 && (
                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-700 flex-shrink-0">
                          <img src={sale.captureImageUrls[0]} alt="캡처" className="w-full h-full object-cover" />
                        </div>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 mt-2 truncate">
                      "{sale.rawTranscript}"
                    </p>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* 최근 캡처 이미지 스트립 */}
          {recentCaptures.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center space-x-2">
                <Camera className="w-4 h-4 text-tiktok-cyan" />
                <span>최근 화면 캡처 썸네일 ({recentCaptures.length}장)</span>
              </h3>
              <div className="flex space-x-3 overflow-x-auto pb-2">
                {recentCaptures.map((cap) => (
                  <div
                    key={cap.id}
                    onClick={() => setSelectedCaptureModal(cap.imageUrl)}
                    className="w-20 h-28 flex-shrink-0 rounded-xl overflow-hidden border border-slate-700 bg-slate-950 cursor-pointer hover:opacity-80 transition relative group"
                  >
                    <img src={cap.imageUrl} alt="캡처" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-bold transition">
                      확대
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 캡처 확대 팝업 모달 */}
      {selectedCaptureModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setSelectedCaptureModal(null)}
        >
          <div className="max-w-md w-full bg-slate-900 p-4 rounded-3xl border border-slate-800">
            <img src={selectedCaptureModal} alt="확대 캡처" className="w-full rounded-2xl" />
            <button
              onClick={() => setSelectedCaptureModal(null)}
              className="mt-4 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
