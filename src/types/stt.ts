export type SttMode = 'CLOUD' | 'LOCAL';

export type LocalSttModel = 'large-v3-turbo' | 'small' | 'base';

export type LocalSttState =
  | 'DISCONNECTED'
  | 'HELPER_OFFLINE'
  | 'LOADING'
  | 'READY'
  | 'LISTENING'
  | 'ERROR';

export interface LocalSttStatusPayload {
  available: boolean;
  state: LocalSttState;
  model: LocalSttModel | string;
  requestedModel?: LocalSttModel | string;
  device: 'cpu' | 'cuda' | string;
  computeType: string;
  message: string;
  error?: string | null;
  activeSessionId?: string;
  activeGeneration?: number;
  pythonPath?: string;
  hasOwner?: boolean;
  droppedChunks?: number;
}

export interface LocalSttTranscriptEvent {
  event: 'transcript';
  session_id: string;
  generation: number;
  text: string;
  is_final: boolean;
  confidence: number;
  provider: 'LOCAL_WHISPER';
  duration?: number;
  infer_time?: number;
  is_abnormal?: boolean;
  abnormal_reason?: string;
}
