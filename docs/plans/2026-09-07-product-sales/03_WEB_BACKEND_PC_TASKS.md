# 단일 에이전트 작업지시서: 공통 계약·웹·서버·PC 도우미

작성일 2026년 9월 7일 · 단일 에이전트 실행안 개정 2026년 9월 8일 · 작업 기준 [공통 계약](02_SHARED_CONTRACT.md) 버전 1

이 문서는 하나의 Antigravity 에이전트가 공통 계약, 웹, Supabase, PC 수집·인쇄 도우미를 구현하는 순서와 완료 기준이다. 현재 완료된 기능을 설명하는 문서가 아니다. Android 작업은 [Android 작업지시서](04_ANDROID_TASKS.md)에 따라 같은 에이전트가 별도 단계에서 수행한다. 상품·판매·수정·출력을 같은 서버 상태로 연결하는 것이 이번 작업의 완료 조건이다.

## 1 작업 범위와 시작 조건

- 수정 소유권: `src/`, `server/`, `supabase/`, `desktop/comment-helper/`, 신규 `contracts/product-sales/v1/`.
- 기존 로그인, STT 공급자, SMS·입금·정산서·배송 기능을 유지한다. 별도 Windows 정식 앱 제작은 이 작업에 포함하지 않는다.
- 먼저 공통 계약 전체를 읽는다. API action, 오류코드, 금액 범위, revision, 출력 상태를 임의로 바꾸지 않는다.
- 한 티켓씩 구현하고 완료 증거를 남긴다. 표의 신규 경로는 생성 예정이며 이미 존재한다고 가정하지 않는다.
- 운영 DB·Edge Function·릴리스 변경은 로컬 코드 작성과 별도 단계다. 실제 배포 전에 6절 검토 관문을 통과한다.
- 각 단계에서 브랜치·작업 트리·현재 배포 버전을 확인하고, 기존 변경과 사용자 작업을 보존한다.

## 2 기존 파일 지도와 신규 파일 계획

| 현재 파일 | 현재 역할과 확인할 지점 |
| --- | --- |
| `src/context/LiveContext.tsx` | 공급자별 전사 처리. 417행 Soniox 누적 timeout, 550행 완성 문장 처리, 752행 즉시 판매 저장을 공통 후보 흐름으로 연결 |
| `src/services/salesExtractor.ts`, `voiceCommandParser.ts` | 판매·금액·닉네임과 수정 명령 파싱. 새 상품 명령과 설정 기반 실행 계약을 통합 |
| `src/context/AppDataContext.tsx`, `src/pages/seller/RecognitionRulesPage.tsx` | 규칙 로컬/클라우드 저장과 설정 화면. 기존 DB_SAVE 규칙의 명시적 변환 필요 |
| `src/context/SalesContext.tsx` | 로컬 저장, 원격 upsert, 자동 출력이 섞임. 141행 이후 판매 생성과 인쇄 호출을 서버 API로 전환 |
| `src/services/remoteWorkspaceService.ts` | 21행 판매 매핑, 57행 저장 매핑, 445행 upsert. DB revision을 읽고 쓰는 새 계약 필요 |
| `src/context/CommentCaptureContext.tsx` | 128행 닉네임·본문 중복 제거, 135행 새 댓글 ID 생성. 클라우드 원본 댓글 ID와 구매자 ID로 전환 |
| `src/services/commentStreamService.ts`, `src/types/comment.ts` | PC localhost 댓글 연결과 직접 printSale. Android용 연결로 재사용하지 않음 |
| `src/types/live.ts`, `src/pages/seller/SalesDetailPage.tsx` | 판매 타입과 수정 화면. 상품 ID·수량·단가·revision·취소 상태 추가 |
| `src/context/AuthContext.tsx`, `src/services/supabaseClient.ts` | 기존 Supabase 인증과 workspace 선택 재사용 |
| `supabase/functions/_shared/voicecap.ts`, `device-pair/index.ts` | 사용자·기기 인증, workspace 확인, 페어링. 장치 capability 확장 |
| `supabase/migrations/202608300001_initial_multitenant.sql` | 기존 sales/RLS/기기·SMS lease 구조. 새 migration을 추가하며 과거 파일 수정으로 대체하지 않음 |
| `server/index.js` | 400행 원본 메시지 ID·플랫폼 user ID를 송신. 클라우드 수집 worker 연결 |
| `desktop/comment-helper/main.cjs`, `preload.cjs`, `ui/print.*` | Windows 출력·프린터 설정·IPC. 영속 작업 처리와 상품 전표 확장 |
| `desktop/comment-helper/scripts/stage-server.cjs`, `package.json` | 서버 파일 스테이징·설치 리소스·버전·빌드. 새 worker 누락 여부 확인 |

