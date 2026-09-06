export type SttMode = 'CLOUD' | 'LOCAL';

export type LocalSttModel = 'large-v3-turbo' | 'small' | 'base';

export type LocalSttState =
  | 'DISCONNECTED'
  | 'HELPER_OFFLINE'
  | 'LOADING'
  | 'READY'
  | 'LISTENING'
  | 'ERROR';

export type HardwareVendor = 'NVIDIA' | 'AMD' | 'INTEL' | 'CPU' | 'UNKNOWN';

export interface HardwareProfile {
  vendor: HardwareVendor;
  gpu_name: string;
  cpu_name: string;
  cpu_threads?: number;
  cuda_available: boolean;
  recommended_model: LocalSttModel;
  recommended_device: 'cpu' | 'cuda' | string;
  recommended_compute_type: 'float16' | 'int8' | string;
  description: string;
}

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
  hardwareProfile?: HardwareProfile | null;
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
