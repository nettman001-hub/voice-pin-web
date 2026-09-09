# VoiceCAP 개발·운영 인계인수서

> 기준 시각: 2026-09-09 15:10 KST
> 이 문서를 현재 인계의 단일 기준으로 사용한다. `PROJECT_HANDOVER.md`와 `NEW_PC_SETUP.md`는 과거 구조 설명을 포함한 참고 자료이며, 버전·배포 상태가 충돌하면 이 문서가 우선한다.

## 1. 현재 기준점

| 항목 | 현재 값 |
| --- | --- |
| GitHub | `https://github.com/nettman001-hub/voice-pin-web.git` |
| 운영 브랜치 | `main` |
| 최신 기능 커밋 | `d5afee6` — `fix: auto-create shared live sessions` |
| 핵심 기능 커밋 | `2e579fd` — `feat: unify voice and mobile product sales` |
| 운영 웹 | `https://www.voicecap.shop` |
| Vercel 프로젝트 | `nettman001-5045s-projects/voice-pin-web` |
| 최신 확인 배포 | `voice-pin-lhbpodydn-nettman001-5045s-projects.vercel.app` — Production Ready |
| Supabase project ref | `ymegrhxpbeanvxwdzfym` |
| Supabase 함수 | `sales-api`, `voicecap-onboard`, `device-pair`, `sms-bridge` |
| Android | `1.3.3`, versionCode `7`, package `shop.voicecap.smsbridge` |
| 웹 기술 | React 18, TypeScript 5.7, Vite 6, Tailwind CSS |
| Android 기술 | Java, minSdk 26, compileSdk 35, targetSdk 36, Gradle 9.3.1 |

`main`에 push하면 Vercel Production 배포가 자동 시작된다. Supabase 마이그레이션과 Edge Function은 자동 배포되지 않으므로 별도로 적용해야 한다.

## 2. 이번 인계 직전 완료된 기능

### 웹 음성 상품등록

- 라이브 청취 중 `상품등록`을 말하면 현재 화면을 상품 이미지로 캡처하고 30초 동안 상품 정보를 받는다.
- 이어서 `상품번호 12번`, `가격은 35,000원`과 같은 문장을 말하면 상품을 생성한다. 번호와 가격은 같은 문장에 있어도 된다.
- 실제 화면 캡처가 없으면 상품번호가 들어간 JPEG 대체 이미지를 브라우저에서 생성해 업로드한다.
- 상품 출처는 `WEB_VOICE`로 저장되며 UI에는 `음성` 배지로 표시된다.

### 웹 음성 판매등록

- `홍길동님 구매확정 금액 35,000원`과 같은 멘트가 감지되면 현재 활성 상품의 스냅샷을 판매에 함께 저장한다.
- 저장 항목에는 `product_id`, 상품번호, 상품명, 상품 이미지 경로, 수량, 단가, 출처가 포함된다.
- 등록 상품이 없어도 판매를 버리지 않는다. 최근 90초 내 캡처가 있으면 그것을 사용하고, 없으면 번호 이미지로 대체한다.
- 미등록 상품은 임의 6자리 상품번호와 단가 `0원`으로 먼저 생성한다. 상품번호 충돌 시 새 번호로 재시도한다.
- 클라우드 상품 생성 자체가 실패해도 판매 레코드는 로컬 대체 상품 정보와 함께 저장하도록 폴백이 있다.

### Android 상품등록

- 앱의 상품등록은 번호·가격 입력 후 전면 카메라를 연다.
- 카메라 권한을 요청하고 약 2초 카운트다운 뒤 실제 JPEG를 촬영한다.
- 사진을 `Pictures/VoiceCAP` 갤러리에 저장한다.
- 촬영 사진을 앱 화면에 1초간 보여준 뒤 signed upload URL로 업로드하고 상품을 확정한다.
- 촬영 또는 업로드 실패 시 재시도하거나 상품번호 이미지로 등록할 수 있다.
- Android가 등록한 상품 출처는 서버에서 `ANDROID`로 판별하며 UI에는 `앱` 배지로 표시된다.

### 웹·Android 공통 판매 데이터