신규 예정 경로: `src/types/productSales.ts`, `src/services/productSalesApi.ts`, `src/services/voiceSaleCandidate.ts`, `src/context/ProductSalesContext.tsx`, `src/components/live/ProductRegistrationPreview.tsx`, `src/pages/seller/ProductSalesPage.tsx`, `src/pages/seller/DeviceManagementPage.tsx`.
신규 예정 경로: `supabase/functions/sales-api/index.ts`, `supabase/functions/_shared/productSales.ts`, 날짜별 추가 migration, `server/cloudCommentPublisher.js`, `desktop/comment-helper/cloudPrintWorker.cjs`, `desktop/comment-helper/printJobStore.cjs`.
신규 예정 경로: `contracts/product-sales/v1/`의 JSON Schema·fixture·설명, 관련 의미 있는 테스트 파일. 실제 생성 이름을 바꾸면 작업지시서의 매핑도 갱신한다.

## 3 순서와 티켓

[Android 작업지시서](04_ANDROID_TASKS.md)의 `ANDROID-01`에서 기존 Android·SMS 기준을 먼저 기록한다. 이어서 `CORE-01` → `CORE-02` → `CORE-03` → `CORE-04` → `CORE-05`를 완료해 모든 클라이언트가 사용할 계약과 서버 기반을 고정한다. 이후 `ANDROID-02`부터 `ANDROID-06`까지 fixture 기반 작업을 수행한 뒤 이 문서의 `CORE-06`으로 돌아온다. `CORE-09`의 금액 수정과 `CORE-10`의 출력은 반드시 함께 통합 검증한다.

### CORE-01 계약 fixture와 경계 확정

선행 조건: 공통 계약 전체를 읽고 서버·웹·Android 관점에서 응답 형식, null, 필수 필드를 대조했다.

1. 신규 `contracts/product-sales/v1/`에 요청·응답 JSON Schema와 정상/오류 fixture를 만든다.
2. 모든 예제 ID는 유효 UUID를 사용한다. 기존 text sale ID와 새 UUID 상품 ID의 구분을 유지한다.
3. bootstrap, 상품 준비/확정, 댓글 feed, 판매 저장, 수정 preview/commit, 출력 작업의 전체 응답을 제공한다.
4. 공통 action 이름을 그대로 쓴다. 특히 `commit-sales`, `preview-product-change`, `commit-product-change`를 별도 명칭으로 만들지 않는다.
5. `operationId`, request hash, `expectedProductRevision`, `expectedSessionRevision`, `expectedSalesRevision`, 각 sale revision의 역할을 예제에 표시한다.
6. 댓글 cursor의 신규 조회/과거 페이지 구분과 `renew-print-lease`의 요청·응답을 fixture에 포함한다.
7. 동일 구매자 댓글 두 개·수량 1, 수량 2, 가격 일괄 수정, 응답 유실 후 조회, UNKNOWN 출력 예제를 만든다.
8. 공통 계약과 인수 테스트의 금액 계산을 대조하고 Android FakeSalesRepository 입력 자료로 사용할 수 있게 구성한다.
9. requestedProductCode의 `0007` 보존·예약 번호 재사용 거절, draftRevision 변경, imageFallbackConfirmed, 기존 상품사진 imageId 참조 fixture를 만든다.
10. MANUAL_CONFIRMED 구매자, watchedBuyerIds 통계만 바뀌는 빈 댓글 응답, get-operation NOT_FOUND, 기기 권한 변경, begin-print-job과 수정 경쟁을 fixture에 포함한다.

산출물: Schema·fixture·변경 이력, 웹·Android·도우미별 필드/오류 처리표, 필수값이 빠진 fixture를 거절하는 검증 실행 방법.

완료 확인: 서버·웹·Android 모델 관점에서 같은 fixture의 합계·수량·오류를 대조했고, 임의 응답이나 실토큰이 fixture에 없다.

검토 C1: 구현과 분리된 검토 턴에서 Schema·fixture·action·오류·cursor·계산식을 다시 대조한 뒤 후속 티켓을 시작한다. 변경 필요 시 코드보다 문서·Schema·fixture를 먼저 함께 수정한다. 일정 문서의 G0~G4와 이 문서의 C1~C4는 다른 표기다.

### CORE-02 추가 migration과 데이터 무결성

선행 조건: CORE-01 완료. 개발 DB와 운영 DB를 구별하고 기존 row 수·관계·권한을 읽기 전용으로 확인했다.

1. 새 migration에 `live_sessions`, `products`, `buyers`, `live_comments`, `sale_revisions`, `operations`, `product_change_previews`, `print_jobs`를 정의한다.
2. `product_drafts`, `product_code_reservations`, `sale_comment_sources`를 추가해 revision 있는 초안·번호 예약·댓글 소비 unique 제약을 실제 저장 구조로 만든다.
3. 기존 sales ID는 유지한다. quantity는 1, unit_price는 기존 amount, source는 LEGACY로 채우고 product_id/buyer_id는 추측해 연결하지 않는다.
4. `record_state=ACTIVE`와 기존 한국어 status를 분리한다. 신규 타입·읽기 매핑에서 revision을 빠뜨리지 않는다.
5. ACTIVE 회차의 workspace별 부분 unique, 예약표의 workspace/code unique, 현재 상품코드 unique, operation ID unique, 댓글 원본 ID unique를 둔다.
6. 새 관계에는 workspace 일치를 강제하는 복합 외래키 또는 동등한 서버 검증을 둔다. 다른 판매자의 상품·구매자 연결을 차단한다.
7. 단가·수량·합계 범위를 CHECK와 RPC에서 검증한다. amount는 서버가 곱해서 계산하며 클라이언트 합계를 신뢰하지 않는다.
8. `products.sales_revision` 증가와 조회 인덱스를 정의한다. 집계는 ACTIVE 판매 SQL 합계로 시작한다.
9. 상품 번호를 예약표에서 원자적으로 확보한다. 초안·취소·만료·변경 전 번호도 재사용하지 않으며 단말 시각이나 UUID 일부로 발급하지 않는다.

