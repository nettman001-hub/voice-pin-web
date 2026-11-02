# 관리탭 재설계 PR 2: 서버 저장 구조와 계약

- SQL: `supabase/migrations/202611030001_manage_fulfillment.sql`
- sales-api: `handlers/manage.ts`, `handlers/manageCore.ts` (검증), 라우터 `index.ts`
- 웹 호출: `src/services/manage/manageApi.ts`
- 시험: `test/manage-migration.test.mjs` (PGlite 로 SQL 실제 실행), `test/manage-api-core.test.mjs`

## 바뀌는 것

| 대상 | 내용 | 옛 화면 영향 |
|------|------|--------------|
| buyer_contacts (새 표) | 전화번호 → 구매자 연결. LINKED / BLOCKED | 없음. 옛 blob 은 복사만 |
| fulfillment_items (새 표) | 판매 한 건의 보관·출고 상태 | 없음. 옛 보관 blob 의 KEPT 기록을 복사 |
| fulfillment_events (새 표) | 모든 관리 쓰기 기록 | 없음 |
| shipments | buyer_key, shipping_fee, fee_basis, shipping_paid, operation_id, revision 열 추가. 상태에 RESERVED 추가 | 없음 (열 추가, 옛 상태 그대로 허용) |
| invoices | kind, session_id, buyer_key, product_amount, shipping_fee, sent_via, 보내기 잠금 열, revision 추가. 회차×구매자마다 열린 주문 정산서 하나 (새 행에만) | 없음. 옛 행은 session_id 가 비어 제약 밖 |

새 표는 회원이 읽기만 할 수 있고, 쓰기는 `public.voicecap_manage()` (service_role) 하나뿐이다.
invoices/shipments 의 기존 회원 쓰기 권한은 옛 화면 때문에 그대로 둔다. 새 화면으로 바꾼 뒤(PR 4 이후) 좁힌다.

## 액션 (sales-api, 판매자 로그인만, SALES_WRITE)

모두 `operationId`(uuid) 필수. 같은 번호로 같은 내용이 다시 오면 처음 결과(`replayed: true`), 다른 내용이면 `OPERATION_PAYLOAD_MISMATCH`.

| 액션 | 입력 | 거절 코드 |
|------|------|-----------|
| manage-contact-link | phone, mode LINK/BLOCK/UNLINK, buyerKey, nickname, source, replace | PHONE_LINKED_TO_OTHER |
| manage-keep | buyerKey, saleIds | KEEP_REQUIRES_PAYMENT, SALE_NOT_BILLABLE, ITEM_STATE_CONFLICT |
| manage-unkeep | saleIds | ITEM_STATE_CONFLICT |
| manage-cancel-items | buyerKey, saleIds, reason, cancelledBy | ITEM_STATE_CONFLICT (포장 뒤) |
| manage-mark-refunded | saleIds | - |
| manage-backfill-buyer-keys | buyerKey, saleIds (키 없는 옛 보관 기록만) | - |
| manage-shipment-reserve | buyerKey, saleIds, 받는 사람, 배송비 | KEPT_ITEMS_MISSING, SHIPMENT_ITEM_UNPAID, SHIPMENT_CONFLICT, BUYER_MISMATCH |
| manage-shipment-status | shipmentId, status, expectedRevision, 택배사·송장 | REVISION_CONFLICT, SHIPMENT_STATE_CONFLICT |
| manage-invoice-create | sessionId, buyerKey, saleIds, 금액 나눔, 계좌, 입금코드 | 열린 정산서가 있으면 그것을 돌려줌 (existing: true) |
| manage-invoice-begin-send | invoiceId, resend | INVOICE_ALREADY_SENDING, INVOICE_ALREADY_SENT, INVOICE_CLOSED |
| manage-invoice-finish-send | invoiceId, sendOperationId, sent, smsMessageId, error | SEND_LEASE_LOST |
| manage-invoice-cancel | invoiceId | INVOICE_CLOSED |

결제 판정(서버): 입금 매칭(MATCHED)에 들어 있거나 결제 완료 정산서에 들어 있는 판매.
합계 제외(서버): 보류, record_state CANCELLED. (AI 검토 NOT_SALE 은 웹 판정이라 서버는 모름 — 웹이 그런 판매를 보내지 않는다.)

## 운영 반영 순서

1. PC 세션에서 SQL 적용: `202611030001_manage_fulfillment.sql` (다시 적용해도 안전)
2. sales-api 배포
3. 웹은 아직 새 액션을 부르는 화면이 없어 이 PR 병합만으로 사용자 화면은 바뀌지 않는다.

원복: 새 표와 함수는 쓰는 곳이 없으므로 그대로 두어도 된다. 꼭 지워야 하면 함수 → 새 표 순서로 drop, invoices/shipments 의 새 열은 남겨도 옛 화면에 영향 없음.
