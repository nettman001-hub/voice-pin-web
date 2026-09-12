# VoiceCAP 개발·운영 인계인수서

> 기준 시각: 2026-09-12 KST
> 기준 브랜치: main
> 기준 커밋: ded4e5f — feat: start sales sessions from live listening
> 작업 트리: 커밋·푸시·운영 배포 완료 상태

이 문서는 새 컴퓨터 또는 다른 개발자가 현재 운영 상태를 그대로 이어받기 위한 단일 기준 문서다. 환경 변수·토큰·API 키의 실제 값은 문서나 Git에 기록하지 않는다.

## 1. 서비스와 운영 대상

| 항목 | 값 |
| --- | --- |
| GitHub 저장소 | https://github.com/nettman001-hub/voice-pin-web.git |
| 운영 브랜치 | main |
| 운영 웹 | https://www.voicecap.shop |
| Vercel 프로젝트 | voice-pin-web |
| Supabase 프로젝트 Ref | ymegrhxpbeanvxwdzfym |
| Supabase 대시보드 | https://supabase.com/dashboard/project/ymegrhxpbeanvxwdzfym |
| 핵심 Edge Function | sales-api (함수 내부 인증·권한 검사 사용) |
| 현재 웹 테스트 | npm test — 221 passed |
| 현재 웹 빌드 | npm run build — passed |

## 2. 가장 최근 변경 사항

### 2.1 Supabase 과다 호출 대응 이력

| 커밋 | 변경 내용 |
| --- | --- |
| a8a688e | get-sales-feed 리렌더 루프 제거. 요청 중복 방지, 오래된 응답 무시, 실패 지수 백오프 적용. |
| 4efc6bf | 판매 피드 자동 폴링 대상을 라이브·판매관리 라우트로 한정. |
| 7514b78 | 상품 판매 관리 화면의 피드를 자동 폴링에서 수동 새로고침으로 전환. |
| ded4e5f | 회차 자동 생성 제거, 청취 시작 시 회차 선택, 실제 청취 상태 기반 폴링, 라이브 판매 카드 수동 새로고침 추가. |

### 2.2 현재 회차·청취 동작

1. 로그인 뒤 ProductSalesProvider는 get-bootstrap을 한 번 호출한다.
2. get-bootstrap은 이제 활성 회차를 읽기만 하며 새 회차를 만들지 않는다.
3. /live에서 라이브 청취 시작을 누르면 회차 선택 모달이 열린다.
   - 활성 회차가 있으면 기존 회차와 이어서 하기를 선택할 수 있다.
   - 새 회차로 시작하기는 기존 ACTIVE 회차를 ENDED로 변경한 뒤 새 ACTIVE 회차를 만든다.
4. 회차를 선택한 뒤에만 음성 청취가 시작된다. 선택한 서버 회차 UUID를 웹 청취 회차 ID로 사용한다.
5. 청취 중지하기는 STT, 댓글 캡처, 판매 피드 폴링만 중지한다. 회차는 ACTIVE로 남겨 다음 시작 때 이어서 사용할 수 있다.

중요: 청취 중지와 회차 종료는 의도적으로 다르다. 회차를 끝내고 새로 시작하려면 다음 청취 시작 시 새 회차로 시작하기를 선택한다.

### 2.3 판매 피드 폴링 규칙

구현 파일: src/context/ProductSalesContext.tsx

폴링은 다음 조건을 모두 만족할 때만 시작된다.

1. 로그인 상태
2. 주소가 /live
3. LiveContext.isListening이 true
4. 선택된 activeSession이 존재

현재 기본 간격은 2,000 ms다.

~~~ts
const SALES_FEED_POLL_INTERVAL_MS = 2_000;
~~~

- 정상 시 요청 시작 간격은 약 2초다. 응답이 2초보다 오래 걸리면 응답 완료 직후 다음 요청을 시작한다.
- 동시에 두 요청을 보내지 않는다.
- 실패 시 4초 → 8초 → 16초 → 최대 30초까지 백오프한다.
- 청취 중지 또는 /live 이탈 시 타이머를 해제하고, 늦게 도착한 응답은 상태에 반영하지 않는다.
- 5초로 바꾸려면 위 상수만 5_000으로 변경하면 된다. 정상 상태에서 1인당 분당 호출량은 약 30회에서 약 12회로 줄어든다.