산출물: 추가 migration, 개발 DB 적용 기록, 구데이터 보존 확인 쿼리, 인덱스·제약 설명.

완료 확인: migration을 빈 개발 DB와 기존 데이터 복제 개발 DB에서 검증하고, SMS·정산서·배송의 sale 참조가 유지된다.

### CORE-03 인증·RLS·sales-api 기본 구조

선행 조건: CORE-02와 C1 완료. 기존 사용자 인증·기기 토큰 흐름을 이해했다.

1. 신규 `sales-api` Edge Function을 만들고 `get-bootstrap`부터 구현한다. 응답은 apiVersion 1과 공통 envelope를 따른다.
2. 웹 Bearer와 기기 토큰을 구분해 검증하고 workspace·actor를 서버에서 결정한다. 클라이언트 sellerId를 권한으로 사용하지 않는다.
3. 기기에 SALES_READ, SALES_WRITE, PRODUCT_WRITE, COMMENT_INGEST, PRINT 권한을 추가한다. 기존 SMS 기기에 자동 부여하지 않는다.
4. 새 테이블·private 이미지 경로에 RLS와 권한을 설정한다. 원시 operations/lease/preview 데이터는 일반 클라이언트에 공개하지 않는다.
5. 쓰기 RPC는 공개 EXECUTE를 회수하고 service_role 전용으로 둔다. SECURITY DEFINER는 고정 search_path와 최소 권한을 검토한다.
6. Edge는 매 action마다 인증·권한을 확인한 뒤 actor를 RPC로 넘긴다. service-role을 웹·도우미·Android 설치 파일에 넣지 않는다.
7. `supabase/config.toml`의 신규 함수 verify_jwt와 내부 인증을 맞춘다. 기기 토큰 CORS 헤더도 확인한다.
8. `get-operation`을 구현하고 동일 operationId의 다른 payload는 OPERATION_PAYLOAD_MISMATCH로 거절한다.
9. 단계적 전환 전에는 구기능 호환성을 유지하되, 전환한 workspace의 상품 판매 직접 upsert를 차단할 권한 정책을 준비한다.
10. `list-devices`, `update-device-capabilities`, `set-output-device` API와 웹 기기관리 화면을 구현한다. 관리자의 명시적 확인·권한 검증·변경 이력을 남기고 기존 SMS 기기에는 판매 권한을 자동 추가하지 않는다.

산출물: sales-api 기본 라우팅, 권한표, RLS·RPC 실행 권한, 인증 실패 fixture와 테스트.

완료 확인: 다른 workspace ID, 폐기 기기, SMS 전용 기기, 무인증 요청이 모두 적절히 차단된다. 운영 비밀값이 출력되지 않는다.

### CORE-04 설정·회차·상품등록 API

선행 조건: CORE-03 완료. 번호이미지를 만들 런타임과 private storage 제한을 확인했다.

1. `update-settings`에 expectedRevision을 적용하고 명령 단어의 서로 다른 동작 중복을 거절한다.
2. `start-session`, `end-session`을 구현한다. 탭 이동·STT 정지·재접속은 현재 회차 조회로 복구한다.
3. `prepare-product`는 requestedProductCode를 숫자문자열로 받아 선행 0을 보존하며, 없으면 서버 번호를 발급한다. 예약표와 product_drafts에 번호·UUID·업로드 경로·15분 만료·draftRevision을 저장하고 아직 판매 가능한 상품은 만들지 않는다.
4. prepare와 commit의 operationId는 서로 다르게 사용하며 같은 단계의 재시도에는 기존 ID를 유지한다.
5. `commit-product`에서 expectedDraftRevision, MIME·크기·경로 소유권·실제 이미지 존재를 확인한 뒤 상품 확정과 활성 상품 변경을 한 transaction으로 처리한다.
6. 사진 OFF는 번호이미지를 사용한다. 사진 ON의 촬영 실패·미입력은 자동 저장을 멈추고 대체 확인을 받는다. `update-product-draft(operationId, draftId, expectedDraftRevision, imageKind, imageFallbackConfirmed)`로 기존 productId/productCode 예약을 유지하며 변경한다.
7. `activate-product`는 같은 workspace·회차·expectedSessionRevision을 확인하고 기존 후보/선택이 상품 변경을 감지할 수 있게 응답한다.
8. 상품등록만으로 sales, 매출, 구매횟수, print_jobs가 생기지 않도록 검증한다.
9. 기능 OFF 기본안, 사진 OFF 번호이미지, 상품명 OFF 자동번호를 공통 계약대로 적용한다. 과거 상품을 소급 삭제하지 않는다.
10. draft 만료·취소의 미참조 파일만 정리한다. 상품·판매 snapshot·수정 이력에서 참조하는 이미지는 정리 대상에서 제외한다.
11. 번호이미지에는 확정 예약 번호를 쓰고 이미지와 번호가 다르면 성공 처리하지 않는다. update-product-draft는 revision을 증가시키며 완료·만료 draft 변경과 오래된 draftRevision을 거절한다. 실패 대체를 위해 prepare를 새로 호출하지 않는다.