- 웹과 Android는 동일한 Supabase `live_sessions`, `products`, `sales` 데이터를 사용한다.
- 활성 회차가 없는 작업공간에서 `get-bootstrap` 또는 상품 준비 요청이 오면 서버가 ACTIVE 회차를 하나 생성한다.
- 작업공간별 ACTIVE 회차는 DB partial unique index로 최대 하나만 허용한다. 웹과 앱의 동시 최초 접속도 재조회로 처리한다.
- 라이브 홈의 `자동 적재된 판매 내역`은 브라우저 로컬 회차뿐 아니라 Supabase 활성 회차 UUID도 포함한다.
- 목록에는 등록 상품 이미지, 상품번호/상품명, `앱·음성·웹·기존` 출처 배지가 표시된다.
- 기존 닉네임 클릭 → 구매확정 흐름은 유지되어 있다.
- 로그인 직후 `ProductSalesContext`가 다시 bootstrap하고, 이후 피드 polling으로 활성 상품과 회차를 갱신한다.

### 스키마와 이미지 저장

- `202609090001_product_zero_price.sql`이 운영 DB에 적용되어 임시 상품 단가 `0`을 허용한다.
- 상품 이미지는 Supabase private bucket `voicecap-private` 아래 `${workspaceId}/products/${productId}.jpg`로 저장한다.
- 브라우저는 signed URL을 받아 업로드하며, 읽기 URL도 signed URL로 변환한다.
- 판매의 `operation_id`는 DB UUID 형식에 맞게 `crypto.randomUUID()`를 사용한다.

## 3. 핵심 데이터 흐름

```text
웹 음성
  LiveContext 음성 파싱/화면 캡처
    -> ProductSalesContext.registerProduct
    -> sales-api prepare-product
    -> voicecap-private signed PUT
    -> sales-api commit-product
    -> active product
    -> SalesContext / remoteWorkspaceService
    -> public.sales

Android
  ProductRegistrationDialog
    -> sales-api prepare-product
    -> 전면 카메라 JPEG + MediaStore 갤러리 저장
    -> signed PUT
    -> sales-api commit-product
    -> 앱 댓글/닉네임 선택 판매확정
    -> public.sales

웹 표시
  ProductSalesContext bootstrap/feed + LiveHomePage
    -> 같은 workspace의 ACTIVE session UUID로 필터
    -> 상품 이미지/번호/출처 배지 표시
```

출처 값은 상품과 판매가 서로 다르므로 혼동하지 않는다.

| 구분 | DB 값 |
| --- | --- |
| 상품 | `WEB_VOICE`, `ANDROID`, `MANUAL` |
| 판매 | `WEB_VOICE`, `ANDROID_COMMENTS`, `MANUAL`, `LEGACY` |

## 4. 이번 변경의 핵심 파일

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| 음성 흐름 | `src/context/LiveContext.tsx` | 상품등록 음성 상태, 캡처, 미등록 상품 폴백, 음성 판매 저장 |
| 공통 상품 상태 | `src/context/ProductSalesContext.tsx` | bootstrap, polling, signed upload, prepare/commit |
| 판매 동기화 | `src/context/SalesContext.tsx` | 로그인 사용자의 판매를 Supabase에 저장 |
| 상품 이미지 | `src/services/productImageService.ts` | 번호 JPEG 생성 및 signed URL PUT |
| 원격 매핑 | `src/services/remoteWorkspaceService.ts` | 상품 스냅샷/출처 매핑, private 이미지 signed URL |
| 라이브 목록 | `src/pages/seller/LiveHomePage.tsx` | 공통 회차 판매 필터, 상품 이미지/번호/배지 |
| 수동 상품등록 | `src/pages/seller/ProductSalesPage.tsx` | 웹 수동 상품도 동일 등록 파이프라인 사용 |
| 타입 | `src/types/live.ts`, `src/types/productSales.ts` | 상품·판매 출처 및 이미지 필드 |
| API 상품 | `supabase/functions/sales-api/handlers/products.ts` | 실제 signed upload, 상품 출처, 회차 보장 |
| API 회차 | `supabase/functions/sales-api/handlers/sessions.ts` | ACTIVE 회차 자동 생성/재사용 |
| API 판매 | `supabase/functions/sales-api/handlers/sales.ts` | Android 판매 출처 판별 |
| DB | `supabase/migrations/202609090001_product_zero_price.sql` | 0원 임시 상품 허용 |
| Android UI | `android/voicecapSMS/app/src/main/java/com/voicecap/sms/sales/ui/ProductRegistrationDialog.java` | 카메라, 갤러리, 1초 미리보기, 폴백 |
| Android API | `android/voicecapSMS/app/src/main/java/com/voicecap/sms/sales/RealSalesRepository.java` | JPEG signed PUT |
| Android 권한 | `android/voicecapSMS/app/src/main/AndroidManifest.xml`, `MainActivity.java` | 카메라/갤러리 권한 |
| Android 버전 | `android/voicecapSMS/app/build.gradle` | v1.3.3 / code 7 |

