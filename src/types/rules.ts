export type RuleAction = 'DB_SAVE' | 'SCREEN_CAPTURE' | 'DB_SAVE_AND_CAPTURE';

export interface RecognitionWordRule {
  id: string;
  word: string;               // 예: '구매확정', '닉네임', '가격', '금액', '캡처'
  action: RuleAction;         // 동작
  isEnabled: boolean;         // 활성화 여부
  isEssential: boolean;       // 필수 단어 여부 (삭제 불가)
  priority: number;           // 우선순위
  description?: string;
}

export type CaptureAreaPreset = 'COMMENTS' | 'ORDERS' | 'FULL_SCREEN' | 'CUSTOM';

export interface CaptureAreaConfig {
  preset: CaptureAreaPreset;
  name: string;
  xRatio: number;      // 0 ~ 1
  yRatio: number;      // 0 ~ 1
  widthRatio: number;  // 0 ~ 1
  heightRatio: number; // 0 ~ 1
}