산출물: 설정·회차·상품 API, 저장 경로/만료 정책, 이미지 검증과 번호 발급 테스트.

완료 확인: 사진만/이름만/가격 null 상품, `0007` 보존, 중복·과거 번호 재사용 거절, 촬영 실패 대체 확인, draft 만료·재시도·충돌, 동시 상품 전환이 계약대로 처리된다.

### CORE-05 클라우드 댓글·구매자 식별·feed

선행 조건: CORE-03·CORE-04 완료. 한 회차의 수집 담당 PC와 collector ID 정책을 정했다.

1. server/index.js에서 받은 원본 메시지 ID, 안정 user ID, uniqueId를 보존해 cloudCommentPublisher에 넘긴다.
2. 0.5초 또는 최대 100건 단위로 `ingest-comments`를 호출한다. 전송 전 대기 데이터를 writable userData에 보관하고 서버 수락 후 제거해 재시작에도 같은 원본 ID로 재시도한다.
3. 한 회차의 수집 담당자만 ingest하도록 서버가 검증한다. 재연결 때 collector ID를 새로 만들어 중복 회피하지 않는다.
4. user ID 우선, 검증 uniqueId 다음으로 buyer를 찾는다. 닉네임만 같으면 합치지 않고 미확인 buyer로 남긴다.
5. 닉네임·본문이 같아도 원본 ID가 다르면 댓글을 보존한다. 동일 원본만 duplicateIds로 응답한다.
6. `get-sales-feed`는 watchedBuyerIds 최대 100개를 검증하고 댓글, 해당 buyerStats, summary, activeProduct, sessionRevision, cursor를 제공한다. 새 댓글이 0개여도 수정된 통계·상품 상태를 응답한다.
7. capturedAt·ingest_sequence 정렬과 신규/과거 cursor를 구분한다. 지연 도착·동일 시각 댓글을 빠뜨리지 않도록 fixture로 검증한다.
8. 웹의 CommentCaptureContext를 서버 ID 중심으로 바꾸고 선택은 buyerId/commentId로 유지한다. 화면 행 번호는 저장하지 않는다.
9. 도우미가 직접 업로드하게 구성해 웹창을 닫아도 Android가 댓글을 볼 수 있게 한다. Android에서 PC localhost 접근을 요구하지 않는다.
10. `search-buyers`, `confirm-buyer` API와 웹 구매자 확인 화면을 만든다. 판매자의 명시적 확인으로 MANUAL_CONFIRMED를 기록하며 선택한 buyer/판매만 연결한다. 닉네임 일치로 전체 과거 기록을 자동 병합하지 않는다.

산출물: 수집 worker, ingest/feed API, 기존 로컬 댓글 전환 매핑, 중복·재접속 테스트.

완료 확인: 동일 구매자 반복 댓글은 여러 댓글로 표시되고 구매자 선택은 한 명·기본 수량 1이다. 다른 기기에서 같은 feed와 합계를 읽는다.

### CORE-06 웹 상품·규칙 화면과 2.5초 후보

선행 조건: CORE-04·CORE-05와 ANDROID-01~ANDROID-06 완료. 저장 API는 CORE-07 fixture로 먼저 연결할 수 있다.

1. 신규 ProductSalesContext와 상품 등록 미리보기에서 현재 회차·활성 상품·사진/번호이미지·가격을 표시한다.
2. 상품등록/상품캡처/상품번호·상품명/가격·금액/판매완료·구매확정/닉네임을 같은 설정 기반 명령 해석기로 연결한다.
3. 기존 DB_SAVE/SCREEN_CAPTURE/DB_SAVE_AND_CAPTURE 규칙을 변환표로 다룬다. 예전 하드코딩 트리거가 새 규칙을 우회하지 않게 한다.
4. Deepgram, Soniox, Web Speech, 로컬 Whisper의 최종 이벤트를 공통 후보 생성기로 보낸다. Soniox 별도 즉시 addSale 경로도 제거한다.
5. 후보는 상품등록 또는 판매로 구분하고 sessionId, productId, revision, provider event ID/수신 sequence를 고정한다.
6. 상태는 편집 중, 유효 미리보기, 저장 중, 저장 완료, 오류/취소를 구분한다. 유효 후보 완성 후 기본 2500ms부터 카운트한다.
7. 수정 중에는 카운트다운을 멈추고 유효값 확정 후 다시 시작한다. 중간 전사·같은 최종 이벤트가 새 후보를 중복 생성하지 않게 한다.
8. 로그아웃·회차 종료·후보 취소·기기 권한 상실 때 타이머를 무효화한다. 상품 변경은 기존 후보를 새 상품으로 조용히 옮기지 않는다.
9. 가격 미입력·미확인 구매자는 자동 판매 저장을 막고 이유를 표시한다. 검색·명시 확인으로 VERIFIED 또는 MANUAL_CONFIRMED buyer를 선택한 뒤 재확인한다. 상품등록 후보에는 구매자가 필요하지 않다.
10. 웹 상품캡처는 사용자가 연결한 화면의 상품 영역에서 만든다. 기존 댓글 증빙 캡처와 별도 경로로 저장하고 촬영 결과·번호이미지를 미리보기에서 확인한다.

