export interface DeepgramConfig {
  apiKey?: string;
  model: 'nova-3' | 'nova-2' | 'enhanced';
  language: 'ko' | 'en';
  keyterms: string[]; // Nova-3 keyterm prompting (예: ['구매확정', '닉네임', '가격', '금액', '캡처'])
  punctuate: boolean;
  interimResults: boolean;
  endpointing: number;
  allowBrowserSpeechFallback?: boolean;
}

export type SttProvider = 'DEEPGRAM' | 'SONIOX';

export interface SttConfig extends DeepgramConfig {
  provider: SttProvider;
}

export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

export interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

export interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

export interface DeepgramResponse {
  type: 'Results' | 'Metadata';
  channel_index?: number[];
  duration?: number;
  start?: number;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: DeepgramChannel;
}

export interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
  is_final: boolean;
  language?: string;
}

export interface SonioxResponse {
  tokens: SonioxToken[];
  final_audio_proc_ms?: number;
  total_audio_proc_ms?: number;
  finished?: boolean;
  error_code?: number;
  error_type?: string;
  error_message?: string;
  request_id?: string;
}
