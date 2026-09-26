# 1. 새 컴퓨터 설치와 환경 복제

[전체 설계도](../../PROJECT_REPLICATION_BLUEPRINT.md) · [다음: 웹 설계](02_WEB_DESIGN.md)

이 장의 명령은 Windows PowerShell 기준이다. 예시 저장 위치는 `C:\dev\voice-pin-anti`다. 다른 경로를 선택했다면 모든 명령에서 일관되게 바꾼다. `<...>` 표시는 실제 값을 넣을 자리이므로 그대로 실행하지 않는다.

## 1.1 먼저 정할 사항

| 확인 항목 | 기록할 내용 |
|---|---|
| 복제 목적 | 기존 서버 사용 / 새 독립 서버 / 업무 데이터까지 이전 |
| 기준 소스 | `62a464924b3785255e5d68e8898b14c23f66f554` 또는 승인된 다른 SHA |
| 사용할 클라우드 | Supabase 프로젝트 URL·ref, Vercel 프로젝트 이름 |
| 새 PC 역할 | 웹 개발 / 댓글·인쇄 / 오프라인 STT / Android 빌드 |
| 주변 장치 | 프린터 이름·용지 규격·마이크·Android 실기기 |
| 외부 서비스 | 실제 사용할 STT 제공자, Euler Stream, 판매 검증 AI |

기존 서비스에 접속하는 경우 데이터 이관·DB 초기화가 필요 없다. 새 서버를 만드는 경우 소스의 기본 운영 URL을 그대로 두지 않는다. 단순 화면 데모는 Supabase 미설정 상태에서도 일부 가능하지만 상품 판매·문자·클라우드 댓글까지 검증할 수 없다.

## 1.2 이전 PC에서 인수할 목록

| 항목 | Git 복제 포함 | 인수 방법 |
|---|---|---|
| 소스·migration·세 개의 package-lock | 포함 | Git의 정확한 커밋 복제 |
| 아직 커밋하지 않은 수정 | 미포함 | `git status --short` 확인 후 별도 변경분 인계 |
| 루트 `.env.local` | 미포함 | 필요한 변수만 새 파일에 작성 |
| 루트 `.env.example` | 이 기준 커밋에서는 미추적 | 아래 예시로 직접 작성 가능 |
| `server/.env.example` | 포함 | 새 `server/.env` 생성 |
| Euler Stream / STT / AI 키 | 미포함 | 서비스 관리자·비밀 저장소에서 인수 |
| PC 도우미 설정 | 미포함 | 앱 설정 확인, 새 PC 프린터·장치 다시 선택 |
| Whisper Vulkan exe/dll | 포함 | `server/bin/whisper-vulkan/` 검증 |
| Whisper 모델·Python venv | 미포함 | 설치·다운로드 또는 파일 검증 후 복원 |
| Android `local.properties` | 미포함 | 새 SDK 경로로 생성 |
| Android 배포 서명키 | 미포함 | 기존 앱 업데이트가 필요하면 원래 키 인수 |
| `.vercel`·로그인 세션 | 미포함 | 새 PC에서 서비스별 로그인·프로젝트 연결 |
| DB·Storage 업무 데이터 | 미포함 | 기존 서버 사용 또는 별도 백업/이관 |
| 브라우저의 인식 규칙·설정 | Git에는 미포함 | 규칙·훈련·캡처 영역은 workspace 동기화 확인, 나머지 로컬 설정 인수 |

`node_modules`, `dist`, Android `build`, Electron `release`는 소스 대신 인계할 대상이 아니다. 해당 도구로 다시 생성한다. 키를 제외한 인수 목록과 실제 비밀값 전달 경로를 분리해 관리한다. 웹 접속용 공개 키와 서버 관리용 service role 키는 서로 다른 용도다.

## 1.3 기준 도구와 버전

