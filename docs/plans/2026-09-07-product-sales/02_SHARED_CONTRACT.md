# VoiceCAP 상품 판매 공통 구현 명세

작성일 2026년 9월 7일 · 단일 에이전트 실행안 개정 2026년 9월 8일 · 계약 버전 1

이 문서는 웹, Android, 서버, PC 댓글 도우미가 같은 상품과 판매를 다루기 위한 구현 계약이다. 아래 테이블과 API는 이번 개발에서 추가할 설계이며 현재 운영에 존재하는 API가 아니다. 하나의 Antigravity 에이전트가 먼저 이 문서에서 JSON Schema와 fixture를 확정하고, 서버와 각 클라이언트를 같은 형식으로 순차 구현한다. 계약 변경은 코드보다 이 문서, Schema, fixture와 변경 기록을 먼저 갱신한 뒤 모든 구성요소에 반영한다.

## 1 확정된 업무 규칙

- 사용자는 상품번호 또는 상품명과 상품사진으로 상품을 구분한다. 데이터 연결에는 수정되지 않는 `productId`를 쓴다. 사진 URL이나 상품명을 DB 기본키로 쓰지 않는다.
- 같은 구매자의 댓글 여러 개를 선택하면 구매자 한 명으로 합치고 기본 수량은 1이다. 판매자가 수량을 수정할 수 있다. 이것은 사용자 확인을 받은 규칙이다.
- 상품 가격 변경은 변경 대상과 전후 금액을 먼저 확인한 다음 기존 판매에도 적용한다. 이것은 사용자 확인을 받은 규칙이다.
- 구매자 없는 상품등록은 판매가 아니다. 상품등록만으로 판매수량, 매출, 구매횟수, 전표를 늘리지 않는다.
- 댓글 선택은 임시 상태다. 서버 판매 저장 성공 후에 확정 합계가 바뀐다. 선택 중에는 등록 후 예상 합계를 별도로 표시한다.
- 음성 팝업은 유효한 후보 완성 후 기본 2.5초, Android 촬영은 전면 카메라 준비 완료 후 2초 카운트다운으로 구현한다. 시간 기준은 구현 기본안이다.

## 2 공통 용어와 숫자

| 이름 | 정의 |
| --- | --- |
| workspaceId | 판매자의 작업공간. 인증된 회원 또는 기기에서 서버가 결정한다 |
| sessionId | 방송 회차의 불변 ID. 새로운 회차를 시작할 때 서버가 생성한다 |
| sessionCode | 화면에 보여주는 회차 이름. ID와 분리한다 |
| productId | 상품의 불변 UUID. 상품명과 사진을 바꿔도 유지한다 |
| productCode | 판매자가 입력한 번호 또는 서버가 발급한 중복 없는 표시 번호 |
| buyerId | 작업공간 안의 구매자 ID. 닉네임과 분리한다 |
| revision | 수정할 때 1씩 증가하는 버전. 오래된 화면의 덮어쓰기를 막는다 |
| operationId | 같은 저장 요청을 재시도해도 한 번만 처리하기 위한 UUID |
| previewToken | 변경 영향 미리보기와 최종 수정 요청을 연결하는 서버 발급 값 |
| amount | 단가 곱하기 수량인 판매 합계. 기존 amount 의미를 유지한다 |

모든 금액은 원화 정수이다. 서버와 앱 모두 부동소수점 금액 계산을 사용하지 않는다. 신규 판매 단가는 1원부터 99,999,999원, 수량은 1부터 999까지를 기본 검증 범위로 제안한다. 단가 곱하기 수량과 기존 정수 DB 컬럼에 저장하는 값은 2,147,483,647 이하인지 추가 검증한다. 범위를 바꾸려면 DB 타입과 모든 클라이언트를 같이 검토한다. 가격 미입력은 `null`로 보존하며 임의 가격이나 0원 판매로 바꾸지 않는다.

날짜는 API에서 UTC ISO 8601 문자열로 주고, 화면은 Asia/Seoul로 표시한다. ID를 단말 시각만으로 만들지 않는다. 현재 방송 한 회차에 활성 상품 하나, 작업공간당 진행 중 회차 하나를 1차 구현 기본안으로 한다. 탭 이동, STT 일시정지, 재접속은 새 회차를 만들지 않는다.

## 3 설정 계약

저장 범위는 workspace이다. 웹 설정과 Android 설정에서 같은 값을 읽고 갱신한다. 서버도 설정을 검증하므로 오래된 Android 앱이 금지된 등록을 우회할 수 없어야 한다.

```json
{
  "revision": 1,
  "productRegistrationEnabled": true,
  "captureProductImageEnabled": true,
  "productNameInputEnabled": true,
  "voicePreviewMs": 2500,
  "voiceCommands": {
    "registerProduct": ["상품등록"],
    "captureProduct": ["상품캡처"],
    "setProductName": ["상품번호", "상품명"],
    "setPrice": ["금액", "가격"],
    "confirmSale": ["판매완료", "구매확정"],
    "setBuyer": ["닉네임"]
  }
}
```

