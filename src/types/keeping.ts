export interface CustomerKeepingRecord {
  id: string;                  // 고유 키핑 식별자 (예: keep_20261012_01)
  buyerNickname: string;       // 구매자 닉네임
  phoneNumber?: string;        // 구매자 연락처 (있을 경우)
  sessionId: string;           // 주문 회차 ID
  sessionCode?: string;        // 회차 표시 코드 (예: 10/10 #1)
  saleIds: string[];           // 키핑된 판매 건 ID 목록
  totalAmount: number;         // 키핑된 상품 총 금액
  productNames: string[];      // 키핑된 상품명 목록
  status: 'KEPT' | 'RELEASED'; // KEPT: 보관 중, RELEASED: 출고(묶음발송) 완료
  keptAt: string;              // 키핑 등록 일시
  releasedAt?: string;         // 출고 처리 일시
  releasedSessionId?: string;  // 함께 묶음 배송된 회차 ID
  memo?: string;               // 판매자 메모
}

export interface BuyerKeepingSummary {
  buyerNickname: string;
  hasActiveKeeping: boolean;
  activeCount: number;
  totalKeptAmount: number;
  records: CustomerKeepingRecord[];
  allSaleIds: string[];
}
