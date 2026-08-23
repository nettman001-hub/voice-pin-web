export interface TrainingSentence {
  id: string;
  sentence: string;            // 예: "구매 확정됐습니다"
  category: '멘트' | '닉네임' | '금액' | '명령';
  recordCount: number;         // 녹음 횟수 (3회 이상이면 완료 배지)
  isCompleted: boolean;        // 훈련 완료 여부
  lastTrainedAt?: string;
  expectedAccuracy: number;    // 예상 인식률 (예: 95%)
  audioBlobUrl?: string;       // 최근 녹음 오디오 URL
}
