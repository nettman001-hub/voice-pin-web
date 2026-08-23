export interface DeepgramConfig {
  apiKey?: string;
  model: 'nova-3' | 'nova-2' | 'enhanced';
  language: 'ko' | 'en';
  keywords: string[]; // Keyterm biasing (예: ['구매확정:2', '닉네임:2', '가격:2', '금액:2', '캡처:2'])
  punctuate: boolean;
  interimResults: boolean;
  endpointing: number;
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