## 5. 다른 컴퓨터에서 시작하는 순서

### 5.1 필수 설치

- Git for Windows
- Node.js 20 LTS 또는 22 LTS와 npm
- Android Studio 및 Android SDK Platform 35
- Android Studio 내장 JBR 또는 호환 JDK
- 선택: Vercel CLI와 Supabase CLI는 `npx`로도 실행 가능
- 선택: 로컬 STT/데스크톱 도우미까지 작업할 때 Python 3.10~3.11

### 5.2 저장소 받기

```powershell
git clone https://github.com/nettman001-hub/voice-pin-web.git C:\dev\voicecap-web
Set-Location C:\dev\voicecap-web
git checkout main
git pull --ff-only origin main
git log -5 --oneline
```

기능 기준 커밋 `d5afee6`과 `2e579fd`가 로그에 있어야 한다. 인계 문서 자체의 후속 커밋이 그 위에 있는 것은 정상이다.

### 5.3 패키지 설치

```powershell
npm ci

Set-Location server
npm ci
Set-Location ..

Set-Location desktop/comment-helper
npm ci
node scripts/stage-server.cjs
Set-Location ../..
```

자동 초기화 스크립트를 사용하려면 저장소 루트에서 다음을 실행할 수 있다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-new-pc.ps1
```

이 스크립트는 패키지 복원, `server/.env` 생성, Android SDK 탐색, 전체 빌드를 수행한다. 루트 `.env.local`, 계정 로그인, Android 배포 서명키는 별도로 준비해야 한다.

## 6. Git에 없는 파일과 계정

다음 항목은 의도적으로 Git에서 제외되어 새 컴퓨터에서 복구해야 한다.

| 항목 | 복구 방법 |
| --- | --- |
| 루트 `.env.local` | Vercel 프로젝트 환경변수 또는 Supabase Dashboard의 공개 API 설정을 확인해 재작성 |
| `server/.env` | `server/.env.example`을 복사하거나 bootstrap 스크립트로 생성 |
| `eulerstream_key.txt` | 기존 PC의 보안 저장소에서 옮기거나 Euler Stream에서 재발급 |
| `.vercel/` | 새 PC에서 Vercel 로그인 후 프로젝트 재연결 |
| `supabase/.temp/` | 새 PC에서 Supabase 프로젝트 재연결하면 생성됨 |
| `android/voicecapSMS/local.properties` | 새 PC Android SDK 경로로 생성 |
| Android JKS와 비밀번호 | 암호화 백업/비밀번호 관리자에서 복구. Git으로 전송 금지 |
| APK/AAB/EXE 산출물 | Git에 없으므로 새 PC에서 재빌드하거나 안전한 파일 저장소로 이동 |

루트 `.env.local`의 최소 형태는 다음과 같다. publishable/anon key만 사용하며 `service_role`은 절대 넣지 않는다.

```dotenv
VITE_SUPABASE_URL=https://ymegrhxpbeanvxwdzfym.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable 또는 anon key>
```

Android는 기본적으로 아래 운영 함수 주소를 빌드 설정에 내장한다.

```text
https://ymegrhxpbeanvxwdzfym.supabase.co/functions/v1
```

필요한 로그인/권한:

- GitHub 저장소 `nettman001-hub/voice-pin-web` push 권한
- Vercel 팀 `nettman001-5045s-projects`의 `voice-pin-web` 접근 권한
- Supabase project ref `ymegrhxpbeanvxwdzfym`의 CLI/대시보드 권한
- 운영 웹 판매자 또는 테스트 판매자 계정
- Play 배포 시 Google Play Console 권한과 원본 업로드 JKS

비밀번호, access token, service-role key, device token, JKS 비밀번호는 이 문서나 Git 커밋에 기록하지 않는다.

### CLI 연결

```powershell
# Vercel
npx vercel login
npx vercel link --project voice-pin-web --scope nettman001-5045s-projects

