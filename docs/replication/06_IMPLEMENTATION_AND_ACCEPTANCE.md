# 6. 개발 작업 순서·검증·인수 기준

[전체 설계도](../../PROJECT_REPLICATION_BLUEPRINT.md) · [설치](01_NEW_PC_SETUP.md) · [웹](02_WEB_DESIGN.md) · [백엔드](03_BACKEND_DATABASE.md) · [PC](04_LOCAL_SERVER_DESKTOP_STT.md) · [Android](05_ANDROID_DESIGN.md)

## 6.1 이 장을 사용하는 방법

기존 소스를 복제하는 개발자는 설치와 아래 자동 검사부터 진행하고, 기능별 인수표를 채운다. 처음부터 다시 구현하는 개발자는 다음 작업 단계를 순서대로 진행한다. 한 단계의 합격 조건을 통과하기 전에 다음 기능을 여러 개 한꺼번에 추가하지 않는다.

작업 기록에는 변경한 파일, 사용한 프로젝트 ref, 기준 commit, 수행 명령, 기대 결과, 실제 결과를 적는다. 실제 비밀번호·고객 전화번호·토큰 전체를 기록하지 않는다. 외부 API가 필요한 단계는 mock 성공과 실제 서비스 성공을 구분한다.

## 6.2 단계별 개발 작업지시서

### 단계 0 — 실행 기반과 도메인 이해

**입력:** 이 설계도, 세 개의 package/lock 파일, Gradle 설정.

**수행:** 개발 PC를 구성하고 웹 로그인 화면, PC 앱 시작 화면, Android Fake 화면을 각각 실행한다. `workspaceId`, `sessionId`, `buyerId`, `productId`, `saleId`의 차이를 설명할 수 있도록 작은 예제를 적는다.

**산출물:** 환경 버전 기록, 실행 방법, 앱별 로그 위치.

**합격:** 패키지 설치와 기존 테스트/빌드 통과. 서버 주소를 한 곳 바꾸는 것으로 모든 앱이 바뀌지 않는 이유를 이해한다.

### 단계 1 — 타입·API 계약·DB

**읽을 파일:** `src/types/productSales.ts`, `contracts/product-sales/v1/`, `supabase/migrations/`, `_shared/productSales.ts`.

**수행:** 작업공간 → 회차 → 상품/댓글 → 구매자/판매 관계를 그린다. 필수·선택 필드, `null`과 `0`, 상품번호 문자열, 상태 enum, 수정 revision을 맞춘다. 신규 기능의 요청/응답 예시를 가짜 값으로 작성한다.

**산출물:** migration, 계약 schema·fixture, 타입 정의, 적절한 테스트. 기존 migration을 이미 적용했다면 내용을 덮어쓰기보다 새 migration으로 변경 이력을 남긴다.

**합격:** 비어 있는 별도 DB에서 모든 migration이 적용되고 실제 handler가 사용하는 컬럼·제약과 일치한다. 아래 6.3의 상품 예약 문제를 해결한다. 계약 테스트 통과만으로 실제 DB 검사까지 통과한 것으로 보지 않는다.

### 단계 2 — 로그인·작업공간·기기 인증

**읽을 파일:** `AuthContext.tsx`, `supabaseClient.ts`, `voicecap-onboard`, `device-pair`, 공유 인증 함수.

**수행:** 가입·로그인·비밀번호 재설정·온보딩·작업공간 선택·장치 연결을 구현한다. 사용자 역할과 장치 capability를 서버에서 검사한다.

**산출물:** 두 테스트 사용자/작업공간, 연결·폐기 흐름, 타 작업공간 접근 거절 검사.

**합격:** A 사용자/기기가 B의 workspaceId를 요청에 넣어도 읽기·쓰기 실패. 다른 사람의 이메일이나 클라이언트 metadata를 바꾸는 것으로 관리자 권한을 얻을 수 없어야 한다.

### 단계 3 — 수동 상품·판매를 먼저 완성