산출물: 후보 상태 모듈, 설정/상품 UI, 공급자 연결, 시간·취소·중복 이벤트 테스트.

완료 확인: 각 공급자에서 같은 멘트가 같은 후보로 보이며, 2.5초 이전 수정·취소와 상품 전환이 잘못된 매출/인쇄를 만들지 않는다.

### CORE-07 판매 일괄 확정 transaction

선행 조건: CORE-02부터 CORE-05까지 완료. 구현과 분리된 검토 턴에서 DB transaction과 unique 충돌 처리안을 다시 확인했다. 고위험 DB 설계에는 경험자 추가 검토를 권장한다.

1. `commit-sales`의 구매자 목록을 서버에서 검증한다. 같은 buyer의 여러 댓글은 한 행으로 합치고 수량은 지정값·기본 1로 처리한다.
2. session ACTIVE, 활성 상품, 설정, expectedSessionRevision, expectedProductRevision, buyer 신원, 근거 댓글 소유권을 확인한다.
3. 하나라도 유효하지 않으면 배치 전체를 실패시킨다. 성공한 일부 행과 전체 실패 응답이 섞이지 않게 한다.
4. 잠금 순서는 live_session → product → 기존 affected sales ID 오름차순으로 통일한다.
5. operations request hash/중복 판정, 판매, sale_comment_sources, products.sales_revision 증가, print_jobs 생성, 성공 응답 저장을 RPC 하나로 묶는다.
6. 단가·수량으로 amount를 서버에서 계산하고 상품·구매자 표시 snapshot을 고정한다. 클라이언트가 보낸 합계는 사용하지 않는다.
7. 동일 상품에서 이미 소비한 댓글은 COMMENT_ALREADY_COMMITTED로 기존 판매를 안내한다. 새 operationId만으로 중복 소비하지 못하게 한다.
8. 판매 직후 summary·buyerStats를 서버에서 계산한다. UI는 서버 성공 응답 전에는 예상값만 표시한다.
9. 응답 유실 시 `get-operation`을 먼저 조회한다. NOT_FOUND면 저장된 같은 operationId·같은 본문으로 재전송하고, PROCESSING이면 조회를 이어간다. SUCCEEDED는 기존 결과를 사용하며 새 ID로 중복 저장하지 않는다.

산출물: 판매 transaction RPC, Edge action, 오류 fixture, 동시에 실행하는 중복·경쟁 조건 테스트.

완료 확인: 2명 구매자 배치의 반복 요청이 2개 판매·2개 원본 출력 작업만 만들고 금액/수량은 한 번만 증가한다.

### CORE-08 판매 조회·웹 합계·구매자 통계

선행 조건: CORE-07 완료. 구기록의 buyerId 미연결 범위를 제품 검토자가 확인했다.

1. `list-session-products`, `get-product-sales`를 구현하고 현재 상품과 판매된 상품을 같은 ID로 탐색한다.
2. 판매 타입에 quantity, unitPrice, productId, buyerId, revision, recordState와 snapshot을 추가한다. 이름/사진을 키로 쓰지 않는다.
3. 서버 ACTIVE 판매 기준 SUM(quantity), SUM(amount)로 회차·구매자 합계를 계산한다.
4. 누적구매횟수는 ACTIVE 판매 행 수다. 수량 2인 한 행은 1회이며 댓글 두 개도 2회로 세지 않는다.
5. 동일 구매자 댓글 여러 개 선택 시 수량 입력은 하나만 표시하고 기본값을 1로 둔다.
6. 구매자 목록의 확정값과 선택 예상값을 분리한다. 댓글 수신만으로 판매 합계를 올리지 않는다.
7. 기존 닉네임뿐인 판매는 자동 buyer 연결 없이 미분류·연결 전 범위를 안내한다. confirm-buyer에서 선택한 연결만 통계에 반영하고 전체 역사 병합으로 확대하지 않는다.
8. 서버 변경/재접속 때 최신 응답을 조회하고 이전 요청의 늦은 응답으로 새 session/상품 화면을 덮어쓰지 않게 한다.
9. 화면에 표시하거나 선택한 구매자는 watchedBuyerIds로 보내고 댓글 배열이 비어도 buyerStats·summary를 갱신한다. 댓글 없음과 통계 변경 없음은 다른 상태다.