# Supabase
npx supabase login
npx supabase link --project-ref ymegrhxpbeanvxwdzfym
```

## 7. 표준 검증 명령

### 웹과 API 계약

```powershell
Set-Location C:\dev\voicecap-web
npm test
npm run build
```

인계 직전 결과:

- `npm test`: 44/44 통과
- `npm run build`: 성공, Vite chunk-size 경고만 존재

### Android

```powershell
Set-Location C:\dev\voicecap-web\android\voicecapSMS
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
```

표준 APK 출력:

```text
android/voicecapSMS/app/build/outputs/apk/debug/app-debug.apk
```

인계 PC에서 생성했던 별도 이름의 설치 파일은 다음과 같다. `build/`가 ignore되어 있으므로 clone에는 포함되지 않는다.

```text
android/voicecapSMS/build/voicecap-sms-v1.3.3-install.apk
크기: 937,114 bytes
SHA-256: DF090E7F424DAF6166AC76A9444B489DEDC27F791597A7CAD8A23CCD6705DF82
```

같은 이름이 필요하면 빌드 후 복사한다.

```powershell
New-Item -ItemType Directory -Force build | Out-Null
Copy-Item app\build\outputs\apk\debug\app-debug.apk build\voicecap-sms-v1.3.3-install.apk
```

### 로컬 서버와 데스크톱 도우미

```powershell
Set-Location C:\dev\voicecap-web\server
npm test

Set-Location ..\desktop\comment-helper
npm test
```

## 8. 배포 절차

### 웹/Vercel

```powershell
Set-Location C:\dev\voicecap-web
git status
git add <변경한 파일>
git commit -m "feat: 변경 요약"
git push origin main

npx vercel ls --scope nettman001-5045s-projects
```

- `main` push 후 Production이 `Ready`인지 확인한다.
- 안정 주소는 `https://www.voicecap.shop`이다.
- 프런트 변경이 없더라도 `main` push는 Vercel 배포를 새로 만들 수 있다.

### Supabase DB

```powershell
npx supabase migration list --linked
npx supabase db push
```

- SQL을 먼저 검토한 후 실행한다.
- 최신 적용 대상은 `202609090001_product_zero_price.sql`까지다.
- 이 Supabase 프로젝트는 다른 서비스와 공유될 수 있으므로 `supabase db reset`, 광범위한 DROP, 기존 Auth/Storage 삭제를 실행하지 않는다.

### Supabase Edge Function

```powershell
npx supabase functions deploy sales-api --project-ref ymegrhxpbeanvxwdzfym
```

이번 변경에서는 위 명령으로 `sales-api` 배포가 성공했다. `supabase/config.toml`의 `verify_jwt = false`는 함수 내부가 사용자 JWT 또는 device token을 자체 검증하기 위한 설정이므로 임의로 바꾸지 않는다.

다른 함수를 수정한 경우 해당 이름으로 별도 배포한다.

```powershell
npx supabase functions deploy voicecap-onboard --project-ref ymegrhxpbeanvxwdzfym
npx supabase functions deploy device-pair --project-ref ymegrhxpbeanvxwdzfym
npx supabase functions deploy sms-bridge --project-ref ymegrhxpbeanvxwdzfym
```

### Android Play 배포

서명 환경변수 4개를 모두 설정한 뒤 AAB를 만든다.

```powershell
$env:VOICECAP_UPLOAD_KEYSTORE='C:\secure\voicecap-upload.jks'
$env:VOICECAP_UPLOAD_STORE_PASSWORD='<secure value>'
$env:VOICECAP_UPLOAD_KEY_ALIAS='voicecap-upload'
$env:VOICECAP_UPLOAD_KEY_PASSWORD='<secure value>'

Set-Location C:\dev\voicecap-web\android\voicecapSMS
.\gradlew.bat :app:bundleRelease
```

출력은 `app/build/outputs/bundle/release/app-release.aab`이다. 기존 앱 업데이트에는 동일한 업로드 키가 반드시 필요하다.

## 9. 운영 확인 체크리스트

가능하면 운영 데이터 오염을 피하기 위해 테스트 작업공간에서 확인한다.

