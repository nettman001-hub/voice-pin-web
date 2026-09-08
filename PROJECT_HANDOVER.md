# VoiceCAP 프로젝트 통합 인계인수서 (Handover Document)

> **최종 개정일**: 2026년 9월 9일 (Asia/Seoul)
> **프로젝트**: VoiceCAP (라이브 커머스 상품 중심 판매관리 + 실시간 댓글 수집 + 감열식 영수증 자동 출력 + 모바일 SMS/판매 브리지 + 오프라인 하이브리드 STT)  
> **공식 저장소**: [https://github.com/nettman001-hub/voice-pin-web](https://github.com/nettman001-hub/voice-pin-web)  
> **운영 브랜치**: `main` (Vercel 프로덕션 자동 배포 연동)  
> **작업 브랜치**: `codex/product-sales-single-agent`  
> **운영 웹 주소**: [https://www.voicecap.shop](https://www.voicecap.shop)  
> **최신 릴리스**: 데스크톱 도우미 `v1.3.5` / 안드로이드 앱 `v1.3.2`

---

## 📌 목차
1. [프로젝트 개요 및 최신 운영 기준점](#1-프로젝트-개요-및-최신-운영-기준점)
2. [전체 시스템 아키텍처 및 4대 서브시스템](#2-전체-시스템-아키텍처-및-4대-서브시스템)
3. [새 컴퓨터에서 개발 환경 구축 가이드 (Step-by-Step)](#3-새-컴퓨터에서-개발-환경-구축-가이드-step-by-step)
4. [환경변수 및 필수 설정 파일 (Secrets & Configs)](#4-환경변수-및-필수-설정-파일-secrets--configs)
5. [컴포넌트별 빌드 및 검증 명령어 매뉴얼](#5-컴포넌트별-빌드-및-검증-명령어-매뉴얼)
6. [데이터베이스 스키마 및 마이그레이션 (Supabase)](#6-데이터베이스-스키마-및-마이그레이션-supabase)
7. [배포 절차 (Web, Edge Functions, Desktop, Android)](#7-배포-절차-web-edge-functions-desktop-android)
8. [운영 계정 및 E2E 실시간 판매 검증 체크리스트](#8-운영-계정-및-e2e-실시간-판매-검증-체크리스트)
9. [자주 묻는 질문 및 트러블슈팅 FAQ](#9-자주-묻는-질문-및-트러블슈팅-faq)

---

## 1. 프로젝트 개요 및 최신 운영 기준점

VoiceCAP은 라이브 커머스 판매자를 위한 **실시간 댓글 수집·터치 기반 상품 판매 등록·감열식 영수증 자동 출력·SMS 고객 연동·음성인식(STT) 통합 솔루션**입니다.

### 운영 인프라 현황

| 항목 | 상세 정보 | 비고 |
| :--- | :--- | :--- |
| **Git 저장소** | `https://github.com/nettman001-hub/voice-pin-web.git` | GitHub 원격 저장소 |
| **운영 브랜치** | `main` | Push 시 Vercel Production 자동 배포 |
| **Vercel 프로젝트** | `voice-pin-web` | 도메인: `www.voicecap.shop`, `voicecap.shop` |
| **Supabase 프로젝트** | `ymegrhxpbeanvxwdzfym` (sermon-guide-db 공유) | 위치: `https://ymegrhxpbeanvxwdzfym.supabase.co` |
| **Edge Functions** | `sales-api`, `voicecap-onboard`, `device-pair`, `sms-bridge` | Base URL: `.../functions/v1` |
| **데스크톱 도우미** | `desktop/comment-helper` (v1.3.5) | Electron 44, Windows x64 NSIS 인스톨러 |
| **안드로이드 앱** | `android/voicecapSMS` (v1.3.2, `shop.voicecap.smsbridge`) | Java 17, compileSdk 35 / targetSdk 36 |
| **공통 규격** | `contracts/product-sales/v1/` | JSON Schema v1 및 44개 자동 검증 테스트 완비 |

---

## 2. 전체 시스템 아키텍처 및 4대 서브시스템

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 VoiceCAP 통합 플랫폼 아키텍처                                   │
├──────────────────────────────┬──────────────────────────────┬───────────────────────────────┤
│    🌐 웹 프론트엔드 (Vercel)    │   ☁️ 클라우드 백엔드 (Supabase)  │    📱 안드로이드 앱 (v1.3.2)    │
│  React 18 + TS + Vite + TW   │   Postgres RLS + Edge Funcs  │  Java 17 + AndroidX + Camera  │
├──────────────────────────────┼──────────────────────────────┼───────────────────────────────┤
│ • 실시간 방송 댓글/판매 대시보드│ • /sales-api (13개 공통 액션)│ • 🛍 판매관리 탭               │
│ • 상품 등록/2초 타이머/번호이미지│ • /voicecap-onboard (회원/STT)│   - 1.5초 댓글 폴링 & 다중 합산 │
│ • 단가 소급 수정 & 정정 전표   │ • /device-pair (1회용 보안코드)│   - 2초 타이머 전면 카메라    │
│ • 기기 및 출력 프린터 권한 관리│ • /sms-bridge (문자 중계)     │   - 단가 소급 수정 & 전표 안내  │
│ • 관리자 공용 STT 설정        │ • 세션/상품/판매/구매자/출력DB│ • 💬 문자연동 탭 (SMS Bridge) │
└──────────────┬───────────────┴──────────────┬───────────────┴───────────────┬───────────────┘
               │                              │                               │
               │ WebSocket (포트 2137)        │ HTTPS (X-Device-Token)        │ HTTPS
               ▼                              ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                          🖥️ PC 데스크톱 댓글 도우미 (desktop/comment-helper v1.3.5)          │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ • 틱톡 라이브 웹소켓 실시간 댓글 수집 (tiktok-live-connector + eulerstream_key.txt)         │
│ • 클라우드 인쇄 큐 폴링 워커 (server/cloudPrintWorker.js / server/printJobStore.js)          │
│ • Windows 감열식 라벨/영수증 자동 출력 (Xprinter, 50x30, 80mm ESC/POS 및 텍스트 래스터)       │
│ • 하이브리드 오프라인 STT 엔진 (server/sttBridge.js):                                        │
│   - AMD RX 6800 XT / Intel: whisper.cpp Vulkan 가속 (server/bin/whisper-vulkan/, 포트 2139) │
│   - NVIDIA GPU: faster-whisper CTranslate2 CUDA 가속 (server/stt_worker.py)                 │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 서브시스템별 핵심 역할
1. **웹 프론트엔드 (`src/`)**: 판매자가 PC 브라우저에서 라이브 방송을 청취하고 실시간 핀 고정, 상품 등록, 판매 수정, 매출 정산, 기기 권한을 관리합니다.
2. **Supabase Edge Server (`supabase/`)**: 모든 모바일·PC·웹의 요청을 중계하며, `workspace_id` 테넌트 격리, 낙관적 락(`revision`), 멱등성(`operationId`)을 보장합니다.
3. **데스크톱 댓글 도우미 (`desktop/comment-helper/`)**: PC에서 실행되어 틱톡 방송 댓글을 스크래핑하고, 클라우드에 생성된 판매/정정 전표를 로컬 감열식 영수증 프린터로 즉시 인쇄합니다.
4. **모바일 안드로이드 앱 (`android/voicecapSMS/`)**: 방송 진행자가 이동 중 스마트폰으로 댓글을 터치해 판매를 즉시 접수하고, 스마트폰의 기본 SMS 앱 역할을 통해 고객 주문 문자를 클라우드와 중계합니다.

---

## 3. 새 컴퓨터에서 개발 환경 구축 가이드 (Step-by-Step)

다른 컴퓨터(새 PC)에서 본 프로젝트를 인계받아 즉시 개발·빌드할 수 있도록 구성하는 전체 절차입니다.

### 3.1 필수 소프트웨어 설치

| 도구 | 권장 버전 | 다운로드 및 설치 안내 |
| :--- | :--- | :--- |
| **Git** | 최신 64-bit | [git-scm.com](https://git-scm.com/) (Git Credential Manager 활성화) |
| **Node.js** | **v20.x LTS** 또는 **v22.x** | [nodejs.org](https://nodejs.org/) (npm 포함) |
| **Java JDK** | **Microsoft OpenJDK 17** (LTS) | [Microsoft Build of OpenJDK 17](https://learn.microsoft.com/ko-kr/java/openjdk/download#openjdk-17) |
| **Android Studio** | Ladybug / Koala 최신 | [developer.android.com/studio](https://developer.android.com/studio) (SDK Platforms: API 35) |
| **Python** | Python 3.10 또는 3.11 64-bit | [python.org](https://www.python.org/) (NVIDIA CUDA 환경 개발 시 필수) |

### 3.2 환경변수 영구 설정 (Windows PowerShell)

관리자 권한 PowerShell에서 시스템 환경변수를 등록합니다:

```powershell
# 1. Java 17 환경변수 등록 (설치 경로에 맞게 조정)
[System.Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot", "Machine")

# 2. Android SDK 환경변수 등록 (사용자 계정명 확인)
$androidSdkPath = "$env:LOCALAPPDATA\Android\Sdk"
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", $androidSdkPath, "Machine")

# 3. PATH에 Java 및 Android 플랫폼 도구 추가
$oldPath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$newPath = "$oldPath;C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot\bin;$androidSdkPath\platform-tools;$androidSdkPath\cmdline-tools\latest\bin"
[System.Environment]::SetEnvironmentVariable("Path", $newPath, "Machine")
```

> **확인**: 새 PowerShell 창을 열고 `java -version`, `javac -version`, `node -v`, `npm -v`가 모두 정상 출력되는지 확인합니다.

---

### 3.3 저장소 복제 및 컴포넌트별 패키지 설치

```powershell
# 1. 저장소 클론
git clone https://github.com/nettman001-hub/voice-pin-web.git C:\dev\voicecap-web
cd C:\dev\voicecap-web

# 2. 루트 웹 프론트엔드 의존성 설치
npm install

# 3. 로컬 서버 백엔드 의존성 설치
cd server
npm install
cd ..

# 4. 데스크톱 댓글 도우미 의존성 설치 및 서버 스테이징
cd desktop/comment-helper
npm install
node scripts/stage-server.cjs
cd ../..
```

---

## 4. 환경변수 및 필수 설정 파일 (Secrets & Configs)

보안상 Git 저장소에는 비밀키 원문이 포함되지 않습니다. 새 컴퓨터에서 다음 설정 파일을 준비해야 합니다.

### 4.1 루트 웹앱 환경변수: `.env.local` 또는 `.env`
위치: `C:\dev\voicecap-web\.env.local`
```dotenv
VITE_SUPABASE_URL=https://ymegrhxpbeanvxwdzfym.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_VOICECAP_API_BASE_URL=https://ymegrhxpbeanvxwdzfym.supabase.co/functions/v1
```

### 4.2 로컬 서버 환경변수: `server/.env`
위치: `C:\dev\voicecap-web\server\.env`
```dotenv
PORT=2137
SMS_BRIDGE_API_KEY=<generate-a-strong-unique-key>
TIKTOK_ROOM_ID=
```

### 4.3 틱톡 라이브 서명 키: `eulerstream_key.txt`
위치: `C:\dev\voicecap-web\eulerstream_key.txt` (또는 `server/eulerstream_key.txt`)
- 틱톡 웹소켓 라이브 댓글 수집 서명에 사용되는 Euler Stream API 키입니다. (미입력 시 커뮤니티 기본 한도로 폴백 동작)

### 4.4 안드로이드 SDK 경로 설정: `android/voicecapSMS/local.properties`
위치: `C:\dev\voicecap-web\android\voicecapSMS\local.properties`
```properties
sdk.dir=C\:\\Users\\<현재사용자명>\\AppData\\Local\\Android\\Sdk
```

### 4.5 안드로이드 배포 서명 키 (선택 사항)
Google Play Console용 배포 빌드(`app-release.aab`)를 생성할 때만 필요합니다:
```powershell
$env:VOICECAP_UPLOAD_KEYSTORE='C:\secure\voicecap-upload.jks'
$env:VOICECAP_UPLOAD_STORE_PASSWORD='스토어비밀번호'
$env:VOICECAP_UPLOAD_KEY_ALIAS='voicecap-upload'
$env:VOICECAP_UPLOAD_KEY_PASSWORD='키비밀번호'
```

---

## 5. 컴포넌트별 빌드 및 검증 명령어 매뉴얼

새 컴퓨터에서 환경 구축 후 각 컴포넌트가 완벽히 동작하는지 검증하는 표준 명령어입니다.

### 5.1 공통 계약 및 API 검증 (44개 통합 테스트)
```powershell
cd C:\dev\voicecap-web
npm test
```
- **기대 결과**: `pass 44 / fail 0` (Schema, Fixtures, 멱등성, 1인 다중댓글 합산, 소급수정 차액, 401/403/409/422 에러 핸들링 전 항목 통과)

### 5.2 웹 프론트엔드 빌드 및 로컬 개발 서버
```powershell
cd C:\dev\voicecap-web
# 프로덕션 번들 빌드 검증 (TypeScript 타입 검사 + Vite 빌드)
npm run build

# 로컬 개발 서버 실행 (http://localhost:5173)
npm run dev
```

### 5.3 로컬 서버 백엔드 단위 테스트
```powershell
cd C:\dev\voicecap-web\server
npm test
```
- **기대 결과**: `pass 11 / fail 0` (CloudCommentPublisher, CloudPrintWorker, PrintJobStore, SttBridge 수발신 테스트)

### 5.4 데스크톱 댓글 도우미 테스트 및 실행
```powershell
cd C:\dev\voicecap-web\desktop\comment-helper
# 1. 서버 코드 스테이징
node scripts/stage-server.cjs

# 2. UI 및 인쇄 테스트
npm test

# 3. 개발 모드로 일렉트론 앱 실행
npm start

# 4. Windows 설치 파일(EXE) 생성 (release/VoiceCAP-Comment-Helper-Setup.exe)
npm run dist
```

### 5.5 안드로이드 앱 빌드 (APK 및 AAB)
```powershell
cd C:\dev\voicecap-web\android\voicecapSMS

# 1. 디버그 설치용 APK 빌드 (app/build/outputs/apk/debug/app-debug.apk 생성)
.\gradlew.bat :app:assembleDebug

# 2. Google Play 배포용 서명 AAB 빌드 (app/build/outputs/bundle/release/app-release.aab)
.\gradlew.bat :app:bundleRelease
```

---

## 6. 데이터베이스 스키마 및 마이그레이션 (Supabase)

데이터베이스는 Supabase PostgreSQL을 사용하며, 테넌트 분리와 실시간 판매 관리를 위한 핵심 테이블 구조는 다음과 같습니다:

### 마이그레이션 파일 목록
1. `supabase/migrations/202608300001_initial_multitenant.sql`: 멀티테넌트 기본 테이블 (`workspaces`, `workspace_members`, `profiles`, `workspace_settings`).
2. `supabase/migrations/202609080001_product_sales_core.sql`: **상품 중심 판매관리 테이블**:
   - `sessions`: 방송 회차 정보 및 낙관적 락 버전(`revision`).
   - `products`: 상품 정보, 단가(`unit_price`), 이미지 종류(`image_kind`: PHOTO / NUMBER_IMAGE), `revision`, `sales_revision`.
   - `sales`: 구매자별 판매 내역, 단가, 수량, 주문 상태(`ACTIVE` / `CANCELLED`), 출처 댓글 목록(`source_comment_ids`).
   - `buyers`: 구매자 마스터, 플랫폼 사용자 ID, 닉네임 스냅샷, 신원 검증 상태(`UNRESOLVED` / `MANUAL_CONFIRMED` / `RESOLVED`).
   - `print_jobs`: 인쇄 대기열, 전표 종류(`SALE` / `CORRECTION` / `CANCEL` / `SUMMARY`), 상태(`QUEUED`, `CLAIMED`, `SUBMITTING`, `SUBMITTED`, `FAILED`, `UNKNOWN`).
   - `device_pairings`: Android 기기 페어링 정보, 부여된 권한 배열(`permissions`: `SALES_READ`, `SALES_WRITE`, `PRODUCT_WRITE` 등).

### Edge Functions 배포 방법
Supabase CLI 로그인 또는 웹 대시보드(Code 편집기)를 통해 배포합니다:
```powershell
npx supabase login
npx supabase link --project-ref ymegrhxpbeanvxwdzfym
npx supabase functions deploy sales-api --no-verify-jwt
npx supabase functions deploy voicecap-onboard --no-verify-jwt
npx supabase functions deploy device-pair --no-verify-jwt
npx supabase functions deploy sms-bridge --no-verify-jwt
```

---

## 7. 배포 절차 (Web, Edge Functions, Desktop, Android)

### 7.1 웹 프론트엔드 (Vercel)
- `main` 브랜치에 변경 사항을 commit하고 push하면 Vercel 빌드 파이프라인이 자동 트리거되어 약 1분 이내에 `https://www.voicecap.shop`에 프로덕션 배포됩니다.
```powershell
git add .
git commit -m "feat: 업데이트 내용"
git push origin main
```

### 7.2 데스크톱 도우미 설치 파일 (GitHub Releases)
- 새 버전을 패키징하여 GitHub Releases에 배포하려면:
```powershell
cd desktop/comment-helper
npm run dist
npm run upload  # GitHub Releases로 VoiceCAP-Comment-Helper-Setup.exe 자동 업로드
```

### 7.3 안드로이드 앱 설치 파일 배포
- **실기기 테스트용 APK 파일 위치**:
  `C:\dev\voicecap-web\android\voicecapSMS\build\voicecap-sms-v1.3.2-install.apk` (약 697 KB)
- **설치 명령어 (USB 연결 시)**:
  ```powershell
  adb install -r C:\dev\voicecap-web\android\voicecapSMS\build\voicecap-sms-v1.3.2-install.apk
  ```
- **스토어 배포**: `app-release.aab` 파일을 Google Play Console의 내부 테스트 트랙에 업로드합니다.

---

## 8. 운영 계정 및 E2E 실시간 판매 검증 체크리스트

### 운영 계정
- **최고 관리자**: `nettman@naver.com` (`app_metadata.role = ADMIN`, 모든 작업공간 접근 및 공용 STT 설정 가능)
- **테스트 판매자**: `test@test.com`, `nettman004@gmail.com`

### 라이브 판매관리 E2E 검증 절차
새 컴퓨터에서 전체 시스템 연결을 검증할 때 다음 시나리오를 점검합니다:

- [ ] **회차 시작**: 웹 대시보드에서 새 라이브 회차를 생성하고 세션 코드가 발급되는지 확인.
- [ ] **기기 페어링**: 웹의 **마이페이지 → 휴대폰 연결**에서 10자리 일회용 코드를 생성하고, 스마트폰 앱 `💬 문자연동` 탭에 입력하여 페어링 완료.
- [ ] **권한 부여**: 웹 **기기 관리** 페이지에서 페어링된 스마트폰의 `판매 권한` 스위치가 활성화되어 있는지 확인.
- [ ] **상품 등록**: 스마트폰 또는 웹에서 `0007` (캐시미어 니트, 35,000원)을 등록하고 선행 0이 유지되는지 확인 (2초 타이머 카메라 촬영 또는 번호이미지).
- [ ] **댓글 수신 및 1인 합산**: 틱톡 또는 가상 댓글로 동일 고객이 댓글 2개를 작성했을 때, 앱에서 1명의 구매자로 통합되고 기본 수량 1개로 선택되는지 확인.
- [ ] **판매 확정**: `[판매등록완료]` 클릭 시 서버에 즉시 저장되고, 하단에 `[SUBMITTED] Windows 인쇄 접수` 상태가 안내되는지 확인.
- [ ] **단가 소급 수정**: 상품 카드 우측 `[수정]` 클릭 → 단가를 30,000원으로 변경 → `[변경 미리보기]`로 차액 확인 → `[변경 적용]` 시 PC 프린터로 **정정 전표(`CORRECTION`)**가 출력되는지 확인.

---

## 9. 자주 묻는 질문 및 트러블슈팅 FAQ

### Q1. 새 컴퓨터에서 `gradlew.bat` 실행 시 `JAVA_HOME is not set` 오류가 발생합니다.
- **원인**: 시스템에 Java 17이 설치되지 않았거나 환경변수가 등록되지 않았습니다.
- **해결**: [Microsoft OpenJDK 17](https://learn.microsoft.com/ko-kr/java/openjdk/download#openjdk-17)을 설치한 후, PowerShell 세션에서 `$env:JAVA_HOME="C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"` 및 `$env:PATH="$env:JAVA_HOME\bin;$env:PATH"`를 지정하세요.

### Q2. 안드로이드 앱에서 `403 CAPABILITY_DENIED` 오류가 뜹니다.
- **원인**: 기기 토큰은 정상이나 해당 기기에 `SALES_WRITE` 권한이 아직 켜지지 않았습니다.
- **해결**: PC 웹 브라우저로 관리자 계정 로그인 후, **설정 → 기기 관리**에서 해당 스마트폰의 `판매 권한 허용` 토글을 켜주세요.

### Q3. 갤럭시 스마트폰에서 APK 설치가 차단됩니다 ("출처를 알 수 없는 앱").
- **원인**: 최신 One UI의 '보안 위험 자동 차단' 정책 때문입니다.
- **해결**: 스마트폰 **설정 → 보안 및 개인정보 보호 → 보안 위험 자동 차단 [사용 안 함]**으로 일시 해제하거나, PC와 USB 연결 후 `adb install -r <apk-path>`로 설치하세요.

### Q4. 데스크톱 도우미에서 Xprinter 출력이 되지 않습니다.
- **원인**: Windows 프린터 드라이버가 오프라인이거나 포트가 점유되었습니다.
- **해결**: Windows 제어판의 프린터 목록에서 사용 중인 감열식 프린터를 '기본 프린터'로 설정하고 테스트 페이지 인쇄가 정상 동작하는지 먼저 확인하세요. 도우미는 시스템 기본 프린터로 자동 스풀링합니다.

---
*본 인계인수서는 VoiceCAP의 최신 소스코드, 데이터베이스 마이그레이션, 빌드 산출물 및 공식 배포 파이프라인과 완벽히 동기화되어 있습니다.*
