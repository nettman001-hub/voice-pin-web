import React, { useEffect, useState } from 'react';
import { BookOpenText, CheckCircle2, Cloud, Info, Plus, Save, Trash2 } from 'lucide-react';
import { useSttVocabulary } from '../../context/SttVocabularyContext';
import { MAX_STT_VOCABULARY_WORDS, MAX_STT_VOCABULARY_WORD_LENGTH, normalizeSttVocabulary } from '../../services/sttVocabularyService';

type Feedback = { tone: 'success' | 'warning'; message: string };

export const SttVocabularyPage: React.FC = () => {
  const { words, saveWords, isLoading, saveError } = useSttVocabulary();
  const [draftWords, setDraftWords] = useState<string[]>(words);
  const [input, setInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    setDraftWords(words);
  }, [words]);

  const isDirty = JSON.stringify(draftWords) !== JSON.stringify(words);

  const addWords = () => {
    const entries = input.split(/[,，、\n\r]+/).map((value) => value.trim()).filter(Boolean);
    if (entries.length === 0) {
      setFeedback({ tone: 'warning', message: '추가할 단어 또는 짧은 구절을 입력해 주세요.' });
      return;
    }

    const tooLong = entries.filter((value) => [...value].length > MAX_STT_VOCABULARY_WORD_LENGTH).length;
    const validEntries = entries.filter((value) => [...value].length <= MAX_STT_VOCABULARY_WORD_LENGTH);
    const nextWords = normalizeSttVocabulary([...draftWords, ...validEntries]);
    const added = nextWords.length - draftWords.length;
    const reachedLimit = new Set([...draftWords, ...validEntries].map((value) => value.toLocaleLowerCase())).size > MAX_STT_VOCABULARY_WORDS;

    setDraftWords(nextWords);
    setInput('');
    const notes = [`${Math.max(added, 0)}개 추가했습니다.`];
    if (tooLong > 0) notes.push(`${MAX_STT_VOCABULARY_WORD_LENGTH}자 초과 ${tooLong}개는 제외했습니다.`);
    if (reachedLimit) notes.push(`최대 ${MAX_STT_VOCABULARY_WORDS}개를 넘는 항목은 제외했습니다.`);
    if (added === 0 && tooLong === 0 && !reachedLimit) notes.push('이미 등록된 단어는 중복 추가되지 않습니다.');
    setFeedback({ tone: tooLong > 0 || reachedLimit || added === 0 ? 'warning' : 'success', message: notes.join(' ') });
  };

  const removeWord = (index: number) => {
    setDraftWords((current) => current.filter((_, wordIndex) => wordIndex !== index));
    setFeedback(null);
  };

  const handleSave = async () => {
    if (isSaving || isLoading) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      await saveWords(normalizeSttVocabulary(draftWords));
      setFeedback({ tone: 'success', message: '발음 힌트를 저장했습니다. 다음 클라우드 STT 연결부터 적용됩니다.' });
    } catch (error) {
      setFeedback({
        tone: 'warning',
        message: error instanceof Error ? error.message : '발음 힌트를 저장하지 못했습니다. 다시 시도해 주세요.'
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3.5 sm:p-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <BookOpenText className="h-6 w-6" />
          </div>
          <div>
            <span className="text-[11px] font-bold tracking-wide text-brand-700">라이브 음성 인식 설정</span>
            <h1 className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">음성인식 발음 힌트</h1>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-600 sm:text-sm">
              상품명, 브랜드명, 자주 틀리는 고유명사 등을 미리 등록하세요. 클라우드 STT 요청에 함께 보내어 해당 표현을 알아듣는 데 도움을 줍니다.
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <section aria-labelledby="vocabulary-title" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="vocabulary-title" className="text-base font-black text-slate-900">등록할 단어</h2>
              <p className="mt-1 text-xs text-slate-500">단어 또는 짧은 구절을 최대 50개까지 저장할 수 있습니다.</p>
            </div>
            <span className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-black text-brand-700" aria-live="polite">
              {draftWords.length} / {MAX_STT_VOCABULARY_WORDS}
            </span>
          </div>

          <div>
            <label htmlFor="stt-vocabulary-input" className="block text-xs font-bold text-slate-700">단어 추가</label>
            <p id="stt-vocabulary-help" className="mt-1 text-xs leading-relaxed text-slate-500">
              한 항목은 {MAX_STT_VOCABULARY_WORD_LENGTH}자 이내로 입력해 주세요. 여러 항목은 쉼표 또는 줄바꿈으로 구분할 수 있습니다.
            </p>
            <textarea
              id="stt-vocabulary-input"
              aria-describedby="stt-vocabulary-help"
              rows={4}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={isLoading || isSaving || draftWords.length >= MAX_STT_VOCABULARY_WORDS}
              placeholder={'예: 코듀로이, 애프터눈티\n브랜드 이름, 자주 쓰는 상품명'}
              className="mt-3 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={addWords}
              disabled={isLoading || isSaving || draftWords.length >= MAX_STT_VOCABULARY_WORDS}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-xs font-bold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> 단어 목록에 추가
            </button>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <h3 className="text-xs font-bold text-slate-700">현재 목록</h3>
            {isLoading ? (
              <p className="mt-3 text-xs text-slate-500" role="status">저장된 단어를 불러오는 중입니다.</p>
            ) : draftWords.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-xs text-slate-500">
                아직 등록한 단어가 없습니다. 방송에서 자주 잘못 인식되는 표현부터 추가해 보세요.
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="등록된 발음 힌트">
                {draftWords.map((word, index) => (
                  <li key={`${word}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs font-semibold text-slate-800">
                    <span className="break-all">{word}</span>
                    <button
                      type="button"
                      onClick={() => removeWord(index)}
                      disabled={isSaving}
                      aria-label={`${word} 삭제`}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(feedback || saveError) && (
            <p role="status" aria-live="polite" className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${saveError || feedback?.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              {saveError || feedback?.message}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <p className="text-[11px] text-slate-500">
              {input.trim() ? '입력한 단어를 목록에 추가한 뒤 저장하세요.' : saveError ? '다시 저장을 누르면 클라우드 동기화를 재시도합니다.' : '목록을 변경했다면 저장을 눌러 적용하세요.'}
            </p>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isLoading || isSaving || (!isDirty && !saveError) || Boolean(input.trim())}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-xs font-bold text-white shadow-sm transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {isSaving ? '저장 중…' : '발음 힌트 저장'}
            </button>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-brand-200 bg-brand-50/70 p-5">
            <div className="flex items-center gap-2 text-brand-800"><Cloud className="h-4 w-4" /><h2 className="text-sm font-black">언제 적용되나요?</h2></div>
            <p className="mt-3 text-xs leading-relaxed text-brand-900">
              저장한 발음 힌트는 다음 클라우드 STT 연결을 시작할 때 요청 설정으로 전송됩니다. 이미 진행 중인 청취에는 새 연결부터 반영됩니다.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-800"><Info className="h-4 w-4 text-slate-500" /><h2 className="text-sm font-black">학습 기능이 아닙니다</h2></div>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              이 목록은 음성 모델을 훈련하거나 인식 결과를 보장하지 않습니다. 비슷하게 들리는 이름과 판매 상품의 고유명사를 먼저 등록하면 도움이 될 수 있습니다.
            </p>
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span>짧고 구체적인 표현을 등록하고 실제 자막을 확인하며 조정해 보세요.</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