`voicePreviewMs`는 2000부터 3000까지 허용한다. 기본값은 2500이다. 예전 DB_SAVE 등의 규칙과 위 명령 종류를 혼용하지 말고 명시적으로 변환한다. 설정에 동일 단어를 서로 다른 동작으로 중복 등록하면 저장을 거절하고 충돌 단어를 표시한다. 기본 명령도 하드코딩된 별도 실행 경로가 아니라 같은 규칙으로 처리한다.

상품등록 기능 OFF 시의 기본안은 명시적 상품등록 기능을 숨기고 기존 판매모드를 유지하는 것이다. 기존 판매에는 `productId=null`을 허용하고 미분류 내역으로 표시한다. ON이면 신규 상품 중심 판매에는 상품 ID가 필수다. 사진 OFF는 촬영하지 않고 번호이미지를 사용한다. 상품명 입력 OFF는 입력폼과 음성 상품명 추출을 끄고 서버 번호를 사용한다. 설정 변경은 이미 저장된 상품을 소급 삭제하지 않는다. 이 OFF 동작은 제품 검토 시 조정 가능한 기본안이다.

## 4 데이터 모델

### 4 1 새 테이블

| 테이블 | 주요 컬럼과 규칙 |
| --- | --- |
| live_sessions | id text UUID 문자열, workspace_id, display_code, status ACTIVE 또는 ENDED, active_product_id, revision, started_at, ended_at. workspace별 ACTIVE 하나의 부분 유일 제약 |
| products | id UUID, workspace_id, session_id, product_code, name nullable, image_path, image_kind PHOTO 또는 NUMBER_IMAGE, unit_price nullable, revision, sales_revision, source WEB_VOICE 또는 ANDROID 또는 MANUAL, created_at |
| product_drafts | id UUID, workspace_id, product_id 예약값, session_id, product_code 예약값, name, unit_price, image_kind, upload_path, status, revision, expires_at, actor_id. 확정 전 초안과 업로드 소유권 관리 |
| product_code_reservations | workspace_id, product_code, product_id, draft_id, reserved_at. 작업공간과 코드에 유일 제약을 두고 상품·초안이 사라져도 예약 행은 보존 |
| buyers | id UUID, workspace_id, platform, platform_user_id nullable, platform_unique_id nullable, display_nickname, identity_status VERIFIED, MANUAL_CONFIRMED 또는 UNRESOLVED |
| live_comments | id UUID, workspace_id, session_id, collector_id, platform_message_id, buyer_id, nickname_snapshot, content, captured_at, ingest_sequence |
| sale_revisions | id UUID, workspace_id, sale_id, old_revision, new_revision, before_value JSON, after_value JSON, actor_user_id 또는 actor_device_id, reason, operation_id, created_at |
| sale_comment_sources | workspace_id, product_id, comment_id, sale_id. 상품과 원본 댓글의 소비 관계에 유일 제약을 두며 취소 뒤에도 자동 재사용하지 않음 |
| operations | workspace_id, operation_id, actor_id, action, request_hash, status, response_json. workspace와 operation_id 유일 |
| product_change_previews | token_hash, workspace_id, actor_id, product_id, proposed_patch, product_revision, sales_revision, affected_sales_revisions, expires_at, consumed_operation_id |
| print_jobs | id UUID, workspace_id, sale_id, sale_revision, kind SALE 또는 CORRECTION 또는 CANCEL 또는 REPRINT, reprint_sequence, immutable_payload JSON, target_device_id, status, lease_token, lease_expires_at, attempts, result |
| paired_devices | id UUID, workspace_id, display_name, device_type, capabilities 배열, is_output_device, revision, revoked_at, last_seen_at. 토큰 원문은 저장하지 않음 |

`products.sales_revision`은 연결된 판매가 추가·수정·취소될 때마다 같은 트랜잭션에서 증가한다. 수정 미리보기 후 구매자가 추가되는 경쟁 조건을 이 값으로 감지한다. 새 회차의 상품은 새 productId를 발급한다. 상품을 다른 회차로 옮기지 않는다.

상품코드는 작업공간 전체에서 중복되지 않게 `UNIQUE(workspace_id, product_code)`를 둔다. 자동 번호 기본 형식은 `P-20260907-000123`이다. 번호는 서버의 잠금 또는 원자적 카운터로 발급하고 `product_code_reservations`의 유일 제약을 최종 방어로 둔다. 초안 준비 때 예약하고 상품 확정 뒤에도 예약 행을 보존한다. 삭제·취소·번호 변경 전 코드와 만료 초안의 번호도 재사용하지 않는다. UUID의 일부나 현재 밀리초만으로 중복 방지를 대신하지 않는다.