상품 판매 관리 화면(/seller/product-sales, 이전 별칭 /sales/product)은 자동 폴링하지 않는다. 상단 새로고침 버튼에서만 get-bootstrap과 get-sales-feed를 한 번씩 갱신한다.

### 2.4 자동 적재된 판매 내역 카드

구현 파일: src/pages/seller/LiveHomePage.tsx, src/context/SalesContext.tsx

- 이 카드는 get-sales-feed 결과가 아니라 SalesContext의 원격 판매 데이터와 Supabase Realtime 동기화 데이터를 사용한다.
- 청취 중에는 카드가 실시간으로 갱신된다.
- 청취를 중지하면 카드 목록을 마지막 상태로 고정한다.
- 카드 상단 새로고침 버튼을 누르면 refreshSales()가 판매 데이터를 한 번 다시 읽어 카드에 반영한다.
- Realtime 구독 자체는 판매 목록·정산 등 다른 화면의 동기화를 위해 유지된다. 이는 2초 주기 sales-api 폴링이 아니다.

## 3. 호출량을 다시 점검할 때 볼 곳

| 호출원 | 현재 동작 | 용량 관련 메모 |
| --- | --- | --- |
| ProductSalesContext의 get-bootstrap | 로그인 시 1회, 회차 선택·수동 새로고침·판매 처리 후 | 반복 폴링 아님 |
| ProductSalesContext의 get-sales-feed | 실제 /live 청취 중에만 기본 2초 | 이번 수정의 핵심 제어 대상 |
| ProductSalesPage | 수동 새로고침 버튼 클릭 시만 | 자동 폴링 없음 |
| AiLiveStatusBadge | 라이브 화면에서 약 15초마다 AI 상태 관련 3개 요청 | sales-api 호출량이 계속 많으면 별도 점검 대상 |
| Android ProductSalesView | 판매 탭이 전면일 때 약 1.5초 주기 | 웹 Vercel 배포로 설치된 APK는 바뀌지 않음 |
| 댓글 발행 서버 | 댓글이 들어올 때만 배치 ingest-comments | 시간 기반 무한 폴링 아님 |

Android 앱은 활성 회차가 없을 경우 진행 중인 회차 없음으로 표시하고 get-sales-feed 폴링을 시작하지 않는다. 최초 회차는 웹의 라이브 청취 시작 화면에서 선택·생성한다.

## 4. 핵심 파일 지도

| 목적 | 파일 |
| --- | --- |
| 웹 청취 시작·중지, STT 상태 | src/context/LiveContext.tsx |
| 회차 부트스트랩·피드 폴링·상품/판매 API 상태 | src/context/ProductSalesContext.tsx |
| 라이브 청취 홈, 회차 선택 모달, 판매 카드 | src/pages/seller/LiveHomePage.tsx |
| 원격 판매 목록 로딩·Realtime 동기화 | src/context/SalesContext.tsx |
| sales-api 프런트 호출 래퍼 | src/services/productSalesApi.ts |
| 회차 서버 로직 | supabase/functions/sales-api/handlers/sessions.ts |
| 상품 등록 서버 로직 | supabase/functions/sales-api/handlers/products.ts |
| 피드·댓글 서버 로직 | supabase/functions/sales-api/handlers/comments.ts |
| Android 판매 탭 | android/voicecapSMS/app/src/main/java/com/voicecap/sms/sales/ui/ProductSalesView.java |

## 5. 새 컴퓨터에서 시작하기

~~~powershell
git clone https://github.com/nettman001-hub/voice-pin-web.git C:\dev\voice-pin-anti
cd C:\dev\voice-pin-anti
npm ci
npm test
npm run build
npm run dev
~~~

필수 준비물:

- Node.js 20 이상
- Git
- Vercel 계정 로그인 상태 (vercel login)
- Supabase CLI는 전역 설치 대신 npx --yes supabase@latest 사용 가능
- Supabase 배포 권한이 있는 계정 로그인 상태 (npx --yes supabase@latest login)

환경 파일은 로컬에서만 설정한다.

- .env.local
- .env.production.local

이 파일에는 VITE_SUPABASE_URL, publishable/anon key 등만 두고 service_role·LLM 키 등 서버 비밀값을 Git에 넣지 않는다. 상세 구조는 SUPABASE_SETUP.md를 참고한다.