**읽을 파일:** 상품·회차·판매 handlers, `ProductSalesContext.tsx`, `ProductSalesPage.tsx`, `productSalesApi.ts`.

**수행:** 회차 생성 → 상품 초안 → 이미지 업로드 → 상품 확정 → 구매자 확인 → 수량 입력 → 판매 저장 순서로 연결한다. 서버가 최종 금액과 범위를 검증하게 한다.

**산출물:** 서버 API와 웹 화면, 정상·중복·버전충돌 케이스.

**합격:** `0007`의 앞자리 0 보존, 0원과 가격 미입력 구분, 판매 재요청 중복 방지, 두 번째 회차에서 번호 정책 일관. 판매·통계·출력 요청의 중간 실패도 관찰한다.

### 단계 4 — 댓글 수집과 회차 분리

**읽을 파일:** `server/index.js`, `cloudCommentPublisher.js`, `comments.ts`, `commentStreamService.ts`, `CommentCaptureContext.tsx`.

**수행:** TikTok 연결 → 댓글 정규화 → 클라우드 배치 적재 → 같은 회차 피드 조회 → 구매자 선택을 연결한다. 새 회차로 전환할 때 helper에도 새 session UUID를 전달한다.

**합격:** 로컬 UI에 표시된 테스트 댓글이 DB의 올바른 workspace/session에 저장됨. 동일 댓글 재수신은 중복 저장되지 않으며 다른 회차 댓글은 구매 근거로 사용하지 않음.

### 단계 5 — STT와 음성 판매

**읽을 파일:** `audioCaptureService.ts`, `deepgramService.ts`, `localSttService.ts`, `salesExtractor.ts`, `voiceCommandParser.ts`, `nicknameMatcher.ts`, `LiveContext.tsx`.

**수행:** 한 STT 제공자로 먼저 최종 자막을 만든 뒤 문장 분석과 판매 저장을 연결한다. 임시 자막과 최종 자막을 구분하고, 회차 전환·청취 중지 시 이전 작업을 종료한다.

**합격:** 임시/최종 자막 중복 저장 없음. 정상 판매 문장은 한 번 저장되고 질문·부정·일반 “판매” 단어는 무조건 판매가 되지 않음. 같은 회차 근거가 부족한 구매자는 보류됨. 직접 판매 저장 경로와 상품 `commit-sales` 경로를 각각 검증한다.

### 단계 6 — 보류·정정·AI

**읽을 파일:** `pendingSales*`, `voiceCorrections*`, `aiTasks*`, `aiSettings*`, AI adapters, 웹 관련 service/type.

**수행:** 규칙 우선 처리 → AI 설정 조회 → 작업 생성/실행 → 근거 재검증 → 허용된 변경 적용 → 이력 기록을 구현한다. AI 응답에서 나온 ID를 그대로 신뢰하지 않고 현재 workspace/session·후보 목록과 대조한다.

**합격:** 근거 부족은 보류 유지, 서비스 장애와 판단 불가 구분, 정정은 기존 판매 ID 유지. `QUEUED` 작업이 실제 누가 실행하는지 정의되어야 한다. PC 모델 실행을 서버 loopback으로 대신하지 않는다.

### 단계 7 — PC 도우미·출력

**읽을 파일:** `desktop/comment-helper/main.cjs`, preload/UI, `server/cloudPrintWorker.js`, `printJobStore.js`, 클라우드 print handler.

**수행:** 현재 직접 인쇄 경로를 검증하고, 클라우드 출력 큐가 필요하면 worker 생성·start/stop·장치 인증·heartbeat·상태 UI까지 실제 런타임에 연결한다.

**합격:** 테스트 라벨 1건당 기대한 1회 출력. 연결 단절로 결과가 불명확하면 자동 중복 출력 대신 확인 가능한 상태로 남음. 출력 완료와 Windows spool 접수는 구분.

### 단계 8 — Android