“무조건 최신 버전”보다 먼저 아래 검증 환경을 재현한다. 이 프로젝트에는 Node 버전을 고정하는 `.nvmrc`나 Python 의존성 lock이 없어 별도 기록이 필요하다.

| 도구 | 이 PC에서 확인한 값 / 기준 | 용도 |
|---|---|---|
| Git | 설치 필요 | 소스 복제 |
| Node.js | `24.12.0`에서 이번 검증 성공 | 웹·Node 서버·Electron 도구 |
| npm | `11.6.2`에서 이번 검증 성공 | lock 기반 패키지 설치 |
| JDK | Android Studio JBR `21.0.9`로 Android 검증 성공 | Gradle 실행 |
| Gradle | 저장소 wrapper `9.3.1` | 따로 전역 Gradle 설치하지 않음 |
| Android Gradle Plugin | `9.1.1` | Android 빌드 |
| Android SDK | Platform 35, Build-Tools 36.0.0 | 현재 `compileSdk 35`의 빌드 |
| Android target/min | `targetSdk 36`, `minSdk 26` | 실행·플랫폼 동작 기준 |
| Python | Python STT를 사용할 때 별도 구성 | 현재 시스템 Python 3.14.5 존재만으로 STT 호환 보장 안 됨 |
| GPU 드라이버 | 사용할 GPU의 Vulkan 또는 CUDA 지원 드라이버 | 오프라인 STT 경로에 따라 다름 |

