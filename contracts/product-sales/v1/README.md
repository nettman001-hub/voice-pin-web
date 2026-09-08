# VoiceCAP Product Sales Contract v1

이 디렉터리는 웹, Android (`voicecapSMS`), 서버 (`sales-api`), PC 도우미 (`comment-helper`) 간의 상품 중심 판매관리 API v1 공통 계약을 정의한다.

## 1. 디렉터리 구성
- `schemas/`: JSON Schema 정의 (`envelope.schema.json`, `request.schema.json`)
- `fixtures/`: 유효한 UUID 및 실제 비즈니스 로직 기반 정상/오류 JSON fixture
  - `bootstrap.json`: get-bootstrap 응답
  - `feed.json`: get-sales-feed (댓글 수신 및 watchedBuyerIds 통계 갱신)
  - `product_prepare_commit.json`: prepare-product (`0007` 보존), update-product-draft (NUMBER_IMAGE 대체 확인), commit-product
  - `commit_sales.json`: commit-sales (동일 구매자 댓글 다중 선택 시 수량 계산, 원본 출력 작업 QUEUED 생성)
  - `product_change.json`: prepare-product-image, preview-product-change (20,000 -> 25,000 단가 일괄 수정, 정산 영향), commit-product-change (CORRECTION 출력 작업 생성)
  - `print_workflow.json`: claim-print-jobs, renew-print-lease, begin-print-job (SUBMITTING), acknowledge-print-job (SUBMITTED/FAILED), UNKNOWN 상태
  - `device_management.json`: list-devices, update-device-capabilities, set-output-device
  - `buyers.json`: search-buyers, confirm-buyer (MANUAL_CONFIRMED 수동 확인)
  - `operations.json`: get-operation (NOT_FOUND 재전송 유도, PROCESSING, SUCCEEDED)
  - `errors.json`: REVISION_CONFLICT, CAPABILITY_DENIED, PRODUCT_CODE_EXISTS, OPERATION_PAYLOAD_MISMATCH, COMMENT_ALREADY_COMMITTED, PREVIEW_EXPIRED, PRICE_REQUIRED
- `validate-contracts.test.mjs`: 계약 스키마, UUID 형식, 계산식 일치성을 검증하는 Node.js 네이티브 테스트

## 2. 검증 실행 방법
```powershell
node --test contracts/product-sales/v1/validate-contracts.test.mjs
```
