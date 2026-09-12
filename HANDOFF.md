# VoiceCAP 개발·운영 인계인수서

> 기준 시각: 2026-09-13 KST
> 운영 브랜치: `main`
> 기준 기능 커밋: `cd2990e` — 판매 상세 이동 후 회차 필터 유지
> 문서 커밋: 이 문서를 갱신한 최신 `main` 커밋
> 운영 상태: Supabase Edge Function 및 Vercel 프로덕션 배포 완료

이 문서는 새 담당자가 VoiceCAP 웹, 댓글 수집 도우미, Supabase 데이터와 Edge Function을 같은 운영 상태로 이어받기 위한 기준 문서다. 실제 토큰, 비밀번호, API 키, service role 키는 문서와 Git에 기록하지 않는다.

## 1. 운영 자산

| 항목 | 운영 값 |
| --- | --- |
| GitHub | `https://github.com/nettman001-hub/voice-pin-web.git` |
| 운영 브랜치 | `main` |
| 대표 웹 | `https://www.voicecap.shop` |
| 보조 웹 | `https://voicecap.shop`, `https://voice-pin-web.vercel.app` |
| Vercel 프로젝트 | `voice-pin-web` / `nettman001-5045s-projects` |
| Supabase 프로젝트 | `sermon-guide-db` |
| Supabase Project Ref | `ymegrhxpbeanvxwdzfym` |
| Supabase Dashboard | `https://supabase.com/dashboard/project/ymegrhxpbeanvxwdzfym` |
| 핵심 Edge Function | `sales-api` |
| 댓글·프린터 로컬 도우미 | `server/index.js`, 기본 포트 `2137` |
| 웹 기술 | React 18, TypeScript, Vite, Tailwind CSS |
| 데이터 | Supabase Postgres, Auth, Realtime, Private Storage |

2026-09-13 기준 Supabase 대시보드에는 이전 결제 주기 사용량 초과 경고와 2026-10-12 제한 예정 안내가 표시됐다. 운영자는 Dashboard의 Organization Usage/Billing을 확인해야 한다.

## 2. 최신 변경 이력

| 커밋 | 내용 | 서버 재배포 필요 |
| --- | --- | --- |
| `cd2990e` | 판매 목록 회차 선택을 URL `?session=<UUID>`에 보존. 상세·삭제·캡처 이동 후 복귀해도 선택 유지 | 웹만 |
| `697e885` | 판매 목록 회차 풀다운, 클라우드 `sales` 원본 전환, `list-sessions` API 추가 | `sales-api` + 웹 |
| `19512f6` | 새 회차 표시명을 `YYYY-MM-DD 라이브 N회차` 형식으로 변경 | `sales-api` + 웹 |
| `9b65d54` | 댓글 원본을 `live_comments`로 통일하고 웹 검증·규칙·AI가 같은 회차 댓글을 사용 | `sales-api` + 웹 + 댓글 도우미 재시작 |
| `8b0ea57` | 라이브 화면의 전체 자막 스트림 제거, 규칙 실행 결과 카드 위치 조정 | 웹만 |
| `6b4ae2d` | TikTok 사용자명을 Supabase 설정에 즉시 저장·동기화 | 웹만 |
| `ded4e5f` | 로그인 시 회차 자동 생성을 제거하고 청취 시작 때 회차를 선택하도록 변경 | `sales-api` + 웹 |

현재 기능 변경은 모두 `main`에 푸시됐고 운영 배포됐다.

## 3. 시스템 구성과 데이터 흐름

```text
TikTok 방송 댓글
  -> 로컬 댓글 도우미(server/index.js)
  -> cloud:config로 받은 활성 session UUID 적용
  -> sales-api / ingest-comments
  -> Supabase live_comments
       |-> get-sales-feed -> 라이브 댓글 UI
       |-> 웹 닉네임 검증
       |-> 보류 규칙 검증
       `-> 보류·정정 AI 검증

방송 오디오
  -> 브라우저 탭 오디오 또는 마이크
  -> STT(Soniox/Deepgram/로컬 STT)
  -> salesExtractor 후보 추출
  -> 같은 session의 live_comments로 구매자 검증
  -> Supabase sales
  -> SalesContext + Realtime
  -> 라이브 카드 / 판매 목록 / 정산 / 주문 후속 화면
