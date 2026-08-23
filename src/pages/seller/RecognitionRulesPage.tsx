import React, { useState } from 'react';
import { useAppData, CAPTURE_PRESETS } from '../../context/AppDataContext';
import { RecognitionWordRule, RuleAction, CaptureAreaPreset } from '../../types/rules';
import { Sliders, Plus, Trash2, Shield, Camera, Database, CheckCircle2, AlertCircle } from 'lucide-react';

export const RecognitionRulesPage: React.FC = () => {
  const { rules, addRule, updateRule, deleteRule, toggleRule, captureAreaConfig, setCaptureAreaConfig } = useAppData();

  const [newWord, setNewWord] = useState('');
  const [newAction, setNewAction] = useState<RuleAction>('DB_SAVE');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const handleAddWord = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const res = addRule(newWord, newAction);
    if (!res.success) {
      setErrorMsg(res.message || '단어 추가에 실패했습니다.');
    } else {
      setNewWord('');
      setToastMsg(`'${newWord}' 단어가 인식 규칙 및 Deepgram 키워드 바이어싱에 추가되었습니다.`);
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  const handleDeleteWord = (id: string, word: string) => {
    setErrorMsg(null);
    const res = deleteRule(id);
    if (!res.success) {
      setErrorMsg(res.message || '삭제할 수 없습니다.');
    } else {
      setToastMsg(`'${word}' 단어가 삭제되었습니다.`);
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl">
        <div className="flex items-center space-x-2">
          <h1 className="text-2xl font-black text-white tracking-tight">인식 단어 & 동작 규칙 설정</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 text-xs font-bold border border-brand-500/30">
            키워드 바이어싱
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          방송 중 음성에서 감지할 특정 키워드와, 단어가 나왔을 때 실행할 자동화 동작(DB 적재, 화면 캡처)을 지정합니다.
        </p>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 신규 단어 등록 폼 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center space-x-2">
          <Plus className="w-4 h-4 text-brand-400" />
          <span>새로운 인식 단어 추가</span>
        </h3>

        <form onSubmit={handleAddWord} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-6">
            <input
              type="text"
              required
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder="인식할 단어 입력 (예: 입금확인, 사은품, 특가)"
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
            />
          </div>

          <div className="sm:col-span-4">
            <select
              value={newAction}
              onChange={(e) => setNewAction(e.target.value as RuleAction)}
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-brand-500 transition"
            >
              <option value="DB_SAVE">📦 DB 자동 저장</option>
              <option value="SCREEN_CAPTURE">📸 댓글 화면 캡처</option>
              <option value="DB_SAVE_AND_CAPTURE">⚡ DB 저장 + 화면 캡처 동시</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-500/25 transition"
            >
              추가하기
            </button>
          </div>
        </form>
      </div>

      {/* 등록된 단어 목록 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
          <Sliders className="w-4 h-4 text-tiktok-cyan" />
          <span>현재 활성화된 인식 단어 규칙 ({rules.length}개)</span>
        </h3>

        <div className="space-y-2.5">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`p-4 rounded-2xl border transition flex items-center justify-between gap-4 ${
                rule.isEnabled ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-950/30 border-slate-900 opacity-60'
              }`}
            >
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={rule.isEnabled}
                  onChange={() => toggleRule(rule.id)}
                  className="rounded border-slate-700 bg-slate-900 text-brand-500 w-4 h-4 cursor-pointer"
                />
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-black text-white">{rule.word}</span>
                    {rule.isEssential && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-semibold border border-slate-700 flex items-center space-x-1">
                        <Shield className="w-3 h-3 text-brand-400" />
                        <span>필수 단어</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{rule.description || '사용자 정의 단어'}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                {/* 동작 선택 */}
                <select
                  value={rule.action}
                  onChange={(e) => updateRule({ ...rule, action: e.target.value as RuleAction })}
                  className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none"
                >
                  <option value="DB_SAVE">📦 DB 저장</option>
                  <option value="SCREEN_CAPTURE">📸 화면 캡처</option>
                  <option value="DB_SAVE_AND_CAPTURE">⚡ 저장 + 캡처</option>
                </select>

                {/* 삭제 버튼 (필수 단어는 비활성화) */}
                <button
                  onClick={() => handleDeleteWord(rule.id, rule.word)}
                  disabled={rule.isEssential}
                  title={rule.isEssential ? '필수 단어는 삭제할 수 없습니다.' : '삭제'}
                  className={`p-2 rounded-lg transition ${
                    rule.isEssential
                      ? 'text-slate-600 cursor-not-allowed'
                      : 'text-slate-400 hover:text-rose-400 hover:bg-slate-800'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 화면 캡처 영역 설정 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
          <Camera className="w-4 h-4 text-tiktok-pink" />
          <span>자동 화면 캡처 영역 프리셋 설정</span>
        </h3>
        <p className="text-xs text-slate-400">
          '캡처' 단어가 발화될 때 틱톡 방송 화면에서 자동으로 잘라낼 영역을 선택하세요.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {CAPTURE_PRESETS.map((preset) => {
            const isSelected = captureAreaConfig.preset === preset.preset;

            return (
              <div
                key={preset.preset}
                onClick={() => setCaptureAreaConfig(preset)}
                className={`p-4 rounded-2xl border cursor-pointer transition ${
                  isSelected
                    ? 'bg-brand-500/10 border-brand-500 shadow-lg shadow-brand-500/10'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white">{preset.name}</span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-400" />}
                </div>
                <div className="w-full h-24 bg-slate-950 border border-slate-800 rounded-xl relative overflow-hidden flex items-center justify-center text-[10px] text-slate-400">
                  {preset.preset === 'COMMENTS' && (
                    <div className="absolute bottom-2 right-2 w-3/4 h-12 bg-tiktok-cyan/20 border border-tiktok-cyan/50 rounded flex items-center justify-center text-tiktok-cyan font-bold">
                      댓글창 영역 크롭
                    </div>
                  )}
                  {preset.preset === 'ORDERS' && (
                    <div className="absolute top-4 left-4 right-4 h-12 bg-amber-500/20 border border-amber-500/50 rounded flex items-center justify-center text-amber-300 font-bold">
                      주문창 영역 크롭
                    </div>
                  )}
                  {preset.preset === 'FULL_SCREEN' && (
                    <div className="absolute inset-2 bg-purple-500/20 border border-purple-500/50 rounded flex items-center justify-center text-purple-300 font-bold">
                      전체 화면 캡처
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
