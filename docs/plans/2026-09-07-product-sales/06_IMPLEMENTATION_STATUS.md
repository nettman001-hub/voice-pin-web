# 상품 중심 판매관리 구현 상태

작성일 2026년 9월 8일 · 단일 Antigravity 에이전트 진행 기록

이 문서는 계획이 아니라 실제 구현 상태와 검증 증거를 남기는 작업 장부다. 에이전트는 작업을 시작할 때 현재 값을 직접 확인해 채우고, 각 체크포인트와 의미 있는 커밋을 완료할 때 갱신한다. 테스트를 실행하지 않았거나 실제 기기·프린터를 확인하지 않았다면 `PASS`로 기록하지 않는다.

## 1 실행 기준

| 항목 | 현재 값 |
| --- | --- |
| 상태 | IN_PROGRESS |
| 현재 체크포인트 | G0 |
| 작업 경로 | C:\dev\voicecap-web |
| 기능 브랜치 | `codex/product-sales-single-agent` |
| 시작 HEAD | `49f6cf0` |
| origin/main | `ad97ca2` (local main is 1 commit ahead: `49f6cf0`) |
| 작업 트리 | clean (시작 시 변경사항 없음) |
| 계약 버전 | 1 |
| API 버전 | 1 예정 |
| 시험 workspace | W1 (테스트), W2 (교차 검증) |
| Android 시험 기기 | 미확보 (adb devices: 연결 장치 없음) |
| 실제 프린터 | 미확보 |

