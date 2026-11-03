# 관리탭 재설계 PR 0: 현황 확인

기준: main a14f4dc (2026-11-02). 설계서: `/mnt/project-files/designs/관리탭_대시보드_재설계.md` (v5).

PR 0은 코드를 바꾸지 않고, 새 관리 화면을 만들기 전에 지금 코드의 결함과 다시 쓸 부분을 적는다.
운영 데이터 건수와 SQL 202610310001/0002 운영 적용 여부는 클라우드에서 볼 수 없어, PC 세션에서 읽기 쿼리로 확인한다 (사용자 한 줄 필요).

## 1. 결함 재현표 (코드 근거)

| # | 결함 | 근거 | 재현 | 새 구조에서 |
|---|------|------|------|-------------|
| 1 | 정산서를 두 번 보낼 수 있음 | `src/context/CommerceContext.tsx` sendInvoice 에 보내는 중 잠금이 없음. 앱에서는 InvoiceManagementPage 가 두 번째 탭을 다시 묻기만 함 | 느린 회선에서 [보내기]를 두 번 누르면 문자가 두 통 나감 | 정산서 만들기·보내기를 서버 함수로 옮기고 operation id 로 한 번만 (PR 2) |
| 2 | 한 회차×구매자에 열린 정산서가 여러 개 | createInvoice 가 기존 열린 정산서를 확인하지 않음 | 같은 구매자에 정산서를 두 번 만들면 둘 다 DRAFT | 열린 ORDER 정산서는 하나만 (DB 제약). PR 1 계산 모듈이 지금 데이터에서 `duplicateOpenInvoiceIds` 로 찾아 홈 할 일 맨 앞에 보여 줌 |
| 3 | 보내기 실패가 DRAFT 로 돌아감 | sendInvoice 가 실패하면 status 를 DRAFT 로 되돌림 | 실패한 정산서가 "청구 전"과 섞임 | 실패는 별도 표시 (sent_via, 실패 사유) |
| 4 | invoices·shipments 를 행 전체로 덮어씀 | `src/services/remoteWorkspaceService.ts:876`, `:878` upsert | 두 기기가 같은 정산서·배송을 고치면 나중 기기가 앞 기기 변경을 지움 | revision 비교하는 서버 함수 (PR 2) |
| 5 | 보관(킵) 기록이 배열 하나 | `src/services/customerKeepingService.ts:62` workspace_settings 'customer_keeping_records' 통째 저장 | 두 기기가 동시에 보관을 바꾸면 한쪽이 사라짐 | fulfillment_items 표 (상품 한 건 = 한 행) |
| 6 | 보관 해제가 호출되지 않음 | releaseKeeping, releaseAllBuyerKeeping 을 부르는 화면이 없음 | 출고해도 보관 중으로 남음 | 출고 예약이 보관 상품을 잠그고 상태를 옮김 |
| 7 | 보관 구매자를 비슷한 닉네임으로 찾음 | customerKeepingService 가 areNicknamesSimilar 사용 | "하늘이"의 보관이 "하늘이네"에 붙을 수 있음 | 구매자 키 buyer:<id> / nickname:<정규화> 정확 일치만 |
| 8 | 번호↔닉네임 연결이 blob 하나 | `src/services/buyerPhoneLinkService.ts` 'buyer_phone_links' | #5 와 같은 덮어쓰기 위험, buyerKey 없음 | buyer_contacts 표. 옛 기록은 닉네임 정확 일치로 옮김 |
| 9 | 앱에서 화면 확대가 막힘 | `index.html:6` maximum-scale=1.0, user-scalable=no (sell.html 은 허용) | 관리 화면 글씨를 키울 수 없음 | 관리 화면은 확대 허용 (PR 3) |
| 10 | 판매를 매번 전부 불러옴 | remoteWorkspaceService loadSales 가 1,000건씩 끝까지 | 판매가 쌓일수록 관리 화면 열기가 느려짐 | 관리 홈은 요약 조회, 목록은 회차·기간 단위 (PR 4 이후). 계산은 2,000건 테스트로 확인 |

## 2. 다시 쓰는 것

- `isBillableSale` (src/services/billableSales.ts): 합계 규칙. 새 주문 합계 = 판매내역 합계 (테스트로 고정).
- `promiseDefaultBuyerKey`: 구매자 키.
- `findNicknameInMessages` / `needsNicknameConfirmation` (smsNicknameLink.ts): 문자로 연락처 연결.
- 배송비 규칙: shippingService.calculateShippingFee 와 같은 결과를 내는 순수 함수 `src/services/manage/shippingFee.ts` (테스트로 비교).
- 수동 배송비(정산 > 배송비 & 키핑): 회차별 그대로. 여러 회차가 한 번에 나가는 출고에는 적용하지 않음 (getOverrideForSales 와 같음).

## 3. PR 1 에서 만든 계산 모듈

`src/services/manage/` (화면·저장 없음, 순수 함수)

- `contactLink.ts`: 연락처 연결 (예전 연결, 새 문자, 확인 필요, 해제된 번호, 방송에서 불러 줄 명단, 누군지 모르는 번호)
- `orderPipeline.ts`: 회차×구매자 주문서와 돈 단계 (연락처 연결 → 청구 전 → 입금 대기 → 결제 완료). 킵 고객은 상품값만
- `fulfillment.ts`: 상품 상태, 보관 가능 여부, 출고 계획 (보관 전체 + 결제된 새 상품, 고객 취소·미결제 제외, 배송비 한 번), 보관 알림 (판매자 설정 일수, 처음 14·30일)
- `todos.ts`: 홈 할 일 순서
- 테스트: `test/manage-calc.test.mjs`

## 4. PC 에서 확인할 것 (읽기만)

- 운영 DB: invoices 에서 회차×구매자별 열린 정산서가 둘 이상인 건수, customer_keeping_records·buyer_phone_links blob 크기와 건수, 회차당 판매 최대 건수
- SQL 202610310001, 202610310002 운영 적용 여부