**수행:** [5장](05_ANDROID_DESIGN.md) 순서대로 Fake → 실제 판매 API → 문자 동기화 → 발송 → 사진을 구현·검증한다.

**합격:** 연결 후 실제 Repository로 전환, 앱이 배경으로 가면 판매 polling 중지, 업무문자만 의도한 범위로 업로드, 발송 결과의 의미 명확. SMS/MMS 수신 저장·다운로드 기능의 실기기 차이를 확인한다.

### 단계 9 — 정산·고객·배송·관리

**읽을 파일:** `CommerceContext.tsx`, `remoteWorkspaceService.ts`, `SettlementPage.tsx`, invoice/shipment/admin 페이지.

**수행:** 확정 판매와 보류의 집계 규칙, 고객 매칭, 정산서·CSV, 문의문자, 입금 및 배송 상태를 연결한다. 관리자 조회와 판매자 조회를 분리한다.

**합격:** 보류를 잘못 매출 합계에 넣지 않으며 수정·취소 시 합계가 일치. 개인정보 마스킹과 원문 조회 권한이 의도대로 동작. 결제/훈련 시뮬레이션은 실제 서비스 기능으로 표시하지 않는다.

### 단계 10 — 독립 환경 배포·인수

**수행:** 새 URL·origin·Auth redirect·APK·PC 업데이트/다운로드 주소를 전부 맞춘다. 테스트용 데이터로 처음부터 끝까지 한 회차를 운영하고 재시작/장애를 검증한다.

**합격:** 아래 인수표 완료 및 남은 미구현 기능 명시. 기존 운영 URL/DB로 요청이 섞이지 않음. 새 PC에서 같은 소스와 설정으로 재빌드 가능.

## 6.3 현재 코드를 기반으로 개발할 때 먼저 처리할 차이

아래 항목은 문서 작성 중 발견한 **현 구현의 차이**다. 이번 작업에서 코드를 수정한 사항이 아니다. 상세 근거·파일은 각 장에 있다.

| ID | 차이 | 필요한 작업 / 확인 기준 |
|---|---|---|
| R01 | `product_code_reservations.expires_at`을 코드가 사용하지만 SQL 정의에 없음 | 만료 모델을 정하고 새 migration 및 만료/재사용 테스트 |
| R02 | 회차별 번호 재사용과 workspace 단위 상품/예약 고유 제약 불일치 | 의도한 유일성 범위 결정, 기존 중복 검사, constraint/index와 query 일치 |
| R03 | 일부 핸들러의 연속 CRUD를 DB 트랜잭션으로 가정할 수 없음 | 상품 확정·판매·통계·출력의 실패 복구 또는 실제 transaction/RPC 설계 |
| R04 | 계약 schema action 목록이 전체 서버 구현을 포함하지 않음 | 실제 index dispatch와 schema·fixture·웹/Android 타입 동기화 |
| R05 | 일부 onboarding/AI API·RLS의 workspace/관리자 검증이 충분하지 않음 | 서버 인증·membership·역할 검증, 다른 workspace 직접 요청 테스트 |
| R06 | Realtime publication 등록 SQL이 없음 | 실제 구독 대상 표의 publication을 환경별 명시·검증 |
| R07 | AI task 소비 scheduler와 PC_HELPER 실행 연결이 완성되지 않음 | 작업 실행 책임자·claim/timeout/retry, PC 실행 통신과 결과 수신 구현 |
| R08 | `prepare-product-image`에 예시 도메인 URL 반환 경로 | 실제 signed upload URL과 저장경로 검증 구현 |
| R09 | 클라우드 print worker 시작 경로 미연결 | Node/Electron 실행 수명주기에 worker 연결 및 실인쇄 시험 |
| R10 | 댓글 API 미설정 시 로컬 카운터로 성공 오해 가능 | 실제 DB 행/응답 기반 성공·대기·실패 구분 |
| R11 | 로컬 `/api` 인증과 Electron REST 헤더 불일치 | 인증 경계와 호출자를 함께 수정·검증 |
| R12 | 판매 변환 시 보류·AI 메타 필드 일부 미보존 | DB/타입/변환 매핑 일치, 저장→재조회→새 PC 비교 |
| R13 | Android 연결 뒤 Fake→Real 자동 전환 미연결 | repository 재생성 및 polling 정리 |
| R14 | Python 설치 버전 고정·STT 테스트 설정 격리 부족 | 재현 가능한 패키지 기록과 테스트 전용 저장 경로 |
| R15 | 기본 SMS 앱으로 필요한 수신 저장/MMS 다운로드 전체 구현 미확인 | Telephony Provider 반영부터 실기기 전송까지 시험·보완 |

