import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { Mic, CheckCircle2, RotateCcw, Sparkles } from 'lucide-react';

export const VoiceTrainingPage: React.FC = () => {
  const { trainingSentences, trainVoiceModel, completedTrainingCount } = useAppData();

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
    setTimeout(() => {
      setIsRecording(false);
      trainVoiceModel(sentenceId);
      setToastMessage('음성 녹음이 완료되어 AI 모델 학습 데이터에 추가되었습니다! ✨');
      setTimeout(() => setToastMessage(null), 3000);
    }, 2500);
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">판매자 음성 학습 & 훈련</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] sm:text-xs font-bold border border-brand-200">
              인식률 극대화
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
            자주 쓰는 판매 멘트를 3회 이상 녹음하면 판매자님의 억양과 발음에 특화된 AI 모델이 완성됩니다.
          </p>
        </div>

        {/* 훈련 완료 게이지 */}
        <div className="w-full md:w-auto bg-slate-50 p-3.5 sm:p-4 rounded-2xl border border-slate-200 flex items-center space-x-4 min-w-full sm:min-w-[220px]">
          <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center font-black text-base flex-shrink-0">
            {progressPercent}%
          </div>
          <div className="flex-1">
            <div className="text-xs font-bold text-slate-800">
              학습 완료: {completedTrainingCount} / {totalSentences}문장
            </div>
            <div className="w-full sm:w-28 h-2 bg-slate-200 rounded-full mt-1.5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-600 to-rose-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      {toastMessage && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 카운트다운 모달 */}
      {countdown !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-white border border-slate-200 p-6 sm:p-8 rounded-3xl max-w-md w-full text-center space-y-4 sm:space-y-6 shadow-2xl animate-in zoom-in-95">
            <span className="text-xs font-bold text-brand-600 uppercase tracking-widest">
              녹음 준비 카운트다운
            </span>
            <div className="text-6xl sm:text-7xl font-black text-slate-900 font-mono animate-bounce">
              {countdown}
            </div>
            <p className="text-xs sm:text-sm font-bold text-slate-800">
              "{activeSentence?.sentence}"
            </p>
            <p className="text-[11px] sm:text-xs text-slate-500">카운트다운 후 문장을 또박또박 읽어주세요.</p>
          </div>
        </div>
      )}

      {isRecording && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-white border border-rose-200 p-6 sm:p-8 rounded-3xl max-w-md w-full text-center space-y-4 sm:space-y-6 shadow-2xl">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto animate-pulse">
              <Mic className="w-8 h-8 sm:w-10 sm:h-10" />
            </div>
            <h3 className="text-lg sm:text-xl font-black text-slate-900">🎙️ 음성을 녹음하고 있습니다...</h3>
            <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <p className="text-sm sm:text-base font-bold text-brand-700">
                "{activeSentence?.sentence}"
              </p>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500">자연스러운 목소리로 위 문장을 읽어주세요.</p>
          </div>
        </div>
      )}

      {/* 문장 목록 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3 sm:space-y-4">
        <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-brand-600" />
          <span>등록된 필수 판매 멘트 학습 목록</span>
        </h3>

        <div className="space-y-3">
          {trainingSentences.map((item, idx) => (
            <div
              key={item.id}
              className={`p-3.5 sm:p-4 rounded-2xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 ${
                item.isCompleted
                  ? 'bg-emerald-50/40 border-emerald-200'
                  : 'bg-slate-50/60 border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start space-x-3 w-full sm:w-auto">
                <span className="w-6 h-6 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 flex-wrap gap-1">
                    <span className="text-xs sm:text-sm font-bold text-slate-900">"{item.sentence}"</span>
                    {item.isCompleted ? (
                      <span className="px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 text-[9px] sm:text-[10px] font-bold border border-emerald-300 flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>훈련 완료 (3회)</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.2 rounded-full bg-amber-100 text-amber-800 text-[9px] sm:text-[10px] font-bold">
                        {item.recordCount}/3회 녹음됨
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 sm:space-x-3 mt-1.5 text-[11px] sm:text-xs text-slate-500 flex-wrap gap-1">
                    <span>분류: <strong className="text-slate-700">{item.category}</strong></span>
                    <span>•</span>
                    <span>예상 인식률: <strong className="text-brand-600 font-bold">{item.expectedAccuracy}%</strong></span>
                    {item.lastTrainedAt && (
                      <>
                        <span>•</span>
                        <span>최근 훈련: {item.lastTrainedAt}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={() => startCountdownAndRecord(item.id)}
                className={`w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition flex-shrink-0 active:scale-95 ${
                  item.isCompleted
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                    : 'bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-500/20'
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