사용자가 번호·이름 한 칸에 숫자만 입력하면 그 문자열을 `requestedProductCode`로 사용하고 선행 0을 보존한다. 예를 들어 `00123`은 숫자 123으로 바꾸지 않는다. 일반 텍스트는 상품명으로 저장하고 코드는 자동 발급한다. 번호와 이름을 둘 다 받을 화면은 필드를 명확히 분리한다. 동일 코드를 이미 예약했으면 기존 상품을 덮어쓰지 않고 `PRODUCT_CODE_EXISTS`를 반환한다.

사진이 없으면 실제 번호가 쓰인 PNG 번호이미지를 생성해 private storage에 보관하고 `image_kind=NUMBER_IMAGE`로 기록한다. 클라이언트 임시 이미지를 쓸 수 있지만 최종 번호와 일치하는 이미지가 저장되어야 등록 성공이다. 이름이 없고 실제 사진만 있어도 내부 번호는 발급하되 사진을 대표 표시로 사용한다.

구매자 식별 우선순위는 TikTok의 안정 user ID, 없으면 검증한 uniqueId, 둘 다 없으면 확인 전용 임시 buyerId이다. 닉네임이 같다는 이유만으로 서로 다른 사람을 합치지 않는다. 판매자는 검색 결과에서 검증된 기존 구매자를 고르거나, 기존 후보가 없음을 확인한 뒤 `MANUAL_CONFIRMED` 구매자를 만들 수 있다. 이 수동 확인은 그 판매부터 쓰는 명시 동작이며 닉네임이 같은 과거 기록 전체를 자동 병합하지 않는다. 기존 닉네임뿐인 구매기록은 자동 연결하지 않고 확인된 연결만 누적 통계에 포함한다. 미연결 구기록이 있으면 화면에 통계 범위를 안내한다.

댓글은 원본 메시지 ID 기준으로 중복을 제거한다. 기본 유일 범위는 workspace, session, collector, platform_message_id이다. 한 회차에 수집 담당 PC 하나를 지정하고 재연결 뒤에도 같은 collector ID를 유지한다. 닉네임과 댓글 문구가 같아도 원본 ID가 다르면 다른 댓글이다.

### 4 2 기존 sales 확장

기존 text sale ID를 유지한다. SMS, 입금, 정산서, 배송에서 참조하는 ID를 새로 만들지 않는다.

| 추가 또는 유지 필드 | 규칙 |
| --- | --- |
| product_id nullable | 신규 상품모드는 필수. 과거 행과 구형모드만 null 허용 |
| buyer_id nullable | 신규 확정은 buyer ID 필수. 미확인 인식은 별도 후보로 남긴다 |
| quantity | 신규 기본 1. 과거 행은 1로 채운다 |
| unit_price | 과거 행은 기존 amount. 신규는 저장 시 고정된 상품 단가 |
| amount | quantity 곱하기 unit_price. 서버에서 계산한다 |
| product_code_snapshot | 저장 당시 상품코드 |
| product_name_snapshot | 저장 당시 이름. 기존 product_name과 매핑 정책을 통일한다 |
| product_image_path_snapshot | 상품사진 경로. 기존 댓글 증빙 캡처 경로와 분리한다 |
| buyer_nickname | 표시용 구매자명. buyer_id를 대신하지 않는다 |
| record_state | ACTIVE 또는 CANCELLED. 기존 한국어 status와 다른 필드 |
| revision | 기존 DB revision 활용. 새 API 응답과 프런트 타입에 반드시 전달한다 |
| source | WEB_VOICE, ANDROID_COMMENTS, MANUAL, LEGACY |
| source_comment_ids | 근거 댓글 배열. 구매수량은 이 배열 길이와 무관하다 |
| operation_id | 생성 또는 변경 요청 추적 |

판매수정은 기존 행과 ID를 유지하며 revision을 증가시킨다. 구매자 제외는 물리 DELETE 대신 CANCELLED로 남긴다. 상품명·사진을 수정할 때의 기본안은 해당 회차 상품과 연결된 활성 판매의 표시 snapshot에도 반영하고 이전 값은 sale_revisions에 보존하는 것이다. 가격 변경은 사용자 확정대로 기존 활성 판매 전체에 적용한다. 정산서나 입금 증빙의 원본 금액은 덮어쓰지 않는다.

### 4 3 집계 공식

- 회차 판매갯수 = 해당 workspace와 session의 ACTIVE 판매 `SUM(quantity)`.
- 회차 합계금액 = 같은 대상의 `SUM(amount)`.
- 구매자 회차 구매갯수와 금액 = 위 조건에 buyerId를 추가한 합계.
- 총 누적구매횟수 = 같은 workspace와 buyerId의 모든 회차 ACTIVE 판매 행 수. 수량 2개를 한 번 등록한 것은 구매 1회다. 이 횟수 정의는 구현 기본안이다.
- 총 누적금액 = 같은 대상의 `SUM(amount)`.
- 선택 예상값 = 서버 확정값 + 구매자별 선택 수량과 현재 상품 단가의 곱. 댓글 수신만으로 예상값이나 확정값을 올리지 않는다.
- 변경과 취소는 기존 값을 반영해 재계산한다. 정정 전표를 새 매출로 계산하지 않는다.