R01/R02 해결안 예시: 회차 안에서만 번호가 유일해야 한다면 `(workspace_id, session_id, product_code)`를 기준으로 조회·고유 제약·예약 키를 모두 변경해야 한다. 단지 `expires_at` 컬럼 하나를 추가하거나 query 한 줄을 바꿔서는 전체 정합성을 해결하지 못한다. 운영 데이터에 session이 없는 기존 행을 어떻게 이행할지도 결정한다.

권한 보완은 별도 이름의 middleware만 만드는 것으로 끝나지 않는다. 실제 웹 직접 DB CRUD, Edge Function, Vercel 보조 API, 장치 토큰, RLS 각각의 진입점에서 검사한다.

## 6.4 자동 검증 명령

### 웹·계약·공통 로직

```powershell
Set-Location C:\dev\voice-pin-anti
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw '루트 테스트 실패' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '웹 빌드 실패' }
```

`test:contracts`는 계약만, `test:api`는 인증 테스트 파일만, `test:sales`는 `test/*.test.mjs`를 실행한다. 전체 검사에서는 위 `npm test`를 사용한다. 테스트 파일 이름에 integration이 있어도 실제 네트워크와 운영 DB를 사용하는지는 구현을 확인한다.

### 서버 테스트 — 사용자 STT 설정을 격리하여 실행

현재 `sttBridge` 테스트는 실제 사용자 설정 파일에 모델/장치를 저장할 수 있다. 다음처럼 **새 PowerShell 창**에서 테스트 전용 APPDATA/LOCALAPPDATA를 지정한다. 시스템 전역 환경변수를 바꾸지 않고 이 프로세스와 자식 프로세스에만 적용한다.

```powershell
Set-Location C:\dev\voice-pin-anti
$repoForTest = (Get-Location).Path
$testStateRoot = Join-Path $repoForTest 'scratch\replication-test-profile'
$testRoaming = Join-Path $testStateRoot 'Roaming'
$testLocal = Join-Path $testStateRoot 'Local'
New-Item -ItemType Directory -Path $testRoaming,$testLocal -Force | Out-Null
$previousAppData = $env:APPDATA
$previousLocalAppData = $env:LOCALAPPDATA
try {
    $env:APPDATA = $testRoaming
    $env:LOCALAPPDATA = $testLocal
    Push-Location (Join-Path $repoForTest 'server')
    try {
        npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw '서버 테스트 실패' }
    } finally {
        Pop-Location
    }
} finally {
    $env:APPDATA = $previousAppData
    $env:LOCALAPPDATA = $previousLocalAppData
}
```

장치 탐색에 Python 경로가 필요하면 실제 설치된 테스트용 Python 경로를 `PYTHON_PATH` 환경변수에 지정한다. 자세한 선택 규칙은 [4장](04_LOCAL_SERVER_DESKTOP_STT.md)에서 확인한다. 위 격리는 테스트의 사용자 설정 저장을 분리하기 위한 방법이며 실제 STT 성능 시험을 대신하지 않는다.

### PC 도우미

```powershell
Set-Location C:\dev\voice-pin-anti\desktop\comment-helper
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'PC UI/인쇄 테스트 실패' }
```

