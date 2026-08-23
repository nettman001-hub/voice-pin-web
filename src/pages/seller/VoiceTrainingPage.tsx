import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { Mic, CheckCircle2, RotateCcw, Sparkles, Volume2, Award, Play } from 'lucide-react';

export const VoiceTrainingPage: React.FC = () => {
  const { trainingSentences, recordTrainingSentence, trainVoiceModel, completedTrainingCount } = useAppData();

  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeSentence = trainingSentences.find((s) => s.id === activeSentenceId);
  const totalSentences = trainingSentences.length;
  const progressPercent = Math.round((completedTrainingCount / totalSentences) * 100);

  const startCountdownAndRecord = (sentenceId: string) => {
    setActiveSentenceId(sentenceId);
    setCountdown(3);

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          startRecordingActual(sentenceId);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startRecordingActual = (sentenceId: string) => {
    setIsRecording(true);
    // 모의 2.5초 녹음 후 서버 업로드 완료
    setTimeout(() => {
      setIsRecording(false);
      trainVoiceModel(sentenceId);
      setToastMessage('음성 녹음이 완료되어 AI 모델 학습 데이터에 추가되었습니다! ✨');
      setTimeout(() => setToastMessage(null), 3000);
    }, 2500);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">판매자 음성 학습 & 훈련</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 text-xs font-bold border border-brand-500/30">
              인식률 극대화
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            자주 쓰는 판매 멘트를 3회 이상 녹음하면 판매자님의 억양과 발음에 특화된 AI 모델이 완성됩니다.
          </p>
        </div>

        {/* 훈련 완료 게이지 */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex items-center space-x-4 min-w-[220px]">
          <div className="w-12 h-12 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center font-black text-base">
            {progressPercent}%
          </div>
          <div>
            <div className="text-xs font-bold text-slate-200">
              학습 완료: {completedTrainingCount} / {totalSentences}문장
            </div>
            <div className="w-28 h-2 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-500 to-tiktok-cyan rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      {/* 안내 토스트 */}
      {toastMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 카운트다운 / 녹음 진행 모달 */}
      {countdown !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl max-w-md w-full text-center space-y-6 animate-in zoom-in-95">
            <span className="text-xs font-bold text-brand-400 uppercase tracking-widest">
              녹음 준비 카운트다운
            </span>
            <div className="text-7xl font-black text-white font-mono animate-bounce">
              {countdown}
            </div>
            <p className="text-sm font-bold text-slate-200">
              "{activeSentence?.sentence}"
            </p>
            <p className="text-xs text-slate-400">카운트다운 후 문장을 또박또박 읽어주세요.</p>
          </div>
        </div>
      )}

      {isRecording && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-rose-500/50 p-8 rounded-3xl max-w-md w-full text-center space-y-6 shadow-2xl shadow-rose-500/20">
            <div className="w-20 h-20 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto animate-pulse">
              <Mic className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-black text-white">🎙️ 음성을 녹음하고 있습니다...</h3>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <p className="text-base font-bold text-brand-300">
                "{activeSentence?.sentence}"
              </p>
            </div>
            <p className="text-xs text-slate-400">자연스러운 목소리로 위 문장을 읽어주세요.</p>
          </div>
        </div>
      )}

      {/* 문장 목록 리스트 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-brand-400" />
          <span>등록된 필수 판매 멘트 학습 목록</span>
        </h3>

        <div className="space-y-3">
          {trainingSentences.map((item, idx) => (
            <div
              key={item.id}
              className={`p-4 rounded-2xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                item.isCompleted
                  ? 'bg-slate-950/80 border-emerald-500/30'
                  : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start space-x-3.5">
                <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-bold text-white">"{item.sentence}"</span>
                    {item.isCompleted ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30 flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>훈련 완료 (3회)</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                        {item.recordCount}/3회 녹음됨
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-3 mt-1.5 text-xs text-slate-400">
                    <span>분류: <strong className="text-slate-300">{item.category}</strong></span>
                    <span>•</span>
                    <span>예상 인식률: <strong className="text-tiktok-cyan font-bold">{item.expectedAccuracy}%</strong></span>
                    {item.lastTrainedAt && (
                      <>
                        <span>•</span>
                        <span>최근 훈련: {item.lastTrainedAt}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 훈련 버튼 */}
              <button
                onClick={() => startCountdownAndRecord(item.id)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition flex-shrink-0 ${
                  item.isCompleted
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                    : 'bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 text-white shadow-md shadow-brand-500/25'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{item.isCompleted ? '재훈련하기' : '반복 훈련 (녹음)'}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