서버가 집계를 계산한다. 1차 구현은 인덱스를 활용한 SQL 집계를 권장한다. 화면마다 누적 카운터를 따로 증가시키지 않는다. 성능상 집계 테이블을 추가할 때는 원본 판매 변경과 같은 트랜잭션으로 갱신한다.

## 5 연결과 인증

웹과 Android는 `POST /functions/v1/sales-api`라는 신규 Edge Function을 사용한다. JSON의 `action`으로 아래 기능을 구분한다. 웹은 Supabase access token을 Authorization Bearer로 전달한다. Android와 도우미는 기존 페어링 방식의 `X-VoiceCAP-Device-Token`을 사용한다. 토큰 원문은 문서, fixture, 로그에 쓰지 않는다.

기기 권한은 `SALES_READ`, `SALES_WRITE`, `PRODUCT_WRITE`, `COMMENT_INGEST`, `PRINT`로 분리한다. 기존 SMS 기기에 판매 수정 권한을 자동 부여하지 않는다. 관리자 또는 해당 workspace 관리자가 기기 목록에서 판매용 권한을 명시적으로 켠다. 권한 변경은 대상 기기 revision을 검사하고 감사 이력을 남긴다. PC 도우미도 별도로 페어링하며, 출력 권한과 실제 출력 대상 지정은 분리한다. 출력 대상은 한 작업공간에 하나를 1차 기본안으로 하고 변경 충돌을 막는다. 예전 SMS 권한과 기존 기능은 유지한다.

서버는 인증 결과에서 workspace와 actor를 정한다. 요청의 workspaceId가 있더라도 소유권 검증을 통과해야 하며 단말이 임의 sellerId로 다른 판매자의 데이터를 읽게 해서는 안 된다. 새 함수에서 custom 기기 토큰을 지원하려면 현 config.toml과 같이 gateway verify_jwt 설정을 맞추고 함수 내부에서 모든 action을 인증한다. CORS 허용 헤더에도 기기 토큰을 포함한다. service-role은 클라이언트에 주지 않는다.

새 표와 이미지 bucket에 RLS 또는 서버 전용 접근 제한을 설정한다. 인증 Edge가 검증한 요청을 트랜잭션 RPC로 넘긴다. RPC의 공개 실행 권한을 회수하고, SECURITY DEFINER를 쓰는 경우 고정 search_path와 호출 권한을 검토한다. 신규 상품모드 판매를 클라이언트가 직접 upsert해서 revision과 출력 작업 생성을 우회하지 못하게 한다.

휴대폰의 127.0.0.1은 휴대폰 자신이다. Android는 PC의 localhost Socket.IO에 연결하지 않는다. 댓글은 PC 수집기에서 클라우드로 전달하고, 전표는 클라우드 작업을 지정 PC가 받아 출력한다. 웹창이 닫혀 있어도 Android 판매 저장과 PC 출력이 가능해야 한다.

## 6 API 목록