이 테스트는 실제 용지 출력 시험이 아니다. 설치 패키지 검증이 필요하면 `npm run pack` 또는 `npm run dist`로 만든 앱을 실행하고 프린터를 연결한다.

### Android

```powershell
Set-Location C:\dev\voice-pin-anti\android\voicecapSMS
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'Android 검사 실패' }
```

위 명령은 코드 기본 API URL로 빌드한다. 독립 환경 APK라면 [1장](01_NEW_PC_SETUP.md)의 `-PVOICECAP_API_BASE_URL`을 반드시 지정한다. `:app:lintDebug`와 서명 릴리스 빌드는 해당 변경·배포 범위에서 추가 수행하고 결과를 별도로 기록한다.

## 6.5 이번 문서 작성 시 실제 검증 결과

기준일 2026-09-26, 소스 SHA `62a464924b3785255e5d68e8898b14c23f66f554`.

| 검사 | 결과 | 한계 |
|---|---|---|
| 루트 `npm test` | 236 통과, 실패/건너뜀 0 | DB·외부 서비스 전체 검증 아님 |
| 서버 `npm test` | 11 통과, 실패/건너뜀 0 | mock/로직 범위, 아래 설정 부작용 있음 |
| PC `npm test` | 7 통과, 실패/건너뜀 0 | 실제 설치·출력 시험 아님 |
| 웹 `npm run build` | 성공 | JS 번들 약 1,188 kB, 500 kB 초과 경고 |
| Android `:app:testDebugUnitTest` | 7 통과, 실패/건너뜀 0 | 주로 Fake Repository 검증 |
| Android `:app:assembleDebug` | 성공 | 실제 휴대폰 설치·문자 발송 미수행 |
| 신규 Supabase DB migration 적용 | 미수행 | 코드/SQL 불일치가 발견된 상태 |
| TikTok·STT·AI 실서비스 | 미수행 | 실제 계정·방송·모델로 별도 확인 |
| 실제 프린터·SMS/MMS·배포 | 미수행 | 인수 환경에서 수행 필요 |

총 자동 테스트 261개 통과. Node 24.12.0/npm 11.6.2, Android JBR 21.0.9 사용. Android 빌드에는 Gradle 10과의 향후 호환 관련 deprecated 기능 경고가 있었으며 현재 빌드는 성공했다.

**검증 부작용 기록:** 최초 서버 테스트는 사용자 경로 격리 전에 실행되어 현재 PC의 `%APPDATA%\voicecap-comment-helper\stt-settings.json`에 `model: base`, `device: cpu`, `computeType: int8`을 저장했다. 실행 전 값을 확보하지 못했으므로 추측해서 복원하지 않았다. 이 PC에서 기존 다른 STT 구성을 사용했다면 도우미 설정에서 모델·장치를 다시 선택한다. 이후 검증에는 위 격리 절차를 사용한다.

## 6.6 기능별 인수 시나리오

아래 예시는 전용 테스트 계정/작업공간과 가짜 고객을 사용한다. 실문자·인쇄가 포함된 행은 해당 시험 장치에서만 수행한다.