AGP 9.1 계열 공식 호환표는 Gradle 9.3.1, Build-Tools 36.0.0, JDK 최소 17을 제시한다. 여기서는 실제 확인한 JBR 21 환경을 복제 기준으로 사용한다. “JDK 21만 가능”이라는 의미는 아니다. [Android 공식 호환표](https://developer.android.com/build/releases/agp-9-1-0-release-notes)

설치 후 새 PowerShell을 열어 확인한다.

```powershell
git --version
node --version
npm.cmd --version
java -version
```

`npm.ps1` 실행 정책 오류가 나오면 본 안내처럼 `npm.cmd`, `npx.cmd`를 사용한다. 시스템 전체 실행 정책을 바꾸는 것이 필수는 아니다.

### lock 파일에 기록된 주요 패키지

| 위치 | 정확한 버전 |
|---|---|
| 웹 | React 18.3.1, TypeScript 5.9.3, Vite 6.4.3, Tailwind 3.4.19 |
| 웹 DB 클라이언트 | `@supabase/supabase-js` 2.112.4 |
| 서버 | Express 4.22.2, Socket.IO 4.8.3, TikTok connector 2.4.4 |
| PC 도우미 | Electron 44.0.0, electron-builder 26.15.3, electron-updater 6.8.9 |

`package.json`의 `^5.7.2` 같은 값은 허용 범위이고 실제 lock 버전과 다를 수 있다. 재현 설치에는 `npm ci`를 사용한다. 이는 lock 파일과 package.json이 맞지 않으면 실패하며 lock 파일을 임의 갱신하지 않는다. [npm ci 공식 설명](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

## 1.4 소스 복제

아래는 **새 폴더**에서 이 문서의 기준 소스를 가져오는 예다. 이미 작업 중인 폴더에서는 먼저 변경분을 확인한다.

```powershell
New-Item -ItemType Directory -Path C:\dev -Force | Out-Null
git clone https://github.com/nettman001-hub/voice-pin-web.git C:\dev\voice-pin-anti
Set-Location C:\dev\voice-pin-anti
git switch -c codex/replica-setup 62a464924b3785255e5d68e8898b14c23f66f554
git rev-parse HEAD
git status --short
```

이 문서 자체는 위 분석 기준 커밋 이후에 작성됐다. 이 안내서도 새 PC에 가져가려면 문서를 포함한 후속 커밋 또는 `PROJECT_REPLICATION_BLUEPRINT.md`와 `docs/replication/`을 함께 전달한다. 변경 가능한 `main`의 최신 상태만 복제하면 향후 이 문서와 동작이 달라질 수 있다.

저장소 권한이 없는 계정에는 소유자가 접근 권한을 부여해야 한다. 인증 실패를 소스 오류로 판단하지 않는다.

## 1.5 의존성 세 곳 설치

```powershell
Set-Location C:\dev\voice-pin-anti
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw '웹 의존성 설치 실패' }

Set-Location C:\dev\voice-pin-anti\server
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw '서버 의존성 설치 실패' }

Set-Location C:\dev\voice-pin-anti\desktop\comment-helper
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'PC 도우미 의존성 설치 실패' }

Set-Location C:\dev\voice-pin-anti
```

처음에는 Electron 다운로드 등이 필요하므로 인터넷에 연결되어 있어야 한다. 설치 실패 시 마지막 오류부터 읽고 Node 버전, 네트워크·프록시, lock 파일 일치 여부를 확인한다. 처음부터 lock을 삭제하거나 `npm audit fix --force`로 버전을 바꾸면 재현 기준이 달라진다.

## 1.6 웹 환경변수 작성

루트에 `.env.local`을 만들고 다음을 입력한다. Supabase 프로젝트의 API 설정 화면에서 해당 프로젝트의 URL과 공개 클라이언트 키를 가져온다.

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

현재 웹의 Supabase 주소 생성은 [supabaseClient.ts](../../src/services/supabaseClient.ts)의 `VITE_SUPABASE_URL`을 기준으로 한다. 과거 예제의 `VITE_VOICECAP_API_BASE_URL`은 현재 `src`에서 읽는 곳이 확인되지 않았다. 그 값만 바꾸면 접속 서버가 바뀐다고 생각하지 않는다. Android의 `VOICECAP_API_BASE_URL` Gradle 속성과도 별개다.

`VITE_` 접두사 변수는 브라우저 빌드에 들어갈 수 있다. service role, 페어링 pepper, 업로드 서명키를 넣지 않는다. 파일을 저장한 뒤 실행 중인 Vite를 재시작해야 한다. 이미 만든 `dist`의 값을 바꾸려면 다시 빌드한다.

Vercel의 `api/ai-settings.ts`, `api/ai-health.ts`는 별도의 서버 환경변수를 읽는다. 로컬 Vite가 `.env.local`의 모든 항목을 `process.env`로 자동 전달한다고 가정하지 않는다. 이 API를 재현하려면 [웹 설계의 AI 보조 API 설명](02_WEB_DESIGN.md)을 확인한다. 특히 권한 검증 보완 없이 service role을 넣은 API를 공개 배포하지 않는다.

## 1.7 웹부터 실행

```powershell
Set-Location C:\dev\voice-pin-anti
npm.cmd run dev -- --strictPort
```

브라우저에서 `http://localhost:3000`을 연다. 터미널을 닫으면 개발 서버도 종료된다. 다른 명령은 새 PowerShell 창에서 실행한다. `--strictPort`는 3000이 사용 중일 때 임의의 다음 포트로 옮겨 CORS 설정과 달라지는 일을 피한다.

확인 순서:

1. 로그인 화면이 나오는지 확인한다.
2. 테스트 계정으로 로그인한다.
3. 온보딩 후 workspace가 생성·선택되는지 확인한다.
4. 판매 목록 조회가 가능한지 확인한다.
5. 청취 시작 시 회차 선택/생성을 진행한다. 로그인만으로 새 회차가 생성되는 구조가 아니다.

브라우저 F12 → Console과 Network에서 오류를 확인한다. 401은 인증, 403은 권한, CORS는 접속 origin 설정, 500은 서버 로그를 먼저 살펴본다. 구체적인 서버 오류 코드는 [백엔드 장](03_BACKEND_DATABASE.md)을 따른다.

## 1.8 로컬 서버 또는 PC 도우미 실행

두 가지 중 하나를 선택한다. **같은 2137 포트로 동시에 실행하지 않는다.** 현재 Electron 시작 코드가 그 포트를 점유한 프로세스를 종료하는 경로를 포함한다.

### 방법 A: 서버 코드 개발

```powershell
Set-Location C:\dev\voice-pin-anti\server
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

`server/.env`의 기본 항목:

```dotenv
PORT=2137
HOST=127.0.0.1
ALLOWED_ORIGINS=http://localhost:3000,https://YOUR_WEB_DOMAIN
EULERSTREAM_API_KEY=YOUR_EULER_KEY
SMS_BRIDGE_API_KEY=YOUR_RANDOM_LOCAL_BRIDGE_KEY
SMS_BRIDGE_DATA_FILE=./data/bridge.json
```

실제 무작위 키를 넣는다. 이 로컬 브리지 키는 Supabase 장치 토큰과 다르다. 현재 `/api` middleware 범위 때문에 STT REST 요청도 이 키를 요구할 수 있으며 Electron 내부 일부 REST 호출에는 헤더가 없다. 이 차이는 [4장](04_LOCAL_SERVER_DESKTOP_STT.md)에 설명한다.

```powershell
npm.cmd start
```

다른 터미널에서 상태 확인:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:2137/status
```

### 방법 B: 프린터까지 사용할 PC 도우미

```powershell
Set-Location C:\dev\voice-pin-anti\desktop\comment-helper
npm.cmd start
```

`start`는 서버 스테이징 후 Electron을 실행한다. `stage`가 소스 서버를 PC 앱 폴더로 복사하므로 변경은 원본 `server/`에서 한다. 프린터 출력은 Electron이 담당하므로 Node 서버만 실행해 실제 Windows 인쇄까지 된다고 가정하지 않는다.

설치 파일이 필요하면:

```powershell
npm.cmd run dist
```

산출물: `desktop/comment-helper/release/VoiceCAP-Comment-Helper-Setup.exe`. 배포 업로드가 목적이 아니라면 `npm run release`는 실행하지 않는다. 이 명령은 빌드 뒤 업로드까지 연결되어 있다.

Electron은 로컬 주소와 origin, 웹 열기 주소에 기존 서비스 값이 포함되어 있다. 독립 도메인으로 복제할 때는 [4장 수정 지점](04_LOCAL_SERVER_DESKTOP_STT.md)을 적용한 뒤 패키징한다.

## 1.9 클라우드 댓글·AI·오프라인 STT 추가 설정

댓글 수집기가 화면에 댓글을 보여주는 것과 Supabase `live_comments`에 적재하는 것은 다른 단계다. **현재 로그인한 웹은 Socket.IO로 받은 댓글을 자체 큐에 넣고 사용자 인증으로 `ingest-comments`를 호출한다.** 이 경로는 웹 로그인·workspace·활성 회차가 필요하다. 별도로 PC가 직접 적재하는 경로를 사용하려면 `VOICECAP_SALES_API_URL`, `VOICECAP_WORKSPACE_ID`, `VOICECAP_DEVICE_ID`, `VOICECAP_DEVICE_TOKEN` 등의 값과 현재 `sessionId`가 필요하다. PC 장치 변수는 웹 적재 경로까지 포함한 무조건적 필수값이 아니다. `.env.example`에 모든 고급 변수가 들어 있지는 않으며 실행 방식별 설정 위치와 중복 제거는 [4장](04_LOCAL_SERVER_DESKTOP_STT.md)을 따른다.

오프라인 STT는 다음 중 실제 사용할 한 경로부터 검증한다.

| 경로 | 필요한 것 | 첫 검증 |
|---|---|---|
| Python CPU | 호환 Python·venv·faster-whisper·모델 | CPU에서 준비 상태, 짧은 음성 인식 |
| Python CUDA | 위 구성 + 호환 NVIDIA GPU/CUDA 라이브러리 | CUDA 장치 선택 후 실제 전사 |
| Vulkan | 포함된 exe/dll + GGML 모델 + 드라이버 | Vulkan 선택, 모델 파일·백엔드 확인 |

현재 Python 설치 스크립트는 라이브러리 버전을 고정하지 않는다. 성공한 환경에서는 `python -m pip freeze`로 설치 목록을 별도 보관한다. 본 설계도는 GPU 종류별 성능이나 모든 Python 버전의 동작을 보증하지 않는다. 구체적인 설치·모델 경로는 4장에 있다.

클라우드 STT와 판매 검증 AI는 서로 다르다. STT는 말을 문자로 만들고 AI 검증은 이미 추출한 판매/정정의 의미를 판단한다. 각각 키·모델·접속 위치를 확인한다. 클라우드 서버에서 `127.0.0.1`은 판매자 PC를 가리키지 않는다.

## 1.10 Android 빌드

Android Studio SDK Manager에서 SDK Platform 35와 Build-Tools 36.0.0, Platform-Tools를 준비한다. SDK 경로가 기본 위치와 다르면 아래 변수에 실제 경로를 넣는다.

```powershell
Set-Location C:\dev\voice-pin-anti\android\voicecapSMS
$sdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (-not (Test-Path -LiteralPath $sdkPath)) { throw 'Android SDK 경로 확인 필요' }
$sdkForProperties = $sdkPath.Replace('\', '\\').Replace(':', '\:')
[IO.File]::WriteAllText((Join-Path (Get-Location) 'local.properties'), "sdk.dir=$sdkForProperties`n", [Text.UTF8Encoding]::new($false))
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat --version
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug '-PVOICECAP_API_BASE_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1'
```

`YOUR_PROJECT_REF`를 웹과 같은 프로젝트로 바꾼 뒤 실행한다. APK 위치는 `app/build/outputs/apk/debug/app-debug.apk`다. 기존 앱과 서명이 다르면 덮어쓰기 설치가 실패할 수 있다. 기존 데이터를 무조건 삭제하지 말고 [5장](05_ANDROID_DESIGN.md)의 서명·기기 연결 설명을 따른다.

앱 설치 뒤 웹 마이페이지에서 연결 코드를 발급하고 앱의 문자연동 탭에서 등록한다. 판매 탭까지 사용하려면 웹 `/seller/devices`에서 해당 기기의 `SALES_READ`, `SALES_WRITE`, `PRODUCT_WRITE` 권한을 부여·저장한다. 신규 페어링의 기본 권한은 `SMS`뿐이다. 앱을 다시 실행하고 실제 작업공간의 판매 데이터가 보이는지 확인한다.

## 1.11 새 Supabase를 만드는 경우에만

기존 서버를 재사용한다면 이 절차를 건너뛴다. 새 빈 프로젝트에 적용할 절차다. 기존 운영 프로젝트에 migration을 무조건 재실행하지 않는다.

1. Supabase에서 새 프로젝트를 만들고 프로젝트 ref, URL, 공개 키를 기록한다.
2. 로컬 소스를 새 프로젝트에 연결한다.
3. migration을 검토하고 적용한다.
4. 코드/SQL 불일치를 보완한 별도 migration을 작성·검증한다.
5. 함수 비밀값, Auth URL, Storage, Realtime을 설정한다.
6. 네 함수를 배포한다.
7. 테스트 사용자와 workspace를 생성하고 기기를 새로 연결한다.

```powershell
Set-Location C:\dev\voice-pin-anti
npx.cmd supabase --version
npx.cmd supabase login
npx.cmd supabase link --project-ref YOUR_NEW_PROJECT_REF
npx.cmd supabase migration list
npx.cmd supabase db push --dry-run
```

대상과 목록이 맞고 [3장의 migration 및 정합성 항목](03_BACKEND_DATABASE.md)을 검토한 후:

```powershell
npx.cmd supabase db push
npx.cmd supabase migration list
```

CLI 버전은 저장소에 고정되어 있지 않다. 첫 검증에 사용한 `supabase --version`을 기록하고 팀의 도구 버전을 고정한다. `npx` 방식 CLI에는 Node 20 이상이 필요하다. 로컬 Supabase 전체 스택을 실행할 때에는 별도 컨테이너 환경이 필요하지만, 이 장은 관리형 Supabase에 연결하는 경로다. [Supabase CLI 안내](https://supabase.com/docs/guides/local-development/cli/getting-started)

`db push`는 원격 DB를 변경한다. `--dry-run`은 적용 대상을 미리 보는 단계이며 실제 적용을 대신하지 않는다. 운영 DB에서 `db reset`을 복제 절차로 사용하지 않는다. [Supabase 원격 migration 절차](https://supabase.com/docs/guides/local-development/cli-workflows)

비밀값은 Dashboard의 Edge Function secrets에서 설정하거나 저장소 밖의 비밀 파일을 통해 등록한다. 기본 플랫폼 변수 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`와 애플리케이션 변수 `VOICECAP_PAIRING_PEPPER`, `VOICECAP_WEB_ORIGIN`, 사용할 AI 관련 값을 [3장](03_BACKEND_DATABASE.md)과 맞춘다. 장치 토큰은 등록된 프로젝트와 맞아야 한다. pepper는 연결 코드 해시에 사용하므로 기존 코드가 유효한 도중 바꾸면 코드 claim이 실패할 수 있다.

```powershell
npx.cmd supabase functions deploy voicecap-onboard --no-verify-jwt
npx.cmd supabase functions deploy device-pair --no-verify-jwt
npx.cmd supabase functions deploy sms-bridge --no-verify-jwt
npx.cmd supabase functions deploy sales-api --no-verify-jwt
```

위 플래그는 Supabase 게이트웨이 JWT 검사를 끄는 것이며, 함수 내부 인증을 생략하라는 뜻이 아니다. 현재 구현의 권한 보완사항은 3장에 별도로 있다.

Auth Site URL은 새 웹 주소, Redirect URL은 개발 주소와 실제 비밀번호 재설정 경로를 등록한다. `VOICECAP_WEB_ORIGIN`은 쉼표 목록이 가능한지 추측하지 말고 공유 함수의 CORS 구현과 맞춘다. Realtime publication은 저장소 migration에 자동 등록 내용이 없으므로 [3장 대상 테이블](03_BACKEND_DATABASE.md)을 확인한다.

## 1.12 독립 웹 배포와 URL 교체

현재 저장소의 배포 대상은 Vercel이다. [vercel.json](../../vercel.json)은 `/api/` 이외 경로를 `index.html`로 보내 SPA 새로고침을 지원한다.

1. 새 Vercel 프로젝트를 저장소와 연결한다.
2. 프로젝트 루트를 웹 저장소 루트로 정한다.
3. Build command는 `npm run build`, Output directory는 `dist`로 확인한다.
4. Preview/Production 각각 환경변수를 설정한다.
5. Preview에서 로그인·직접 URL 접근·서버 함수 호출을 검증한다.
6. 검증된 결과를 실제 도메인에 연결한다.

독립 복제 시 변경 지점:

| 위치 | 확인할 값 |
|---|---|
| 웹 `.env.local`·Vercel env | 새 Supabase URL/공개 키 |
| `api/ai-settings.ts`, `api/ai-health.ts` | 기존 Supabase fallback URL 및 서버 인증 |
| Android Gradle 속성 | 새 `/functions/v1` base URL |
| `server/.env` | 허용 origin·클라우드 댓글 API·workspace·장치 토큰 |
| Electron `main.cjs` | 기존 웹 열기 URL·origin 허용 목록·업데이트 주소 |
| Electron package/업로드 script | GitHub owner/repo·릴리스 위치 |
| 웹 helper download service | 기존 다운로드 URL·버전 상수 |
| Supabase Auth/CORS | 새 도메인·redirect URL |

주소만 치환하고 테스트를 생략하면 브라우저는 새 DB, PC 도우미는 기존 DB를 바라보는 혼합 구성이 생길 수 있다. 각 구성요소의 프로젝트 ref와 workspace/session ID를 함께 확인한다.

## 1.13 데이터까지 이전하는 경우

DB 구조 복제와 데이터 복원은 다르다. 먼저 별도 복원 환경에서 다음 묶음을 검사한다.

| 묶음 | 주의할 관계 | 복원 검증 |
|---|---|---|
| Auth 계정 | 프로필·workspace membership의 사용자 ID | 실제 로그인과 소유 workspace 일치 |
| workspace·회원 | 모든 업무 행의 workspace_id | 작업공간별 행 수·조회 권한 |
| 회차·상품·구매자·판매 | UUID/FK·revision·예약·중복키 | 회차별 수량·금액·중복 수 |
| 댓글·문자·첨부 | 판매 근거·external ID·파일 경로 | 샘플 열람·중복 처리 |
| Storage | DB에 기록된 경로와 실제 객체 | private 접근·이미지 열람 |
| 장치·페어링 | 토큰 해시·pepper·폐기 상태 | 새 환경에서는 재페어링 검증 |
| AI·설정·이력 | 전역/작업공간 설정 범위 | 실제 적용 설정과 호출 위치 |

완전한 데이터 복원은 프로젝트에서 제공하는 단일 스크립트로 구현되어 있지 않다. 기존 서비스의 DB 백업, Auth 복원 방식, Storage 객체를 담당자로부터 인수해야 한다. 공개 `sales` 테이블만 CSV로 복사해서 계정과 파일까지 이전되었다고 판단하면 안 된다. 이행 시각을 정하고 최종 백업 이후 변경분을 반영한 뒤 검증해야 한다.

## 1.14 기존 자동 설치 스크립트의 범위

[bootstrap-new-pc.ps1](../../scripts/bootstrap-new-pc.ps1)은 루트·server의 `npm ci`, 서버 env/로컬 키 생성, Euler 키 입력, SDK 경로 작성, 일부 빌드를 도와준다. 그러나 다음은 대신하지 않는다.

- 루트 웹 Supabase 환경변수 작성
- Electron 의존성 설치·패키징
- Supabase migration·함수·Auth·Realtime 구성
- 오프라인 STT 전체 의존성과 모델 복원
- 브라우저 설정·프린터·기기 페어링 복원
- 모든 테스트와 실서비스 인수 검증

스크립트는 `JAVA_HOME`이 있으면 먼저 사용한다. 그 값이 원하는 JDK인지 확인해야 한다. `-EnableLanBridge`는 별도 Node 서버 설정과 관계있으며 Electron 강제 loopback 동작을 바꾸지는 않는다. 초보자는 이 장의 수동 절차로 각 단계 성공을 이해한 후 스크립트를 보조 도구로 사용하면 된다.

## 1.15 설치 완료 기준

- [ ] Git 기준 SHA와 세 lock 파일이 일치한다.
- [ ] 웹 로그인·workspace·판매 목록이 동작한다.
- [ ] 현재 회차가 웹·PC 댓글 발행·Android에서 일치한다.
- [ ] 로컬 댓글 수신뿐 아니라 DB의 댓글 행까지 확인했다.
- [ ] 선택한 STT가 실제 음성으로 동작한다.
- [ ] 인쇄가 필요하면 Windows 실제 출력과 중복 방지를 확인했다.
- [ ] Android 빌드·재페어링·문자/상품 판매를 검증했다.
- [ ] 독립 서버라면 3장의 미해결 사항을 처리하고 다른 workspace 접근을 검사했다.
- [ ] [6장](06_IMPLEMENTATION_AND_ACCEPTANCE.md)의 새 PC 결과표를 작성했다.