| action | 요청 핵심 | 응답 핵심 |
| --- | --- | --- |
| get-bootstrap | 없음 | settings, activeSession, activeProduct, printerStatus, permissions |
| update-settings | operationId, expectedRevision, settings | 저장된 settings |
| list-devices | cursor 선택, limit 최대 100 | 기기 표시정보, capabilities, output 지정, revision |
| update-device-capabilities | operationId, deviceId, expectedDeviceRevision, capabilities | 갱신된 기기와 감사 식별자 |
| set-output-device | operationId, deviceId, expectedSettingsRevision | outputDevice, settingsRevision |
| start-session | operationId, displayName 선택 | session |
| end-session | operationId, sessionId, expectedSessionRevision | 종료된 session |
| prepare-product | operationId, sessionId, expectedSessionRevision, requestedProductCode 선택, name, unitPrice, imageKind | draftId, draftRevision, productId, productCode, imageUpload, expiresAt |
| update-product-draft | operationId, draftId, expectedDraftRevision, imageKind, imageFallbackConfirmed | draft, imageUpload 선택 |
| commit-product | operationId, draftId, expectedDraftRevision, expectedSessionRevision | product, session |
| activate-product | operationId, sessionId, productId, expectedSessionRevision | session, activeProduct |
| ingest-comments | sessionId, collectorId, comments 원본 배열 | acceptedIds, duplicateIds, nextIngestCursor |
| get-sales-feed | sessionId, cursor 선택, limit 최대 100, watchedBuyerIds 최대 100 | comments, buyerStats, summary, activeProduct, sessionRevision, nextCursor, hasMore |
| search-buyers | query, sessionId 선택, cursor 선택, limit 최대 50 | VERIFIED, MANUAL_CONFIRMED, UNRESOLVED 후보와 통계 범위 |
| confirm-buyer | operationId, displayNickname, selectedBuyerId 선택, confirmationReason | 기존 확인 구매자 또는 새 MANUAL_CONFIRMED 구매자 |
| commit-sales | operationId, sessionId, productId, expectedProductRevision, expectedSessionRevision, buyers | sales, summary, buyerStats, printJobs |
| get-operation | operationId | NOT_FOUND, PROCESSING, SUCCEEDED 또는 FAILED 및 기존 결과 |
| list-session-products | sessionId, cursor 선택 | 판매된 product 요약 목록과 nextCursor |
| get-product-sales | sessionId, productId | product, sales, buyers, salesRevision |
| prepare-product-image | operationId, productId, expectedProductRevision, fileName, mimeType, size | imageId, private imageUpload, expiresAt |
| preview-product-change | productId, proposedProduct, proposedSales, expectedProductRevision, expectedSalesRevision | previewToken, before, after, affectedBuyers, settlements, expiresAt |
| commit-product-change | operationId, previewToken | product, sales, summary, buyerStats, printJobs |
| request-reprint | operationId, saleId, expectedSaleRevision, reason | 새 REPRINT job |
| get-print-status | saleIds 또는 jobIds | jobs |
| claim-print-jobs | device 인증, limit | jobs, leaseToken, leaseExpiresAt |
| renew-print-lease | jobId, leaseToken | leaseExpiresAt |
| begin-print-job | jobId, leaseToken, payloadHash, expectedSaleRevision | SUBMITTING 상태와 serverRecordedAt |
| acknowledge-print-job | jobId, leaseToken, result, spoolJobId 선택 | job 상태 |

`prepare-product`는 아직 판매 가능한 상품을 만들지 않는다. 서버 발급 번호와 UUID를 확보하고 촬영·업로드를 준비한다. 15분 유효 draft를 기본안으로 하고 만료 후 사용자 입력을 보존해 재준비한다. 재시도는 같은 operationId로 같은 draft를 반환한다. `commit-product`는 이미지가 실제로 있는지 검사한 후 상품과 회차의 활성 상품을 함께 확정한다. prepare와 commit은 각각 별도 operationId를 가지며 같은 단계의 재시도에서는 같은 ID를 유지한다. 사진 OFF 또는 미입력이면 서버가 번호이미지 저장을 수행한다.

사진 설정이 ON인데 촬영에 실패한 뒤 사용자가 번호이미지 대체를 고르면 `update-product-draft`를 호출한다. 이 action은 같은 actor와 workspace의 유효 초안인지 확인하고 기존 productId와 productCode 예약을 유지한 채 draft revision을 올린다. `imageFallbackConfirmed=true`는 실제 사용자 선택일 때만 허용한다. 사진 설정이 처음부터 OFF인 초안은 명시 대체 확인 없이 번호이미지를 쓸 수 있다. 완료되거나 만료된 초안은 변경하지 않는다. 재촬영은 같은 초안의 업로드 경로를 사용하며 사용자가 입력한 코드 때문에 새 초안과 자기 자신이 충돌하는 흐름을 만들지 않는다.

기존 상품 사진 수정은 `prepare-product-image`에서 받은 전용 경로에 먼저 업로드하고, 서버가 소유권과 파일을 확인해 발급한 imageId만 `preview-product-change.proposedProduct.imageId`로 보낸다. 클라이언트 임의 storage path는 받지 않는다. 취소·만료된 준비 이미지는 정리하고 이력에서 참조하는 이미지는 보존한다.

판매 API는 숫자·식별자·권한·설정·회차 상태·활성 상품과 revision을 모두 확인한다. 유효하지 않은 구매자 한 명이라도 있으면 배치 전체를 실패시키고 이유를 반환하는 방식을 1차 기본으로 한다. 일부만 저장한 뒤 전체 실패처럼 응답하지 않는다.

`get-sales-feed`는 새 댓글이 0건이어도 현재 summary, activeProduct, sessionRevision과 요청한 watchedBuyerIds의 buyerStats를 반환한다. Android는 화면과 선택 상태에 있는 구매자 ID만 보내며 최대 100개를 넘으면 페이지 또는 별도 조회로 나눈다. 늦게 도착한 과거 응답은 요청 generation과 session revision을 비교해 버린다. 새 댓글 커서가 통계 갱신을 막는 조건이 되어서는 안 된다.

`search-buyers`와 `confirm-buyer`는 음성의 애매한 닉네임과 수정 화면의 구매자 추가·교체에 함께 쓴다. 클라이언트가 임의 platform user ID를 만들어 보내는 것은 금지한다. 기존 검증 후보를 고르면 해당 ID를 사용하고, 후보가 없음을 판매자가 확인하면 별도 수동 구매자를 만든다. 과거 구매 이력 병합은 이 action의 부수효과로 실행하지 않는다.