산출물: 상품별 판매 화면, 통계 API와 UI, 합계 fixture 대조표.

완료 확인: 웹과 Android 화면이 동일 fixture·실서버에서 같은 수량/합계/구매횟수를 보인다.

### CORE-09 상품·가격·구매자 수정 preview와 commit

선행 조건: CORE-07·CORE-08 완료. 정산서·입금·배송의 연결 영향 표시 정책을 확인했다.

1. 기존 상품 사진 교체는 `prepare-product-image`가 발급한 private 업로드에 저장하고 imageId로 preview를 참조한다. `preview-product-change`는 이미지 소유권·검증 상태, proposedProduct/proposedSales, expectedProductRevision/expectedSalesRevision을 검증한다.
2. 기존 sale의 expectedRevision, 구매자 변경·수량 변경·제외, 추가 구매자의 근거를 검증하고 서버가 전후 총액을 계산한다.
3. 상품 단가 변경은 해당 상품의 ACTIVE 판매 전체에 적용한다. CANCELLED 기록과 다른 회차 상품은 변경하지 않는다.
4. preview에 영향 구매자·판매 ID·수량·전후 단가/합계·증감·출력 여부·정산/입금/배송 영향·만료시각을 담는다.
5. previewToken은 서버에서 발급해 actor·workspace·product revision·sales_revision·대상 행 revision에 연결하고 원문 대신 hash를 저장한다.
6. `commit-product-change`는 잠금을 잡고 preview 뒤 판매 추가/변경 여부를 재검증한다. 하나라도 달라졌으면 REVISION_CONFLICT로 새 확인을 요구한다.
7. 상품 변경·sales 갱신/취소/추가·sale_revisions·sales_revision·새 출력 작업·operation 결과를 한 transaction으로 처리한다.
8. 기존 sale ID를 유지한다. 제외는 CANCELLED이며 물리 DELETE하지 않는다. 변경이 없으면 revision과 전표를 추가하지 않는다.
9. 상품 이름/사진의 활성 판매 snapshot도 계약대로 변경하고 이전 값은 이력에 남긴다. 정산서·입금 증빙 원본은 보존하고 재확인 필요로 표시한다.
10. 문자 재발송·환불·배송 변경은 자동 실행하지 않는다. 늦게 끝난 캡처 업로드가 최신 판매 수정값을 덮어쓰지 않게 한다.
11. 번호 변경도 product_code_reservations를 사용해 새 번호를 확보하고 이전 번호는 보존한다. 사진 업로드 성공만으로 상품을 변경하지 않으며 imageId는 확인된 preview/commit에서만 적용한다.

산출물: 수정 preview/commit RPC·UI, 변경 이력, 연결 영향 표시, stale preview/동시 수정 테스트.

완료 확인: 20,000원·수량 2와 1을 25,000원으로 변경하면 총 60,000원에서 75,000원으로 바뀌고 새 매출 행으로 이중 계산되지 않는다.

### CORE-10 서버 출력 작업과 도우미 영속 큐

선행 조건: CORE-07·CORE-09 완료. 개발용 페어링 기기와 실제 프린터 또는 인쇄 대체 장치를 준비했다.

1. `claim-print-jobs`, `renew-print-lease`, `begin-print-job`, `acknowledge-print-job`, `get-print-status`, `request-reprint`를 공통 action 이름으로 구현한다.
2. PRINT 권한·지정 기기·lease token을 검사한다. 초기 lease 30초, 처리 중 10초 heartbeat로 갱신한다.
3. QUEUED → CLAIMED → SUBMITTING → SUBMITTED를 영속 관리하고 실패 FAILED, 결과 불명 UNKNOWN, 실행 전 구판 CANCELLED를 구분한다.
4. 신규 printJobStore는 writable userData에 job ID·payload hash·sale revision·처리단계를 원자적으로 기록한다. 저장 실패 후 인쇄를 계속하지 않는다.
5. `begin-print-job(jobId, leaseToken, payloadHash, expectedSaleRevision)`가 서버에서 소유권·유효 revision을 확인하고 SUBMITTING을 원자적으로 기록한 성공 응답을 받은 뒤에만 spool에 제출한다. 로컬 SUBMITTING 기록만으로 출력하지 않는다.
6. 만료된 CLAIMED만 안전하게 재배정한다. 동일 job 재전달은 기존 기록을 조회하며 새 물리 출력으로 바로 연결하지 않는다.
7. 수정 transaction과 claim의 동시 실행을 검토한다. 실행 전 구판은 취소·대체, 이미 접수된 구판은 CORRECTION 또는 CANCEL로 연결한다.
8. 추가 구매자는 SALE, 의도적인 재출력만 REPRINT를 생성한다. timeout 재시도와 사용자의 재출력을 구별한다.
9. 전표를 상품·구매자·수량·단가·합계·회차·시각·원본/정정 표시로 확장한다. 50×30은 글자 가독성을 우선하고 사진은 용지별 검증한다.
10. updater/완전 종료가 SUBMITTING 작업을 중단하지 않게 하고 시작 시 미완료 작업을 복구한다. SUBMITTED를 종이 출력 완료라고 표시하지 않는다.
11. begin 성공 응답 유실 또는 SUBMITTING 이후 결과 불명확은 UNKNOWN/확인 필요로 다룬다. 서버가 SUBMITTING이라는 이유만으로 자동 재출력하지 않는다. begin과 가격 정정/lease 재배정의 경쟁에서 오래된 작업을 차단한다.