```

핵심 원칙은 `workspace_id`와 `session_id` 두 경계를 항상 함께 지키는 것이다. 다른 판매자 작업공간이나 다른 방송 회차의 댓글을 판매 근거로 사용하면 안 된다.

## 4. 클라우드 단일 원본 정책

### 4.1 댓글

댓글 이력의 단일 원본은 Supabase `live_comments`다.

- 댓글 도우미는 웹에서 받은 활성 `sessionId`를 `cloud:config` Socket.IO 이벤트로 저장한다.
- 댓글 수집 시 `ingest-comments`를 호출해 `live_comments`에 넣는다.
- 라이브 댓글 UI는 `get-sales-feed` 응답의 `comments`를 사용한다.
- 댓글 기록 화면 `/comments`는 `list-live-comments`로 최대 5,000건을 읽는다.
- 댓글 삭제는 `delete-live-comments`를 사용하며 `workspace_id` 범위가 적용된다.
- 웹 닉네임 검증, 보류 규칙, AI 보류 해결, 음성 정정은 모두 해당 판매의 `session_id`로 필터한 `live_comments`를 사용한다.
- 브라우저 localStorage에는 댓글 이력을 저장하지 않는다. 댓글 캡처 설정과 도우미 주소 같은 환경 설정만 남는다.

주요 파일:

| 역할 | 파일 |
| --- | --- |
| 도우미 회차 전달 | `src/services/commentStreamService.ts` |
| 댓글 UI·도우미 설정 연결 | `src/context/CommentCaptureContext.tsx` |
| 댓글 적재·조회·삭제 API | `supabase/functions/sales-api/handlers/comments.ts` |
| 보류 댓글 조회 | `supabase/functions/sales-api/handlers/pendingSales.ts` |
| 정정 댓글 조회 | `supabase/functions/sales-api/handlers/voiceCorrections.ts` |
| 댓글 기록 화면 | `src/pages/seller/CommentRecordsPage.tsx` |

### 4.2 판매

판매 이력의 원본은 Supabase `sales`다.

- 로그인한 판매자의 `workspace_id` 범위만 읽고 쓴다.
- `SalesContext`는 빈 배열에서 시작해 `remoteWorkspaceService.loadSales(workspaceId)`로 클라우드 판매를 읽는다.
- 판매 등록·수정·삭제 후 Supabase에 반영하며 Realtime 이벤트로 다른 화면과 기기를 갱신한다.
- 브라우저 localStorage 판매 목록을 운영 원본이나 초기 표시 캐시로 사용하지 않는다.
- 웹 음성 판매와 기존 판매 화면은 `remoteWorkspaceService`를 통해 `sales`를 사용한다.
- 상품 중심 수동/댓글 판매는 `sales-api`의 `commit-sales`를 거쳐 같은 `sales`에 기록된다.

주요 파일:

| 역할 | 파일 |
| --- | --- |
| 판매 전역 상태·Realtime | `src/context/SalesContext.tsx` |
| Supabase 판매 행 변환·CRUD | `src/services/remoteWorkspaceService.ts` |
| 상품 중심 판매 커밋 | `supabase/functions/sales-api/handlers/sales.ts` |
| 판매 목록 | `src/pages/seller/SalesListPage.tsx` |
| 판매 상세 | `src/pages/seller/SalesDetailPage.tsx` |

### 4.3 아직 로컬에 남는 데이터

다음은 현재도 브라우저 또는 로컬 도우미 설정으로 남을 수 있다. 댓글 이력과 판매 이력의 단일 원본 정책과 혼동하지 않는다.

- STT·인식 단어 규칙과 훈련 설정
- 화면 캡처 영역 설정
- 댓글 도우미 연결 주소와 캡처 환경 설정
- 실행 중인 브라우저의 현재 UI 상태
- 로컬 댓글·프린터 도우미의 장치 설정

## 5. 방송 회차

### 5.1 생성과 종료

1. 로그인 후 `get-bootstrap`은 활성 회차를 읽기만 한다. 로그인만으로 새 회차를 만들지 않는다.
2. `/live`에서 청취 시작을 누르면 기존 활성 회차 이어가기 또는 새 회차 시작을 고른다.
3. 새 회차 시작 시 기존 `ACTIVE` 회차를 `ENDED`로 바꾸고 새 `ACTIVE` 회차를 만든다.
4. 청취 중지는 STT·댓글 수집·피드 폴링을 멈추지만 회차는 종료하지 않는다.
5. 다음 청취 시작 때 기존 회차를 이어가면 같은 판매·댓글에 계속 기록된다.

### 5.2 표시명과 내부 ID

- DB 기본키와 API 연결에는 `live_sessions.id` UUID를 사용한다.
- 사용자 화면에는 `display_code`를 표시한다.
- 새 표시명 형식은 `2026-09-13 라이브 1회차`, `2026-09-13 라이브 2회차`다.
- 같은 작업공간, 같은 한국 날짜의 기존 표시명에서 가장 큰 순번을 찾아 다음 번호를 발급한다.
- 과거 `YYYYMMDD_HHmm` 표시명은 자동 변경하지 않는다.

### 5.3 판매 목록 회차 선택

- `/sales`의 회차 풀다운은 `list-sessions`로 `live_sessions`를 읽는다.
- 값은 UUID, 화면 라벨은 `display_code`다.
- 활성 회차는 `· 진행 중`으로 표시한다.
- 선택값은 `/sales?session=<회차 UUID>`에 저장한다.
- 상세 링크, 상세 화면의 목록 복귀, 삭제 후 복귀, 캡처 화면 링크가 쿼리를 유지한다.
- URL에 `session`이 없으면 `전체 회차`다.

## 6. 자동 판매 감지와 보류 처리

### 6.1 판매 후보 감지

구현: `src/services/salesExtractor.ts`, `src/context/LiveContext.tsx`

최종 STT 문장이고 길이가 3자 이상일 때만 판매 후보를 검사한다. 다음 중 하나가 있어야 한다.

- 확정 트리거: `구매확정`, `구매 확정`, `구매하신 분`, `구매하신분`, `결제완료`, `결제 완료`, `주문확정`, `낙찰`, `판매완료`
- `닉네임` 표현과 가격 표현의 동시 등장
- 소수점 가격 표현과 구매자 지칭 표현의 동시 등장

`판매`라는 단어 하나만으로는 판매 후보가 아니다. 판매 후보로 감지되지 않은 문장은 판매 레코드가 없으므로 AI가 재판단할 대상도 없다.

### 6.2 댓글 검증

1. `persistVoiceSale`이 활성 회차의 최근 클라우드 피드를 읽는다.
2. 필요하면 `get-sales-feed({ sessionId, limit: 50 })`를 즉시 호출해 최신 댓글을 보강한다.
3. 발화에서 추출한 닉네임을 같은 회차 `live_comments`와 대조한다.
4. 일치 근거가 충분하면 판매를 저장하고, 불충분하면 판매는 만들되 `보류`로 저장한다.

댓글 도우미의 클라우드 적재가 늦으면 판매가 먼저 보류될 수 있다. 이는 다른 회차 댓글을 잘못 연결하는 것보다 안전한 동작이다.

### 6.3 AI가 호출되는 조건

보류 생성 즉시 AI가 항상 호출되는 구조가 아니다.

1. 이미 `보류` 판매가 존재한다.
2. 그 뒤 20초 안에 판매가 아닌 최종 후속 발화가 들어온다.
3. 규칙 기반 해결을 먼저 실행한다.
4. 규칙으로 해결되지 않았고 원격 로그인·작업공간·AI 설정이 유효할 때 `trigger-pending-ai`를 호출한다.
5. AI 결과는 같은 회차 댓글, 등록 구매자, 상품 정보와 다시 교차 검증한 뒤 적용한다.

AI가 결론을 내지 못하거나 근거가 부족하면 `KEEP_PENDING`으로 보류를 유지한다. 서비스 장애와 근거 부족은 구분한다. 장애일 때만 설정된 2번 AI 슬롯으로 failover한다.

## 7. 주요 화면과 라우트

| 라우트 | 화면 | 메모 |
| --- | --- | --- |
| `/live` | 라이브 청취 홈 | 회차 선택, STT, 댓글, 자동 판매 카드 |
| `/seller/product-sales` | 상품 중심 판매관리 | `/sales/product` 별칭 존재 |
| `/comments` | 클라우드 댓글 기록 | `live_comments` 조회·삭제 |
| `/sales` | 클라우드 판매 목록 | 회차 풀다운과 URL 필터 |
| `/sales/:id` | 판매 상세·수정 | 목록 회차 필터 유지 |
| `/sales/:id/capture` | 판매 캡처 보기 | 상세 쿼리 유지 |
| `/sales/review` | 방송 후 보류 일괄 확인 | 검증 통과 건만 확정 |
| `/settlement` | 정산·CSV | 보류 건 제외 집계 |
| `/admin/ai` | 판매 AI 설정 | 보류·정정 2슬롯과 상태 |
| `/admin/sales` | 전체 판매·회차 관제 | 관리자 전용 |

## 8. API와 권한

`sales-api`는 `--no-verify-jwt`로 배포하지만 함수 내부 `authenticateRequest`가 JWT 또는 장치 토큰을 확인하고 capability를 검사한다. 배포 옵션만 보고 공개 API라고 판단하면 안 된다.

| action | capability | 용도 |
| --- | --- | --- |
| `get-bootstrap` | `SALES_READ` | 설정·활성 회차·상품 초기 상태 |
| `list-sessions` | `SALES_READ` | 판매 목록 회차 풀다운 |
| `start-session` | `SALES_WRITE` | 새 방송 회차 시작 |
| `get-sales-feed` | `SALES_READ` | 같은 회차 댓글·요약·상품 |
| `ingest-comments` | `COMMENT_INGEST` | 댓글 도우미 클라우드 적재 |
| `list-live-comments` | `SALES_READ` | 댓글 기록 목록 |
| `delete-live-comments` | `SALES_WRITE` | 선택 댓글 삭제 |
| `commit-sales` | `SALES_WRITE` | 상품 중심 판매 확정 |
| `resolve-pending-sale` | `SALES_WRITE` | 보류 결과 적용 |
| `trigger-pending-ai` | `SALES_WRITE` | 규칙 우선 보류 분석 시작 |
| `process-voice-correction` | `SALES_WRITE` | 음성 정정 분석 |

계약 파일은 `contracts/product-sales/v1`에 있다. 새 action을 추가하면 `schemas/request.schema.json`, fixture, 계약 테스트를 함께 갱신해야 한다. 현재 `list-sessions`는 서버·클라이언트에 구현됐으므로 다음 계약 정리 때 스키마 action 목록과 fixture 포함 여부를 확인한다.

## 9. 폴링과 호출량

`get-sales-feed` 자동 폴링은 로그인, `/live`, 실제 청취 중, 활성 회차 존재 조건을 모두 만족할 때만 2초 간격으로 실행된다. 동시 요청을 막고, 늦은 응답을 버리며, 실패 시 4초 → 8초 → 16초 → 최대 30초로 백오프한다. 청취 중지나 `/live` 이탈 시 타이머를 해제한다.

상품 판매 관리 화면은 자동 폴링하지 않고 새로고침 버튼에서만 `get-bootstrap`과 `get-sales-feed`를 호출한다.

| 호출원 | 동작 |
| --- | --- |
| `SalesContext` | 로그인 시 클라우드 판매 조회 + Supabase Realtime |
| `AiLiveStatusBadge` | 라이브 화면에서 약 15초마다 AI 상태 요청 |
| Android 판매 탭 | 화면 전면 상태에서 약 1.5초 피드 조회 |
| 댓글 도우미 | 댓글 발생 시 배치 `ingest-comments` |

Supabase 호출량이 다시 증가하면 `/live` 청취 여부와 Android 탭, AI 상태 배지를 각각 분리해 측정한다.

## 10. 개발 환경 구성

필수 도구는 Git, Node.js 20 이상, npm, Supabase 배포 계정, Vercel 배포 계정이다.

```powershell
git clone https://github.com/nettman001-hub/voice-pin-web.git C:\dev\voice-pin-web
cd C:\dev\voice-pin-web
npm ci
npm run dev
```

웹 환경 변수 이름:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_VOICECAP_API_BASE_URL=
```