`get-operation`의 NOT_FOUND는 그 operationId가 서버에 기록되지 않았다는 뜻이지 실패 저장의 확정이 아니다. 클라이언트는 로컬에 보존한 원래 action과 정규화 전 동일 본문을 같은 operationId로 다시 보낸다. 원래 본문이 없거나 달라졌으면 자동 재전송하지 않고 확인 필요로 둔다. 새 operationId로 같은 판매를 무작정 다시 만들지 않는다.

기기 목록 조회와 권한·출력 대상 변경은 workspace의 OWNER 또는 MANAGER만 할 수 있다. `set-output-device`는 해제되지 않은 PRINT 권한 기기인지 확인한다. 출력 대상 변경 중 진행 중인 작업은 원래 targetDeviceId를 유지하고, 변경 후 새 작업부터 새 대상을 쓰는 기본안으로 한다. 모든 권한과 출력 대상 변경에는 actor, 전후값, operationId와 시각을 남긴다.

## 7 공통 응답 예제

아래 문자열 ID는 구조 설명용이다. 실제 자동화 fixture에는 유효 UUID를 사용한다. 사진 URL은 임시 서명 URL이고 DB에는 storage path만 보관한다.

```json
{
  "ok": true,
  "apiVersion": 1,
  "serverTime": "2026-09-07T09:00:00.000Z",
  "data": {
    "activeSession": { "id": "session-uuid", "revision": 8, "status": "ACTIVE" },
    "activeProduct": {
      "id": "product-uuid", "productCode": "P-20260907-000123",
      "name": "123번 니트", "unitPrice": 20000,
      "imageKind": "PHOTO", "imageUrl": "signed-image-url",
      "revision": 2, "salesRevision": 0
    }
  }
}
```

```json
{
  "action": "commit-sales",
  "operationId": "operation-uuid",
  "sessionId": "session-uuid",
  "productId": "product-uuid",
  "expectedProductRevision": 2,
  "expectedSessionRevision": 8,
  "buyers": [
    { "buyerId": "buyer-a", "quantity": 2, "sourceCommentIds": ["comment-1", "comment-2"] },
    { "buyerId": "buyer-b", "quantity": 1, "sourceCommentIds": ["comment-3"] }
  ]
}
```

```json
{
  "ok": true,
  "apiVersion": 1,
  "serverTime": "2026-09-07T09:00:03.000Z",
  "data": {
    "operationId": "operation-uuid", "status": "SUCCEEDED",
    "sales": [
      { "id": "sale-a", "buyerId": "buyer-a", "quantity": 2, "unitPrice": 20000, "amount": 40000, "revision": 1 },
      { "id": "sale-b", "buyerId": "buyer-b", "quantity": 1, "unitPrice": 20000, "amount": 20000, "revision": 1 }
    ],
    "summary": { "sessionQuantity": 5, "sessionAmount": 100000 },
    "printJobs": [{ "saleId": "sale-a", "status": "QUEUED" }, { "saleId": "sale-b", "status": "QUEUED" }]
  }
}
```

위 summary에는 예전 상품의 판매 2개와 40,000원이 이미 있었던 테스트 상황을 전제로 한다. 원칙적으로 실제 API는 buyerStats도 반환한다. fixture에는 정확한 전체 스키마를 사용하고 예제의 생략값을 실제 필수값 누락으로 해석하지 않는다.

```json
{
  "ok": false,
  "apiVersion": 1,
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "다른 기기에서 상품이 변경되었습니다. 최신 내용을 확인해 주세요.",
    "retryable": false,
    "details": { "currentProductRevision": 3, "currentSessionRevision": 9 }
  }
}
```

| HTTP | error.code | 화면 처리 |
| --- | --- | --- |
| 401 | AUTH_REQUIRED 또는 DEVICE_REVOKED | 요청 중단, 재로그인 또는 재연결 안내 |
| 403 | CAPABILITY_DENIED | 권한 안내, 반복 재시도 금지 |
| 409 | REVISION_CONFLICT 또는 ACTIVE_PRODUCT_CHANGED | 입력 보존, 최신 데이터 조회, 다시 확인 |
| 409 | PRODUCT_CODE_EXISTS | 기존 상품 확인 또는 다른 번호 입력 |
| 409 | OPERATION_PAYLOAD_MISMATCH | 같은 operationId로 다른 요청을 보내지 않도록 구현 오류 확인 |
| 409 | COMMENT_ALREADY_COMMITTED | 이미 판매된 댓글 및 기존 판매 표시 |
| 410 | PREVIEW_EXPIRED 또는 DRAFT_EXPIRED | 미리보기 또는 등록 준비부터 재진행 |
| 422 | VALIDATION_ERROR 또는 PRICE_REQUIRED 또는 BUYER_UNRESOLVED | 필드 오류 표시, 자동 저장 중단 |
| 429 | RATE_LIMITED | Retry-After 또는 지수 지연 적용 |
| 503 | TEMPORARILY_UNAVAILABLE | 같은 operationId로 상태 조회 후 재시도 |