산출물: 출력 API, cloudPrintWorker·printJobStore, 프린터 상태 UI, 전표 템플릿, 중단/재전달/lease 경쟁 테스트.

완료 확인: 웹창 없이 Android 저장→PC 접수가 가능하며 2대 PC가 같은 job을 동시에 출력하지 않는다. 불명확한 물리 출력은 확인 필요로 남는다.

### CORE-11 구경로 전환과 패키징

선행 조건: CORE-06부터 CORE-10과 ANDROID-07부터 ANDROID-10까지 통합 완료. workspace별 전환 상태와 지원 도우미 버전을 서버가 판단할 수 있다.

1. 신규 모드의 SalesContext를 sales-api 응답 중심으로 바꾼다. saveSale 직접 upsert와 addSale 직후 printSale를 함께 끈다.
2. 원격 판매 갱신 이벤트에서 별도 출력 요청을 만들지 않는다. Realtime은 조회/대기열 갱신 힌트로만 사용한다.
3. 구형 판매모드와 productId=null 구기록을 읽을 수 있게 유지하고, 전환 workspace의 직접 상품 판매 쓰기는 DB 권한으로 차단한다.
4. 기존 한국어 status·print_status를 새 record_state/job 상태와 명시적으로 매핑한다. PRINTED와 SUBMITTED의 의미를 섞지 않는다.
5. 기존 localStorage 내용이 최신 클라우드 목록을 덮어쓰지 않게 한다. 로그인/작업공간 변경 시 후보·선택·조회 캐시 경계를 검증한다.
6. stage-server.cjs에 신규 서버 모듈을 포함하고 package.json files에 신규 도우미 모듈이 들어가는지 실제 unpacked 산출물을 확인한다.
7. 설치 리소스와 writable userData를 분리한다. 키·토큰이 설치 파일, runtime-config, fixture, 콘솔에 포함되지 않게 점검한다.
8. helper 기존 appId/업데이트 경로를 무심코 새 제품으로 바꾸지 않는다. 버전·전환 capability·배포 설명에 실제 변경만 기록한다.

산출물: 구/신 경로 전환표, 설치 산출물 검증 기록, 최소 지원 버전과 복구 절차.

완료 확인: 전환한 workspace는 판매 한 번에 서버 job만 생성하고 로컬 직접 인쇄가 중복 실행되지 않는다. 기존 SMS 기능도 유지된다.

### CORE-12 배포 준비·전체 연동·인수

선행 조건: 6절 C2·C3 통과. 실제 운영 배포 권한과 대상 Supabase project를 확인했다.

1. 개발 환경에서 migration → RPC/RLS → sales-api → 도우미 → 웹 → Android 연동 순으로 검증한다.
2. API 주소·apiVersion·fixture 버전·권한 설정 방법·테스트 계정/기기의 안전한 사용 경로를 작업 기록에 남기고 Android 실제 연결 설정과 대조한다.
3. 운영 배포는 DB 백업/적용 계획 확인 → 추가 migration → Edge Function 별도 배포 → 권한/응답 확인 순으로 진행한다.
4. 호환 가능한 도우미와 웹을 먼저 배포하고, 선택한 시험 workspace만 신규 흐름을 켠 뒤 Android와 함께 검증한다.
5. Vercel 웹 배포가 Supabase migration이나 sales-api를 배포한다고 가정하지 않는다. 각각 적용 버전·명령 결과·환경을 기록한다.
6. 문제 발생 시 신규 쓰기 진입을 제어하고 이미 생성된 print_jobs를 먼저 확인한다. 큐 삭제·과거 DB 복원으로 인쇄 상태를 지우지 않는다.
7. 적용 migration을 급히 drop하거나 기존 sales ID를 되돌리지 않는다. 수정 migration과 호환 코드 배포로 복구 계획을 검토한다.
8. 수동 인수 시나리오를 별도 검증 턴으로 실행하고 화면·서버 행·operation·job의 ID와 합계를 대조한다.

산출물: 환경별 배포 기록, smoke 결과, Android 연동 기록, 운영 복구 안내, 완료·운영 문서 갱신.

완료 확인: 아래 수동 인수와 C4를 통과했다. 로컬 build 성공만으로 전체 기능 완료라고 보고하지 않는다.

## 4 반드시 함께 할 수동 인수