## 6. 수동 검증 절차

### 6.1 회차·폴링 검증

1. https://www.voicecap.shop/live에 로그인한다.
2. 청취를 시작하기 전에는 DevTools Network에서 반복 get-sales-feed 호출이 없어야 한다.
3. 라이브 청취 시작을 누른다.
4. 기존 활성 회차가 있으면 이어서, 필요하면 새 회차를 선택한다.
5. 탭 오디오를 공유한 뒤에만 약 2초 주기의 get-sales-feed가 발생하는지 확인한다.
6. 청취 중지하기를 누른다. 이후 새 get-sales-feed 요청이 시작되지 않아야 한다.
7. 판매 카드의 새로고침을 눌러 최신 판매 목록을 수동 반영한다.
8. 다시 청취를 시작해 기존 회차를 선택하면 같은 회차 코드·판매 기록을 계속 사용하는지 확인한다.
9. 새 회차를 선택하면 기존 회차가 ENDED, 새 회차만 ACTIVE인지 Supabase live_sessions에서 확인한다.

### 6.2 로컬 검사 명령

~~~powershell
npm test
npm run build
git status --short --branch
~~~

최근 기준 결과는 npm test 221 passed, npm run build passed다. Vite의 500 kB 번들 크기 경고는 기존 경고이며 빌드를 실패시키지 않는다.

## 7. 배포 절차

### 7.1 sales-api를 수정했을 때

프런트 배포 전에 Edge Function을 먼저 배포한다.

~~~powershell
npx --yes supabase@latest functions deploy sales-api --project-ref ymegrhxpbeanvxwdzfym --no-verify-jwt
~~~

ded4e5f는 위 명령으로 이미 운영 배포됐다. 함수 대시보드:
https://supabase.com/dashboard/project/ymegrhxpbeanvxwdzfym/functions

### 7.2 웹만 수정했을 때

~~~powershell
vercel --prod --yes
~~~

운영 별칭:

- https://www.voicecap.shop
- https://voicecap.shop
- https://voice-pin-web.vercel.app

배포 뒤 상태 확인:

~~~powershell
vercel inspect <deployment-url>
curl.exe -s -o NUL -w "%{http_code}" https://www.voicecap.shop
~~~

## 8. 운영 주의사항과 다음 점검 우선순위

1. 기존 코드가 자동으로 생성해 둔 ACTIVE 회차가 있을 수 있다. 운영자는 처음 청취 시작할 때 기존 회차를 이어가거나 새 회차를 선택해 정리한다.
2. get-sales-feed만 줄여도 Android 앱의 1.5초 피드 폴링과 라이브 AI 상태 배지의 15초 조회는 남아 있다. Supabase 경고가 계속되면 이 두 호출원을 다음 우선순위로 측정·조정한다.
3. Android 앱을 변경하면 별도로 APK/AAB를 다시 빌드·배포해야 한다. Vercel 배포는 Android 설치본에 영향을 주지 않는다.
4. 회차 생성 정책을 다시 바꿀 때는 handleGetBootstrap() 또는 handlePrepareProduct()에서 ACTIVE 회차를 자동 생성하지 않도록 유지한다. 자동 생성이 다시 들어가면 로그인만으로 폴링 조건이 참이 되는 문제가 재발한다.
5. 회차 선택 뒤 탭 오디오 공유가 필요한 이유: 브라우저 getDisplayMedia는 사용자 클릭 안에서 실행돼야 한다. LiveHomePage는 회차 API와 탭 오디오 공유 요청을 병렬 시작해 권한 창 차단을 피한다.

## 9. 롤백 원칙

운영 이상 시에는 먼저 관리자 AI 기능을 끄거나 청취를 중지해 호출을 멈춘 뒤 원인을 확인한다. 코드 롤백이 필요하면 GitHub의 이전 정상 커밋을 기준으로 별도 검토 후 되돌린다.

ded4e5f를 되돌릴 경우 프런트뿐 아니라 sales-api Edge Function도 같은 커밋 상태로 다시 배포해야 한다. 프런트만 되돌리거나 서버만 되돌리면 회차 생성 규칙과 UI가 서로 맞지 않을 수 있다.