## 8 동시 저장과 중복 방지

서버는 operationId와 정규화 request hash를 같이 저장한다. 동일 요청이면 기존 성공 결과를 반환하고, 같은 ID에 다른 본문이면 409를 반환한다. 사용자·기기의 권한은 재시도 때도 재확인한다. operation 행의 unique 제약과 판매 처리를 같은 트랜잭션에서 다룬다. UI의 버튼 비활성화만으로 중복 방지를 구현하지 않는다.

댓글 등록은 같은 상품과 같은 댓글을 다시 처리하지 못하도록 근거 댓글 소비 관계에 유일 제약을 둔다. 별도 구매 의도로 같은 구매자에게 추가 판매하려면 새로운 댓글 또는 명시적 추가판매 동작과 새 operationId를 사용한다. 음성 인식은 provider event ID 또는 수신 sequence로 같은 최종 발화를 식별한다. 문장 문자열만으로 영구 중복 제거하지 않는다.

잠금 순서는 live_session, product, affected sales ID 오름차순으로 통일한다. 상품 등록·전환과 판매등록은 회차 revision을 검사한다. 가격·구매자 수정은 product revision과 sales_revision 및 대상 판매 revision을 검사한다. 미리보기 이후 한 건이라도 바뀌면 재확인한다. PostgreSQL RPC 하나에서 판매, 수정 이력, 상품 sales_revision, 출력 작업을 함께 처리해야 한다. Edge에서 여러 insert를 차례로 호출하는 방식은 원자적 저장이 아니다.

## 9 상품과 구매자 수정

수정 화면의 proposedSales는 각 행에 `saleId`, `expectedRevision`, 변경 구매자 ID, 수량 또는 취소 여부를 담는다. 추가 구매자는 `buyerId`, 수량, 명시적으로 선택한 근거 댓글 ID를 담는다. 같은 구매자의 다른 미선택 댓글은 자동으로 근거에 넣지 않는다. 상품사진을 바꾸면 proposedProduct에는 `prepare-product-image`가 발급한 imageId를 담는다. 서버가 변경 전과 변경 후의 모든 합계를 계산한다. 가격은 해당 회차 상품의 ACTIVE 판매 전체에 적용하고 CANCELLED 기록은 유지한다.

preview 응답은 영향받는 판매 ID, 구매자 표시명, 수량, 전후 단가·합계, 전체 증감, 기존 출력 여부, 정산서·입금·배송 연결 영향, 유효시간을 담는다. 사용자 확인 후 commit을 호출한다. 같은 수정 배치를 재시도해도 새 전표나 매출이 추가되지 않아야 한다.

수정으로 이미 보낸 정산서와 금액이 달라지면 원본 발송내역·입금기록을 보존하고 해당 연결을 재확인 필요로 표시한다. 이번 범위에서 문자 재발송, 환불, 배송 변경을 자동 실행하지 않는다. 상품 표시 정보만 수정한 경우도 새 snapshot과 정정 이력을 남긴다. 변경이 없는 저장에는 revision과 전표를 추가하지 않는다.

## 10 PC 전표 출력 계약

판매와 print_jobs를 함께 저장하고 PC 도우미가 작업을 가져간다. 웹과 Android는 별도의 로컬 printSale 요청을 중복 발행하지 않는다. 신규 경로로 전환한 작업공간에서는 기존 자동 인쇄 경로를 끈다. PRINT 권한이 있는 지정 기기만 claim할 수 있다.

기본 흐름은 QUEUED, CLAIMED, SUBMITTING, SUBMITTED이다. 실패는 FAILED, 실제 출력 여부를 확정할 수 없으면 UNKNOWN, 실행 전 구판 취소는 CANCELLED로 둔다. SUBMITTED는 Windows 인쇄 시스템에 접수되었다는 뜻이며 종이가 실제로 나온 것을 보장하지 않는다. UI에도 의미를 구분한다.

도우미는 쓰기 가능한 userData에 job ID, sale revision, payload hash, 처리단계를 영속 기록한다. claim lease는 30초, 처리 중 10초 heartbeat를 초기값으로 제안한다. 만료된 CLAIMED 작업은 재배정할 수 있지만 SUBMITTING 이후 결과가 불명확한 작업은 자동 재인쇄하지 않고 확인 필요로 돌린다. claim, begin, ack는 lease token 및 device ID를 검사한다.