| ID | 준비·수행 | 합격 기준 |
|---|---|---|
| A01 | 새 브라우저에서 로그인 후 새로고침 | 인증 복구·같은 workspace, 이력 재조회 |
| A02 | A/B 두 workspace 생성, B ID로 API 직접 요청 | A 토큰으로 B 읽기·수정 거절 |
| A03 | 로그인만 하고 대기 | 불필요한 새 회차 자동 생성 없음 |
| A04 | 청취 시작 → 새 회차 → 중지 → 이어가기 | 중지가 회차 삭제가 아니며 이어가기 ID 유지 |
| A05 | 첫 회차 상품 `0007`, 두 번째 회차 같은 번호 | 확정한 번호 정책대로 동작, DB 충돌 숨김 없음 |
| A06 | 상품 0원·미입력 가격 각각 등록 | 값 구분, 판매 허용/보류 규칙 일관 |
| A07 | 카메라 거절·사진 업로드 실패 | 번호 이미지 전환 또는 재시도 가능, 잘못된 확정 없음 |
| A08 | 같은 operationId 판매 요청 두 번 | 중복 판매/통계/출력 없음 |
| A09 | 두 기기에서 같은 revision으로 동시 수정 | 오래된 요청 충돌 처리, 마지막 요청 무조건 덮어쓰기 아님 |
| A10 | 댓글 한 건 재전송 | 중복 제거, 같은 session에만 저장 |
| A11 | PC 직접 적재 설정 없음, 웹 적재 조건 있음/없음 각각 시험 | 웹 적재와 PC 직접 적재의 성공·실패를 실제 DB로 구분 |
| A12 | 정확한 닉네임·확정 문구·가격 최종 발화 | 기대한 한 건의 판매, 가격 원화 변환 일치 |
| A13 | 질문/부정/미완성 발화 | 오판매·오정정 없음 |
| A14 | 다른 회차에만 같은 닉네임 댓글 존재 | 현재 회차 근거로 쓰지 않고 보류 |
| A15 | 보류 후 후속 발화, 규칙으로 해결 가능 | 불필요한 AI 없이 대상 건만 변경 |
| A16 | AI 근거 부족/AI 장애 각각 발생 | 보류 유지와 failover 조건 구분 |
| A17 | 판매 정정·되돌리기·출력 후 정정 | ID·revision·history·수정 출력 일관 |
| A18 | 웹 판매 저장 후 새 PC/새로고침 | 금액뿐 아니라 보류 사유·근거·고객 링크 보존 확인 |
| A19 | 청취 중지와 `/live` 이탈을 각각 시험 | 청취 중지는 STT 중지·탭 오디오 파이프라인 일시정지(공유 원본 유지), 경로 이탈은 feed polling 중지. 경로 이탈만으로 STT 종료를 가정하지 않음 |
| A20 | 인쇄 직후 ACK 전에 연결 단절 | 결과 불명확 상태, 자동 중복 출력 없음 |
| A21 | Android 페어링 → 웹 기기 판매 capability 부여 → 앱 재시작 | 실제 workspace 판매 조회, Fake 데이터 아님 |
| A22 | 등록 안 된 테스트 번호의 일반 문자 | 업로드 대상에서 제외 |
| A23 | 구매정보 1건·동일 번호 후속 문의·MMS 이미지 | 의도한 분류와 중복 방지, 첨부 열람 |
| A24 | Android 화면 꺼짐·재부팅·네트워크 복구 | 동기화 예약과 수신 처리 확인 |
| A25 | 지정 시험 번호로 발송 큐 1건 | 1회 요청, 상태 의미 확인, 실패 관찰 가능 |
| A26 | 정산에서 확정/보류/수정 건 비교 | 집계 정책과 수량·금액 일치 |
| A27 | 같은 경로 직접 열기 `/sales?session=...` | SPA 라우팅 및 회차 필터 유지 |
| A28 | 독립 배포 웹·APK·PC 통신 로그 비교 | 같은 새 프로젝트 연결, 기존 도메인 혼용 없음 |

## 6.7 문제 해결표

