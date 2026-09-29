import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { storageService } from '../services/storageService';
import { remoteWorkspaceService } from '../services/remoteWorkspaceService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { normalizeSttVocabulary } from '../services/sttVocabularyService';

interface VocabularyState {
  workspaceId: string | null;
  words: string[];
  isLoading: boolean;
  saveError: string | null;
}

interface SttVocabularyContextValue {
  words: string[];
  saveWords: (words: string[]) => Promise<void>;
  getWordsForConnection: () => Promise<string[]>;
  isLoading: boolean;
  saveError: string | null;
}

const SttVocabularyContext = createContext<SttVocabularyContextValue | null>(null);

export const SttVocabularyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { workspaceId } = useAuth();
  const [state, setState] = useState<VocabularyState>({
    workspaceId: null, words: [], isLoading: false, saveError: null,
  });
  const editVersionRef = useRef(0);
  const cloudSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queueCloudSave = useCallback((owner: string, words: string[]): Promise<void> => {
    const write = cloudSaveQueueRef.current.then(() => remoteWorkspaceService.saveSttVocabulary(owner, words));
    cloudSaveQueueRef.current = write.catch(() => {});
    return write;
  }, []);

  useEffect(() => {
    editVersionRef.current += 1;
    const loadVersion = editVersionRef.current;
    const owner = workspaceId || null;
    const localWords = owner ? storageService.getSttVocabulary(owner) : [];
    setState({ workspaceId: owner, words: localWords, isLoading: Boolean(owner && isSupabaseConfigured), saveError: null });
    if (!owner || !isSupabaseConfigured) return;

    let active = true;
    if (storageService.isSttVocabularyPending(owner)) {
      void queueCloudSave(owner, localWords).then(() => {
        if (!active || editVersionRef.current !== loadVersion) return;
        storageService.saveSttVocabulary(owner, localWords, false);
        setState({ workspaceId: owner, words: localWords, isLoading: false, saveError: null });
      }).catch((error) => {
        if (!active || editVersionRef.current !== loadVersion) return;
        console.warn('[STT vocabulary] Pending cloud save failed:', error);
        setState({
          workspaceId: owner, words: localWords, isLoading: false,
          saveError: '이 기기의 단어가 클라우드와 아직 동기화되지 않았습니다. 다시 저장해 주세요.',
        });
      });
      return () => { active = false; };
    }

    void remoteWorkspaceService.loadSttVocabulary(owner).then((cloudWords) => {
      if (!active || editVersionRef.current !== loadVersion) return;
      if (cloudWords !== null) {
        const words = normalizeSttVocabulary(cloudWords);
        storageService.saveSttVocabulary(owner, words, false);
        setState({ workspaceId: owner, words, isLoading: false, saveError: null });
      } else {
        setState((current) => current.workspaceId === owner ? { ...current, isLoading: false } : current);
      }
    }).catch((error) => {
      if (!active || editVersionRef.current !== loadVersion) return;
      console.warn('[STT vocabulary] Cloud load failed; keeping local words:', error);
      setState((current) => current.workspaceId === owner ? { ...current, isLoading: false } : current);
    });
    return () => { active = false; };
  }, [workspaceId, queueCloudSave]);

  useEffect(() => {
    if (!workspaceId) return;
    const owner = workspaceId;
    const refreshFromStorage = () => setState((current) => current.workspaceId === owner
      ? { ...current, words: storageService.getSttVocabulary(owner) }
      : current);
    window.addEventListener('voicecap_stt_vocabulary_updated', refreshFromStorage);
    return () => window.removeEventListener('voicecap_stt_vocabulary_updated', refreshFromStorage);
  }, [workspaceId]);

  const saveWords = useCallback(async (input: string[]) => {
    if (!workspaceId) throw new Error('로그인한 작업공간이 없어 단어를 저장할 수 없습니다.');
    const owner = workspaceId;
    const words = normalizeSttVocabulary(input);
    const saveVersion = ++editVersionRef.current;
    if (!storageService.saveSttVocabulary(owner, words, isSupabaseConfigured)) {
      throw new Error('이 기기에 단어를 저장하지 못했습니다. 저장 공간을 확인해 주세요.');
    }
    setState({ workspaceId: owner, words, isLoading: false, saveError: null });

    if (!isSupabaseConfigured) return;
    try {
      await queueCloudSave(owner, words);
      if (editVersionRef.current === saveVersion) storageService.saveSttVocabulary(owner, words, false);
    } catch (error) {
      const message = '이 기기에는 저장했지만 클라우드 동기화에 실패했습니다. 연결 후 다시 저장해 주세요.';
      if (editVersionRef.current === saveVersion) {
        setState((current) => current.workspaceId === owner ? { ...current, saveError: message } : current);
      }
      console.warn('[STT vocabulary] Cloud save failed:', error);
      throw new Error(message);
    }
  }, [workspaceId, queueCloudSave]);

  // A fresh device may start listening before the initial cloud load completes.
  // Resolve the same workspace vocabulary before opening that first STT socket.
  const getWordsForConnection = useCallback(async (): Promise<string[]> => {
    if (!workspaceId) return [];
    const localWords = storageService.getSttVocabulary(workspaceId);
    const startingEditVersion = editVersionRef.current;
    if (
      !isSupabaseConfigured ||
      storageService.isSttVocabularyPending(workspaceId) ||
      (state.workspaceId === workspaceId && !state.isLoading)
    ) return localWords;

    try {
      const cloudWords = await remoteWorkspaceService.loadSttVocabulary(workspaceId);
      // A concurrent local edit always takes precedence over an older cloud read.
      if (
        editVersionRef.current !== startingEditVersion ||
        storageService.isSttVocabularyPending(workspaceId) ||
        JSON.stringify(storageService.getSttVocabulary(workspaceId)) !== JSON.stringify(localWords)
      ) {
        return storageService.getSttVocabulary(workspaceId);
      }
      return cloudWords ?? storageService.getSttVocabulary(workspaceId);
    } catch {
      return storageService.getSttVocabulary(workspaceId);
    }
  }, [workspaceId, state.workspaceId, state.isLoading]);

  const owner = workspaceId || null;
  const current = state.workspaceId === owner ? state : {
    workspaceId: owner,
    words: owner ? storageService.getSttVocabulary(owner) : [],
    isLoading: Boolean(owner && isSupabaseConfigured),
    saveError: null,
  };

  return <SttVocabularyContext.Provider value={{
    words: current.words,
    saveWords,
    getWordsForConnection,
    isLoading: current.isLoading,
    saveError: current.saveError,
  }}>{children}</SttVocabularyContext.Provider>;
};

export const useSttVocabulary = (): SttVocabularyContextValue => {
  const context = useContext(SttVocabularyContext);
  if (!context) throw new Error('useSttVocabulary must be used within SttVocabularyProvider');
  return context;
};