실제 Windows spool 호출 직전 순서는 고정한다. 도우미가 로컬 journal에 준비 상태를 기록하고 `begin-print-job`을 호출하며, 서버가 lease·payload hash·sale revision을 검사해 SUBMITTING을 원자적으로 기록한 성공 응답을 받은 다음에만 spool에 보낸다. begin 응답이 유실되면 먼저 `get-print-status`로 서버 상태를 확인한다. 서버가 SUBMITTING인데 실제 spool 여부를 로컬 기록으로 확정하지 못하면 UNKNOWN으로 두고 자동 재출력하지 않는다. spool 접수 결과를 얻은 뒤 `acknowledge-print-job`으로 SUBMITTED 또는 FAILED를 기록한다. 이 경계 때문에 SUBMITTED도 종이 배출 보장이 아니라 Windows 접수 완료를 의미한다.

상품 가격이나 구매자 변경 때 아직 실행 전인 구판 작업은 취소하고 최신판으로 대체한다. 이미 접수된 구판은 회수했다고 표시하지 않는다. 수정분은 CORRECTION, 구매자 추가는 SALE, 구매자 제외는 CANCEL 전표로 출력한다. 수정 중 실행되는 작업의 순서는 상품 잠금·job 상태·revision으로 판정하고 원본과 정정의 연결을 기록한다.

전표에는 회차, 상품번호 또는 상품명, 구매자, 수량, 단가, 합계, 시각, 원본 또는 정정 표시, 판매 ID의 짧은 표시를 포함한다. 상품사진은 설정과 용지 크기에 맞춰 축소 지원한다. 50×30 용지에는 글자 가독성을 우선하고 번호이미지를 중복 인쇄하지 않는 기본안을 둔다. 정정은 이전값과 변경값 또는 변경요약을 보여준다. 사용자의 명시적 재출력만 새로운 REPRINT 작업을 만든다.

## 11 댓글과 이미지 전송

PC 수집기는 원본 user ID와 메시지 ID를 보존해 0.5초 단위 또는 최대 100건씩 묶어 ingest한다. 이는 초기 조정값이며 실측으로 확정한다. Android는 판매 탭이 보일 때 이전 요청 종료 후 약 1초 간격으로 cursor를 사용해 갱신한다. 탭 이탈 시 취소하고 SMS의 15분 JobScheduler와 분리한다. 실시간 이벤트는 갱신 힌트이며 재연결하면 서버 상태를 다시 읽는다.

댓글 표시 순서는 capturedAt 내림차순, 동률은 ingest_sequence 내림차순이다. 커서는 새 댓글 누락을 막는 불투명 서버 토큰이다. 신규 댓글 수집용 cursor와 과거 목록 페이지 cursor를 구분한다. 새 댓글이 와도 선택은 buyerId와 commentId로 유지하며 화면 행 번호를 저장하지 않는다. 현재 상품 변경 시 기존 선택의 가격을 조용히 바꾸지 않고 재확인한다.

이미지는 앱 전용 임시파일, private storage, 만료되는 서명 URL을 사용한다. 업로드용 URL은 인증된 draft 경로에만 발급한다. 기본 JPEG 긴 변 1280px, 최대 2MB를 제안한다. 번호이미지는 PNG로 저장한다. 상품등록 완료 전 서버가 경로 소유권·MIME·실제 파일·크기와 업로드 상태를 검증한다. draft 취소·만료 후 미참조 파일을 정리하되 판매나 수정 이력이 참조하는 이미지는 삭제하지 않는다.

## 12 에이전트가 먼저 확정할 계약 테스트 자료

`contracts/product-sales/v1/`에 정상 bootstrap, 댓글 feed, 판매 성공, 수정 preview와 성공, 권한 거절, revision 충돌, 응답 유실 재조회, 출력 대기·확인필요 예제를 만든다. 이 위치는 개발 시 생성할 예정 경로다. 금액 예제는 05_ACCEPTANCE_TESTS.md의 계산과 일치해야 한다.

API 명칭, 대소문자, 필수 필드, null 허용, 페이지 커서, 오류코드, max/min은 서버 구현 전에 fixture와 JSON Schema로 확정한다. Android의 FakeSalesRepository와 웹 테스트도 이 공통 fixture를 읽도록 하며 구성요소별로 다른 응답을 만들지 않는다. 계약을 바꾸면 버전 변경 또는 하위호환 규칙과 영향을 받는 서버·웹·Android·도우미 테스트를 함께 기록한다.

## 13 공식 참고자료

- Supabase DB 함수와 권한: https://supabase.com/docs/guides/database/functions
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Edge 인증 헤더: https://supabase.com/docs/guides/functions/auth-headers
- CameraX 촬영: https://developer.android.com/media/camera/camerax/take-photo
- CameraX 생명주기: https://developer.android.com/media/camera/camerax/architecture

최초 확인일은 2026년 9월 7일이다. 라이브러리 버전은 에이전트의 환경 검증 단계에서 실제 Gradle 또는 npm 조합으로 고정한다.