- [ ] `https://www.voicecap.shop` 로그인 후 `/seller/product-sales`에서 `진행 중인 회차 없음` 대신 회차 코드가 보인다.
- [ ] `/live`에도 같은 회차 코드가 보인다.
- [ ] `상품등록` → `상품번호 12번` → `가격은 35,000원`을 30초 안에 말한다.
- [ ] 상품 이미지와 `음성` 배지가 표시된다.
- [ ] `홍길동님 구매확정 금액 35,000원`을 말하고 자동 판매 목록에 상품번호/이미지가 보인다.
- [ ] 상품이 없는 상태의 구매확정도 임의 번호·0원 상품으로 저장된다.
- [ ] Android 앱을 다시 페어링하고 `PRODUCT_WRITE`, `SALES_READ`, `SALES_WRITE` 권한을 확인한다.
- [ ] Android 상품등록에서 전면 카메라 권한 요청, 실제 촬영, `Pictures/VoiceCAP` 저장, 1초 미리보기를 확인한다.
- [ ] Android에서 닉네임을 눌러 구매확정 후 웹 자동 목록에 `앱` 배지로 나타난다.
- [ ] 새로고침 후에도 상품 이미지가 signed URL로 다시 표시된다.

인계 직전 브라우저 운영 확인 결과:

- Vercel Production `Ready`
- 로그인 계정 유지 및 화면 로드 정상
- `/seller/product-sales`에서 자동 생성 회차 `20260909_15 (v1)` 확인
- `/live`에서 같은 회차와 `자동 적재된 판매 내역` 영역 확인
- 운영 데이터 오염을 막기 위해 실제 테스트 상품/판매는 생성하지 않음

## 10. 남은 실기기 검증과 주의사항

1. Android 카메라/갤러리 코드는 빌드와 단위 테스트까지만 통과했다. 연결된 실물 단말이 없어 OEM별 카메라 방향, 권한, MediaStore 저장, 1초 표시를 아직 확인하지 못했다.
2. `handlePrepareProductImage` 액션에는 과거 `storage.voicecap.local` placeholder 구현이 남아 있다. 현재 신규 흐름은 이 액션을 사용하지 않고 `prepare-product`가 반환하는 실제 signed upload URL을 사용한다. 새 기능을 legacy 액션에 연결하지 말고, 필요하면 먼저 실제 Storage 구현으로 교체한다.
3. 웹 화면 캡처는 브라우저의 화면/탭 공유 권한이 필요하다. 거부 시 상품번호 대체 이미지로 등록된다.
4. private 이미지 URL은 만료된다. DB에는 영구 public URL이 아니라 storage path를 저장하고, 읽을 때 signed URL을 다시 발급하는 구조를 유지한다.
5. bootstrap은 ACTIVE 회차가 없을 때 새 회차를 만든다. 회차를 종료한 뒤 상품판매 화면을 다시 열면 새 회차가 생기는 것이 현재 의도된 동작이다.
6. Android와 웹의 판매 출처 enum 이름이 다르다. DB check constraint와 TypeScript/Java 매핑을 함께 바꾸지 않으면 저장이 실패한다.
7. `sales.operation_id`는 UUID 컬럼이다. 임의 문자열 ID로 되돌리지 않는다.
8. Supabase project ref와 URL은 공개 식별자지만 publishable key 이외의 비밀키는 프런트나 APK에 넣지 않는다.

## 11. 다음 작업자가 먼저 할 일

1. 새 PC에서 저장소를 clone하고 이 문서를 읽는다.
2. `.env.local`과 CLI 로그인을 복구한다.
3. `npm ci`, `npm test`, `npm run build`를 실행한다.
4. Android Studio/JBR과 SDK 35를 준비하고 Android 테스트/APK 빌드를 실행한다.
5. 실물 Android 단말에서 카메라·갤러리·웹 연동 체크리스트를 가장 먼저 검증한다.
6. 문제가 있으면 상품 준비 → 이미지 PUT → 상품 commit → 판매 commit 순서와 각 HTTP 응답을 확인한다.

## 12. 관련 문서

- `docs/ANDROID_APP_USER_GUIDE.md`: Android 사용자 기능 설명
- `docs/plans/2026-09-07-product-sales/`: 상품 판매관리 설계·계약·수용 테스트
- `contracts/product-sales/v1/`: 공통 API 스키마와 fixture
- `SUPABASE_SETUP.md`: Supabase 최초 구성 배경
- `PROJECT_HANDOVER.md`: 전체 프로젝트의 과거 종합 설명
- `NEW_PC_SETUP.md`: 과거 새 PC 설정 요약