| 증상 | 먼저 확인할 곳 | 다음 조치 |
|---|---|---|
| npm 명령 실행 정책 오류 | PowerShell이 npm.ps1을 실행하는지 | `npm.cmd` 사용 |
| 웹이 열리지 않음 | Vite 터미널·3000 포트 | 실행 유지, port conflict 해결 |
| 데이터가 데모처럼 보임 | Supabase env, Android 기기 설정 | 실제 인증/Repository 연결 확인 |
| 로그인은 되나 상품 등록 실패 | Edge 로그·reservation schema·constraint | R01/R02 및 실제 응답 검사 |
| 같은 회차만 목록 복귀 시 사라짐 | URL의 `session` query | 상세·복귀 링크와 필터 처리 검사 |
| 댓글은 PC에 보이나 웹은 비어 있음 | 2137 소켓·수집 토글·청취·TikTok ID | 즉시 댓글 수신부터 확인 후 웹 ingest/feed 또는 PC 직접 적재·DB 행 검사 |
| STT REST가 401 | `/api` 브리지 인증 middleware | 요청 키 헤더와 호출 경계 확인 |
| STT 준비됐지만 자막 없음 | 오디오 선택·탭 오디오 공유·PCM·generation | 실제 입력과 Socket 이벤트부터 추적 |
| Python 명령은 되나 모델 로딩 실패 | 선택된 Python 경로와 venv 패키지 | 시스템 Python과 worker Python 구분 |
| GPU가 표시되나 느림 | 실제 backend/model/device 상태 | CPU fallback 및 GPU 경합 검사 |
| AI 설정 저장 후 다시 사라짐 | 보조 API 응답과 실제 DB 저장 | echo success/권한/서버 env 구분 |
| AI 작업이 QUEUED에 멈춤 | 소비자·process action 연결 | 실행 주체 구현/설정 확인 |
| 판매는 저장되나 Android 판매 인쇄 안 됨 | print_jobs·PC worker 연결 | 큐와 실제 worker 시작 코드 검증 |
| Android 연결 후 가짜 상품 표시 | MainActivity repository 초기 선택 | 앱 완전 재실행, 전환 로직 개선 |
| APK 덮어쓰기 실패 | package ID·서명 인증서 | 원래 키 인수, 기존 데이터 보존 계획 |
| 업무 문자 누락 | 동의·기본앱·권한·Provider·최근 조회 범위 | 처음 수신부터 단계별 실기기 확인 |
| 다른 PC에서 규칙/모델 설정 없음 | 규칙·훈련·캡처 영역 workspace settings 동기화, localStorage·PC userdata | 원격값 로드/초기 시딩부터 확인, PC 모델·장치 설정은 별도 재구성 |

## 6.8 로그를 읽는 순서

1. **브라우저:** 어떤 화면·회차에서 실패했는지, Network 요청의 action/HTTP 상태/응답 코드를 확인한다.
2. **로컬 서버/도우미:** 같은 시각의 연결·STT·댓글 발행·인쇄 로그를 본다.
3. **Edge Function:** workspace/session/operation ID가 같은 요청의 서버 오류를 본다.
4. **DB:** 해당 행이 실제 저장되었는지, revision·status가 무엇인지 확인한다.
5. **외부/장치:** TikTok, STT 제공자, AI 모델, 프린터 spool, Android Logcat을 해당 기능에 맞춰 확인한다.

로그에 토큰·API 키·전체 고객 문자·음성 원문을 무조건 출력하지 않는다. 장애를 재현할 수 있는 action, 가짜 입력, 상태 코드, 식별자 일부만 남겨도 대부분 경로를 추적할 수 있다.

## 6.9 최종 인수 기록 양식

```text
복제 날짜 / 담당자:
복제 범위: 기존 서버 사용 / 독립 서버 / 데이터 이전
소스 SHA:
Windows / Node / npm / JDK / SDK:
Python/모델/GPU 드라이버(사용 시):
Supabase 프로젝트 ref(비밀키 제외):
웹 주소 / PC 앱 버전 / APK 버전:
테스트 결과: 웹 __ / 서버 __ / PC __ / Android __
웹 빌드 / APK 빌드 / PC 패키지 결과:
완료한 인수 시나리오 ID:
미수행 또는 실패한 시나리오와 이유:
복원한 데이터 범위 / 행 수·금액 비교 결과:
프린터 / 문자 / STT 실제 장치 확인:
미해결 보완사항 R01~R15:
실행 방법과 로그 위치 전달 여부:
```

신규 담당자가 문서만 보고 빌드한 결과와 검증표를 재현할 수 있고, 사용하려는 기능의 미해결 항목을 명확히 알고 있어야 인수가 완료된다. 테스트 통과·화면 표시·실서비스 완료를 각각 구분해서 기록한다.