- 같은 구매자 댓글 두 개 선택 → 구매자 한 명/수량 1 → 수량 2로 수정 → 20,000원 상품 합계 40,000원 → 전표도 동일.
- 다른 구매자 수량 1 추가 → 합계 60,000원 → 단가 25,000원 변경 preview → 두 구매자 합계 75,000원 확인 → 기존 판매 갱신·정정 작업 확인.
- preview 표시 중 다른 기기에서 구매자 추가 → 기존 preview commit 거절 → 최신 범위 재확인. 변경 전 화면으로 덮어쓰지 않음.
- 상품등록만 실행 → 상품/활성 상품만 생성되고 판매수량·매출·구매횟수·전표는 그대로 유지.
- 음성 후보 2.5초 동안 수정·취소·상품 전환·로그아웃 → 잘못된 자동 저장 없음. 각 STT 공급자에서 반복.
- 인터넷 응답 유실 뒤 같은 operationId 재시도 → 같은 sale ID/job ID 반환. 새 구매 의도는 새 operationId와 근거로 등록.
- PC 수집기 재접속·중복 ingest·반복 “저요” → 동일 원본만 제거되고 구매자 선택은 유지. 닉네임 동명이인은 별개.
- 웹창 닫기 → Android 저장 → 지정 PC 출력 접수. 도우미 오프라인이면 QUEUED 유지 후 복구.
- spool 제출 직후 도우미 종료·ack 유실 → UNKNOWN/확인 필요. 자동 재인쇄하지 않고 명시적 REPRINT만 새 작업 생성.
- 기존 SMS 송수신·입금·정산서·배송 참조 유지. 가격 정정 후 원본 증빙 보존과 재확인 필요 표시 확인.
- `0007` 등록·취소·번호 변경 후 옛 번호 재사용 거절. 사진 실패를 확인 후 같은 draft·예약 번호로 대체하고 오래된 draftRevision은 거절.
- 기존 상품사진 private 업로드 → imageId preview → 확인 전 상품 불변 → commit 후 snapshot·전표 갱신. 다른 workspace imageId는 거절.
- 구매자 검색·MANUAL_CONFIRMED 명시 확인 → 선택 대상만 연결. 댓글 0개 feed에서도 watchedBuyerIds 통계가 최신 값으로 변경.
- get-operation NOT_FOUND → 같은 ID·본문 재전송 → 한 번 저장. 기기관리 권한 없는 변경·구형 SMS 기기의 판매 요청은 거절.
- begin-print-job 직전 정정·lease 재배정 → 구판 spool 금지. 서버 begin 성공 응답 유실 → 자동 출력 재시도 금지·확인 필요.

## 5 실행 확인과 증거

웹은 저장소 루트에서 `npm run build`, 서버는 `server/`에서 `npm test`, 도우미는 `desktop/comment-helper/`에서 `npm test`를 실행한다. 새 테스트는 실제 추가한 명령을 README에 기록한다. 현재 루트 package.json에는 별도 test script가 없으므로 존재하지 않는 명령을 완료 기록에 쓰지 않는다.

DB 검증에는 cross-workspace, 권한 없는 device, 동일 operation 동시 호출, stale preview, 새 판매와 가격 변경 경쟁, claim과 정정 경쟁을 포함한다. 유닛 테스트로 물리 프린터나 운영 RLS 검증을 대체하지 않는다. 테스트마다 대상 환경·입력 ID·예상값·실제값을 기록하고 개인정보/토큰은 가린다.

## 6 검토 관문과 완료 보고

- C1 계약: 구현과 분리된 검토 턴에서 Schema·fixture·action·오류·cursor·계산식을 확인한 뒤 구현 시작.
- C2 서버: migration/RLS/service-only RPC/잠금 순서/operation 중복/preview 경쟁을 테스트와 검토 체크리스트로 확인한 뒤 시험 환경 배포. 권한·금액 transaction은 경험자 추가 검토를 권장한다.
- C3 출력: 서버 begin 승인·spool 전후 영속 상태·UNKNOWN 복구·lease·구판 취소와 정정 경쟁을 검토한 뒤 실제 프린터에서 검증. 인쇄 복구 설계는 경험자 추가 검토를 권장한다.
- C4 인수: 에이전트가 증거를 정리하고 제품 담당자가 수동 시나리오·구기능·시험 workspace 결과를 확인한 뒤 운영 확대.

이 C1~C4는 일정 문서의 G0~G4를 다시 정의하지 않는 기술 확인표다. 별도 상근 검토자를 필수 선행 인력으로 두지는 않지만, 에이전트는 각 관문에서 구현 대화의 결론을 그대로 신뢰하지 않고 별도의 검토 턴과 재현 가능한 테스트를 수행한다. 권한·금액·물리 인쇄의 검증 실패나 설명하지 못한 위험이 남으면 해당 부분을 보완하고 제품 담당자 또는 경험자 검토를 요청한다.

최종 보고에는 완료 티켓, 변경 파일, 배포된 DB/함수/웹/도우미 버전, 실행 검증, 실제 하드웨어 결과, 남은 제한을 쓴다. 아직 배포하지 않은 항목과 실제 적용된 항목을 분명히 구분한다. 제품 계약을 바꾸거나 운영 전체 전환 범위를 넓힐 필요가 있으면 그 변경안과 영향부터 검토받는다.