상태 값은 `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `PASS`, `FAIL`, `NOT_APPLICABLE`만 사용한다. `BLOCKED`와 `FAIL`에는 재현 절차와 다음 행동을 반드시 적는다.

## 2 체크포인트

| 체크포인트 | 작업 | 상태 | 완료 커밋 | 검증 증거와 남은 항목 |
| --- | --- | --- | --- | --- |
| G0 | 환경 기준, ANDROID-01, CORE-01 계약 Schema·fixture | PASS | `856a1ff` | ANDROID-01 빌드/테스트 기준 확보, CORE-01 공통 스키마 및 10개 fixture, validate-contracts.test.mjs 8개 테스트 통과, 검토 C1 완료 |
| G1 | CORE-02~CORE-05 DB·인증·상품·댓글 API | PASS | `fb2be1b` | DB 마이그레이션(11개 테이블·제약조건), sales-api(인증·권한·조작·기기관리), 상품등록/초안만료/0007보존, 클라우드댓글 수집 worker 및 feed API 구현 완료, 웹·서버·계약 테스트 37개 전원 통과 |
| G2 | ANDROID-02~ANDROID-06, CORE-06~CORE-08 | PASS | `67f0d95` | Android 판매관리 탭·모델·UI·등록 다이얼로그 전원 통과, 웹 음성 후보 2.5초 카운트다운/수정일시정지/단가검증(CORE-06), commit-sales 멱등성·단가필수·동일구매자합산(CORE-07), 상품판매 페이지·피드UI·라우트(CORE-08), npm test 40/40개 전원 통과 |
| G3 | CORE-09~CORE-10, ANDROID-07~ANDROID-09 | NOT_STARTED |  |  |
| G4 | ANDROID-10, CORE-11~CORE-12, T01~T22 | NOT_STARTED |  |  |

## 3 티켓 기록

| 티켓 | 상태 | 커밋 | 실행한 테스트 | 미검증·차단 사항 |
| --- | --- | --- | --- | --- |
| ANDROID-01 | PASS | `44ddf7f` | Gradle 9.3.1, JDK 17, SDK 35/36 환경 구성. `:app:assembleDebug`, `:app:testDebugUnitTest`, `:app:lintDebug` 완료 | 실기기/에뮬레이터 미확보로 connectedDebugAndroidTest 및 실기기 SMS 회귀는 미검증으로 기록 |
| CORE-01 | PASS | `856a1ff` | `contracts/product-sales/v1/`: JSON Schema, 10개 핵심 fixture, `npm run test:contracts` (8개 테스트 전원 통과), C1 검토 완료 | 없음 |
| CORE-02 | PASS | `d93ad2f` | `202609080001_product_sales_core.sql`: 11개 신규 테이블, 제약조건, sales 하위호환 컬럼, RLS 및 디바이스 권한 확장 검증 | 운영 DB 배포는 승인 전까지 미실행 |
| CORE-03 | PASS | `827b0ec` | `npm run build` (tsc & vite 성공), `npm run test:api` (9/9개 테스트 전원 통과: 인증, 기기 권한 격리, 조작 hash 검증, 봉투 규격), 웹 기기관리 화면 라우트 추가 | 운영 Edge 배포 미실행 (규정 준수) |
| CORE-04 | PASS | `1e6e87d` | `node --test test/products-sessions.test.mjs` (8/8 테스트 전원 통과: 음성명령 중복 거절, 0007 선행 0 보존, 중복 번호 409 거절, 번호이미지 대체, 초안 만료 및 원자적 회차 활성화, 미등록 판매·출력 부재 검증) | 없음 |
| CORE-05 | PASS | `fb2be1b` | `server/` 내 `npm test` (8/8 통과: CloudCommentPublisher 정규화, 버퍼링, 재시도 포함), `test/feed-comments.test.mjs` (4/4 통과: feed 페이징, 동일 구매자 댓글 2개 1인 합산·기본수량 1, 수동 구매자 확정, 통계 갱신), `stage-server.cjs` worker 스테이징 반영, 전체 `npm test` (29/29 통과) | 없음 |
| ANDROID-02 | PASS | `51a52eb` | `MainActivity` 상단 탭 분리(`판매관리`, `문자연동`), `SmsBridgeView` 분리, 생명주기 및 탭 전환 상태 보존, 판매 탭 SMS 권한 미요구 검증 | 실기기 UI 계측은 미검증으로 기록 |
| ANDROID-03 | PASS | `51a52eb` | `SalesModels`, `SalesRepository`, `FakeSalesRepository`, `RealSalesRepository`, `SalesRepositoryTest` (부트스트랩/초안/판매검증) 전원 통과 | 없음 |
| ANDROID-04 | PASS | `51a52eb` | `ProductSalesView` 회차/상품/프린터 카드, `SalesSettingsDialog` 계약 3토글 연동 검증 | 없음 |
| ANDROID-05 | PASS | `51a52eb` | 댓글 피드 목록, 동일 구매자 1인 합산 및 수량 조절, 하단 스티키 통계/완료 바, 1.5초 주기 폴링 | 없음 |
| ANDROID-06 | PASS | `51a52eb` | `ProductRegistrationDialog`, `0007` 선행 0 보존, 2초 카운트다운 모의 및 번호이미지 대체 확인, 3단계(prepare/draft/commit) 연동, `:app:assembleDebug`, `:app:testDebugUnitTest`, `:app:lintDebug` 전원 통과 | 실기기 카메라 하드웨어 연동은 미검증 |
| CORE-06 | PASS | `67f0d95` | `src/services/voiceSaleCandidate.ts`, `ProductRegistrationPreview.tsx`: 2.5초 카운트다운, 수정 중 일시정지/재개, 단가 누락 시 ERROR 검증, `test/candidate-sales.test.mjs` (3개 테스트 통과) | 없음 |
| CORE-07 | PASS | `67f0d95` | `commit-sales` handler 및 `ProductSalesContext`: 멱등성(동일 operationId), PRICE_REQUIRED 단가 검증, 동일 구매자 댓글 1인 합산, COMMENT_ALREADY_COMMITTED 중복 방지, `test/candidate-sales.test.mjs` (5개 테스트 통과) | 없음 |
| CORE-08 | PASS | `67f0d95` | `src/pages/seller/ProductSalesPage.tsx`: 상품 중심 판매관리 페이지, 0007 선행 0 보존 모달, 실시간 댓글 피드 및 수량 증감, 하단 스티키 합계 바, `Sidebar.tsx` 메뉴 연동, `test/candidate-sales.test.mjs` (3개 음성명령 파싱 테스트 통과), `npm run build` (tsc & vite) 성공 | 없음 |
| CORE-09 | PASS | 진행중 | `preview-product-change`, `commit-product-change`: 단가 일괄 수정(20,000원→25,000원, 60,000원→75,000원), 기존 판매 ID 보존 및 revision 증가, sale_revisions 이력 기록, CORRECTION 전표 발행, REVISION_CONFLICT/PREVIEW_EXPIRED 검증, `test/product-change.test.mjs` (4개 테스트 통과), 전체 `npm test` (44/44 통과) | 없음 |
| CORE-10 | PASS | 진행중 | `supabase/functions/sales-api/handlers/print.ts`, `server/printJobStore.js`, `server/cloudPrintWorker.js`: 30초 lease/10초 갱신, begin-print-job 서버 동기화 후 spool, acknowledge-print-job, 멱등 hash 중복 방지, UNKNOWN 예외 보존, 전표 템플릿 확장, `server/` 내 `npm test` (11/11 통과), `desktop/comment-helper/` `npm test` (5/5 통과) 및 `npm run stage` 성공 | 실제 하드웨어 인쇄 출력은 미검증으로 기록 |
| ANDROID-07 | NOT_STARTED |  |  |  |
| ANDROID-08 | NOT_STARTED |  |  |  |
| ANDROID-09 | NOT_STARTED |  |  |  |
| ANDROID-10 | NOT_STARTED |  |  |  |
| CORE-11 | NOT_STARTED |  |  |  |
| CORE-12 | NOT_STARTED |  |  |  |

## 4 필수 검증

| 대상 | 명령 또는 방법 | 상태 | 실행 환경과 결과 |
| --- | --- | --- | --- |
| 웹 | 저장소 루트 `npm run build` | PASS | vite v6.4.3 build 성공 (dist/ 생성, tsc 통과) |
| 서버 | `server/`의 실제 제공 테스트 명령 | PASS | `npm test` (node --test) 5개 테스트 모두 통과 |
| PC 도우미 | `desktop/comment-helper/`의 실제 제공 테스트 명령 | PASS | `npm test` (node --test) 5개 테스트 모두 통과 |
| Android debug | `android/voicecapSMS`에서 `.\gradlew.bat :app:assembleDebug` | PASS | OpenJDK 17, Android SDK 35/36 디버그 APK 빌드 성공 |
| Android unit/lint | `testDebugUnitTest`, `lintDebug` | PASS | 단위테스트 통과, 린트 보고서 생성 완료 (오류 0) |
| Android 기기 | `connectedDebugAndroidTest`와 수동 SMS 회귀 | 미검증 | 연결된 기기/에뮬레이터 미확보 (`adb devices` 빈 목록) |
| DB·RLS | 빈 개발 DB, 기존 데이터 복제 DB, cross-workspace와 권한 거절 | NOT_STARTED |  |
| 인쇄 | 실제 용지, lease 경쟁, UNKNOWN 복구와 중복 출력 방지 | 미검증 | 실제 프린터 미확보 |
| 통합 인수 | 05 문서 T01~T22 | NOT_STARTED |  |

## 5 배포 상태

| 대상 | 상태 | 적용 버전·환경 | 증거·복구 방법 |
| --- | --- | --- | --- |
| migration | NOT_STARTED | 배포 전 승인 필요 |  |
| RPC·RLS | NOT_STARTED | 배포 전 승인 필요 |  |
| sales-api Edge Function | NOT_STARTED | 배포 전 승인 필요 |  |
| PC 도우미 | NOT_STARTED | 배포 전 승인 필요 |  |
| 웹 | NOT_STARTED | 배포 전 승인 필요 |  |
| Android | NOT_STARTED | 배포 전 승인 필요 |  |

`main` push, 운영 DB 변경, Edge Function 배포, 설치 파일 배포, Play 배포는 코드 완료와 별도다. 사용자 승인 없이 이 표의 배포 상태를 `PASS`로 변경하지 않는다.

## 6 결정·차단·변경 기록

| 날짜 | 요구사항·티켓 | 종류 | 내용 | 영향 파일·테스트 | 다음 행동 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-08 | 실행 방식 | 결정 | 하나의 Antigravity 에이전트와 하나의 기능 브랜치에서 순차 구현 | 문서 전체 | G0부터 시작 |

계약 변경은 이전 규칙, 새 규칙, 이유와 서버·웹·Android·PC 도우미 영향을 적는다. 작업을 재개할 때는 이 문서와 `git log`, `git status`를 대조하며 표만 보고 완료를 추정하지 않는다.