Edge Function 비밀값은 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VOICECAP_PAIRING_PEPPER`, `VOICECAP_WEB_ORIGIN`이다.

댓글·프린터 도우미의 `server/.env`는 `server/.env.example`을 기준으로 만든다. 운영에서 중요한 이름은 `PORT`, `HOST`, `ALLOWED_ORIGINS`, `EULERSTREAM_API_KEY`, `VOICECAP_SALES_API_URL`, `VOICECAP_WORKSPACE_ID`, `VOICECAP_DEVICE_ID`, `VOICECAP_DEVICE_TOKEN`이다. 실제 값은 비밀 저장소나 해당 PC 환경 변수로 관리한다.

## 11. 검증 절차

### 11.1 코드 검사

```powershell
npx tsc --noEmit
npm test
npm run build
git diff --check
git status --short
```

최근 기능 변경마다 `npx tsc --noEmit`은 통과했다. 제한된 자동화 환경에서 `npm run build`와 Node test가 자식 프로세스 `spawn EPERM`으로 중단된 이력이 있으므로 일반 개발 PC나 Vercel 빌드에서 최종 확인한다. 최근 Vercel 프로덕션 빌드는 `Ready`였다.

### 11.2 댓글·판매 통합 확인

1. `/live`에서 새 회차를 시작한다.
2. 회차 이름이 `YYYY-MM-DD 라이브 N회차`인지 확인한다.
3. 댓글 도우미 연결 후 댓글을 남긴다.
4. `/comments`와 라이브 댓글에 같은 댓글이 나타나는지 확인한다.
5. Supabase `live_comments.session_id`가 활성 회차 UUID인지 확인한다.
6. 판매 확정 발화를 입력하고 자동 판매가 `sales`에 저장되는지 확인한다.
7. 닉네임 검증 근거가 같은 회차 댓글인지 확인한다.
8. 다른 회차의 같은 닉네임 댓글만 있을 때 자동 검증되면 안 된다.

### 11.3 판매 목록 회귀 확인

1. `/sales`에서 특정 회차를 선택하고 URL에 `?session=<UUID>`가 생기는지 확인한다.
2. 건별 또는 구매자별 상세 판매를 연다.
3. `판매 목록으로 돌아가기`를 누른다.
4. 이전 회차가 계속 선택되고 같은 목록이 보이는지 확인한다.
5. 브라우저 뒤로가기도 같은 결과인지 확인한다.

### 11.4 보류 AI 확인

1. 댓글 닉네임이 불충분한 판매 확정 발화를 만든다.
2. 판매가 `보류`로 저장되는지 확인한다.
3. 20초 안에 보완 발화를 입력한다.
4. 규칙이 먼저 적용되는지 확인한다.
5. 규칙으로 해결되지 않을 때만 AI task가 생기는지 확인한다.
6. AI 근거 댓글이 판매와 동일한 `session_id`인지 확인한다.

## 12. 배포

서버와 웹을 함께 바꿨다면 Edge Function을 먼저 배포한다. 프런트를 먼저 올리면 새 action을 호출하는 동안 서버가 이를 알지 못해 오류가 난다.

```powershell
npx --yes supabase@latest login
npx --yes supabase@latest functions deploy sales-api --project-ref ymegrhxpbeanvxwdzfym --no-verify-jwt
git push origin main
npx --yes vercel login
npx --yes vercel --prod --yes
```

배포 상태 확인:

```powershell
npx --yes vercel inspect https://<deployment>.vercel.app
curl.exe -s -o NUL -w "%{http_code}" https://www.voicecap.shop
```

`status ● Ready`와 운영 별칭 세 개를 확인한다. GitHub 자동 배포와 CLI 직접 배포가 겹치면 가장 최근 production deployment가 어떤 커밋인지 Vercel에서 확인한다.

`server/index.js`, `CloudCommentPublisher`, Socket.IO 이벤트를 바꾼 경우 Vercel 배포만으로 로컬 PC 도우미가 갱신되지 않는다. 운영 PC의 도우미 프로세스를 최신 코드로 재시작해야 한다. 브라우저는 도우미 연결 또는 재연결 시 `cloud:config`를 다시 보낸다.

웹과 Vercel 배포는 설치된 Android APK에 영향을 주지 않는다. Android 코드를 바꾼 경우 별도 APK/AAB 빌드와 배포가 필요하다.

```powershell
cd android\voicecapSMS
.\gradlew.bat :app:assembleRelease -PVOICECAP_API_BASE_URL=https://ymegrhxpbeanvxwdzfym.supabase.co/functions/v1
```

## 13. 장애 대응

### 판매 목록이 비어 있음

1. 로그인과 `workspaceId`를 확인한다.
2. 브라우저 Network에서 Supabase `sales` 조회 오류를 확인한다.
3. `sales.workspace_id`가 로그인 사용자의 작업공간과 같은지 확인한다.
4. RLS membership과 Realtime 구독 상태를 확인한다.
5. localStorage 데이터를 운영 판매 원본으로 복구하지 않는다.

### 댓글은 보이는데 판매가 계속 보류됨

1. 댓글과 판매의 `session_id`가 같은지 확인한다.
2. 댓글 도우미가 `cloud:config`를 받았는지 확인한다.
3. `live_comments.nickname_snapshot`과 발화 닉네임의 유사도 판정을 확인한다.
4. 댓글이 판매 발화 직후 늦게 적재됐다면 보완 발화 또는 수동 검토로 해결한다.

### 댓글 기록 화면과 라이브 댓글이 다름

1. 두 화면 모두 `live_comments`를 보는지 확인한다.
2. `get-sales-feed`에는 회차 필터가 있고 `/comments` 기본 목록에는 전체 회차가 표시된다는 차이를 확인한다.
3. 예전 `comments` 테이블이나 localStorage 댓글을 다시 읽는 코드가 생기지 않았는지 검색한다.

```powershell
rg -n "from\('comments'\)|getCommentRecords|addCommentRecords" src supabase server
```

### 새 API action이 지원되지 않음

프런트와 Edge Function 배포 순서가 어긋난 상태다. 같은 `main` 커밋의 `sales-api`를 먼저 재배포한 뒤 웹을 재배포한다.

### CLI 인증 오류

브라우저 Dashboard 로그인과 Supabase CLI 인증은 별개다. `npx --yes supabase@latest login`을 실행한다. 전역 Vercel CLI가 없거나 인증이 끊겼으면 `npx --yes vercel login` 후 `npx --yes vercel ...` 형식을 사용한다.

## 14. 롤백 원칙

1. 운영 장애가 AI 호출 폭증이면 우선 청취를 중지하거나 관리자 AI 설정에서 해당 슬롯을 비활성화한다.
2. 데이터 삭제나 스키마 역마이그레이션부터 하지 않는다.
3. 되돌릴 정상 커밋을 정한 뒤 해당 소스를 새 revert 커밋으로 만든다.
4. `sales-api`가 바뀐 커밋이면 Edge Function과 웹을 같은 상태로 배포한다.
5. 댓글 단일 원본 변경 전으로 프런트만 되돌리면 웹·규칙·AI가 서로 다른 댓글을 보게 되므로 금지한다.
6. `live_comments`나 `sales` 데이터를 localStorage로 복사해 임시 복구하지 않는다.

## 15. 다음 담당자의 우선 점검 목록

1. Supabase Organization 사용량과 2026-10-12 제한 예정 경고 해결
2. `list-sessions`를 계약 스키마와 fixture에 명시하고 계약 테스트 보강
3. 보류 생성 직후가 아닌 후속 발화 기반 AI 호출이 제품 의도와 맞는지 운영 데이터로 확인
4. 댓글 도우미 재연결 시 `cloud:config` 수신과 `live_comments.session_id` 점검
5. Android 1.5초 폴링과 AI 상태 배지 호출량 측정
6. 운영 DB 백업 정책 확인. Free 플랜이면 자동 백업 부재 가능성에 대비

## 16. 인수 완료 체크리스트

- [ ] GitHub `main` clone 및 `npm ci`
- [ ] `.env.local`을 비밀 저장소에서 복원
- [ ] Supabase CLI와 Vercel CLI 로그인 확인
- [ ] TypeScript, 테스트, 빌드 실행
- [ ] `/live` 새 회차 생성 및 청취 시작 확인
- [ ] 댓글 도우미의 현재 회차 `live_comments` 적재 확인
- [ ] 판매 `sales` 저장과 다른 브라우저 동기화 확인
- [ ] `/sales` 회차 풀다운과 상세 복귀 필터 유지 확인
- [ ] 보류 규칙·AI가 같은 회차 댓글만 보는지 확인
- [ ] Edge Function과 Vercel 배포 권한 확인
- [ ] Supabase 사용량 경고와 백업 정책 인계
