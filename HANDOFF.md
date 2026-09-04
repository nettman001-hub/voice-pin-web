# VoiceCAP 마스터 개발 인계인수서

> **최종 개정일**: 2026-09-04 21:40 (Asia/Seoul)  
> **문서 버전**: v2.0.0  
> **문서 목적**: 다른 Windows/Mac PC에서 웹앱, 로컬 브리지 서버, faster-whisper 오프라인 STT, Electron 댓글 도우미, Android SMS Bridge 앱의 개발, 빌드, 배포 및 운영을 완전하게 이어가기 위한 최신 통합 인계인수 문서입니다.

---

## 1. 프로젝트 개요 및 현재 기준점 (2026-09-04 최신)

| 항목 | 현재 값 | 비고 |
|---|---|---|
| **저장소 (GitHub)** | `https://github.com/nettman001-hub/voice-pin-web.git` | `main` 브랜치 최신화 및 배포 연동 완료 |
| **운영 사이트 (Web)** | `https://www.voicecap.shop` (보조: `https://voice-pin-web.vercel.app`) | Vercel CI/CD 자동 배포 (HTTP 200 정상) |
| **개인정보처리방침** | `https://www.voicecap.shop/privacy` | Google Play 스토어 심사용 공식 개인정보 처리방침 |
| **Search Console** | 소유권 확인 메타 태그 라이브 적용 완료 | `index.html` 내 인증 메타 태그 삽입 |
| **데스크톱 도우미** | Electron `VoiceCAP 댓글 도우미` **v1.2.0** | GitHub Releases 배포 완료 (`.exe` 107.9MB) |
| **오프라인 STT 엔진** | `faster-whisper 1.2.1` + Silero VAD + CPU int8 | API 키 없는 100% 무료 로컬 실시간 음성인식 |
| **라벨 프린터 지원** | `Xprinter XP-DT108B LABEL` (50x30 mm 감열 라벨지) | 순수 흑색 모드, 판매 감지 시 즉시 자동 출력 |
| **라이브 판매 캡처** | '캡처하세요' 발화 시 화면 자동 캡처 & 90% 용량 압축 | 960px 다운스케일링, JPEG 0.72 압축 저장 |
| **댓글 구매의사 감지** | '저요', '구매', '주세요', **'ㅈㅇ'** 등 | 초성 'ㅈㅇ' 인식 확장 및 실시간 매칭 |
| **Android 앱 ID** | `shop.voicecap.smsbridge` (**v1.3.1**, versionCode 5) | target API 36 (Android 16), 구글 내부 테스트 완료 |
| **Android 서명키** | 4096비트 RSA 업로드 키 완료 | `signing/voicecap-upload.jks` (USB 보관 필수) |

---

## 2. 전체 시스템 아키텍처 및 데이터 흐름도

```text
                                [틱톡 라이브 방송]
                                        │
           ┌────────────────────────────┴────────────────────────────┐
           ▼                                                         ▼
[방송 탭 오디오 (브라우저 getDisplayMedia)]            [화면 댓글 (EulerStream / 도우미 DOM)]
           │                                                         │
           ▼                                                         ▼
┌──────────────────────────────────────────────────┐        ┌──────────────────────────────────┐
│             VoiceCAP Web Frontend                │        │  VoiceCAP 댓글 도우미 (Electron) │
│              (React + Vite + PWA)                │        │          (Port 2137)             │
├──────────────────────────────────────────────────┤        ├──────────────────────────────────┤
│ • STT 모드 선택기:                               │        │ • 실시간 틱톡 댓글 크롤링         │
│   ├─ [☁️ 클라우드 STT] : Deepgram Nova-3 / Soniox│        │ • 구매 의사 자동 감지 ('ㅈㅇ' 등)  │
│   └─ [💻 내 PC 무료 STT] : LocalSttService       │        │ • Xprinter 50x30mm 라벨 자동 인쇄│
│                                                  │        │ • sttBridge.js (Socket.IO 중계)  │
│ • "캡처하세요" 발화 감지 시:                     │        │ • stt_worker.py (faster-whisper) │
│   └─ 화면 자동 캡처 (960px, JPEG 0.72 압축)      │        │ • 상태 표출 UI (준비됨/오류)     │
│ • 고객 주문/정산 DB 자동 저장 (LocalStorage)      │        └─────────────────┬────────────────┘
└──────────────────────────┬───────────────────────┘                          │
                           │ (Socket.IO 바이너리 PCM16 스트리밍)               │
                           └──────────────────────────────────────────────────┘
                                                    │
                                                    ▼
                                    ┌───────────────────────────────┐
                                    │ Android VoiceCAP SMS Bridge   │
                                    │   (shop.voicecap.smsbridge)   │
                                    ├───────────────────────────────┤
                                    │ • 고객 주문 문자 실시간 수신    │
                                    │ • 구매 확인/계좌 안내 문자 발송 │
                                    │ • 갤럭시 보안 차단 100% 우회  │
                                    └───────────────────────────────┘
```

---

## 3. 핵심 컴포넌트별 상세 스펙 및 파일 맵

### 1) 웹 프런트엔드 (`/src`)
- **기술 스택**: React 18, Vite 5, Tailwind CSS, Lucide React, Socket.IO Client
- **주요 파일**:
  - `src/types/stt.ts`: STT 모드(`SttMode`: `CLOUD` | `LOCAL`), 모델(`LocalSttModel`: `base` | `small` | `large-v3-turbo`), 상태 페이로드 인터페이스 정의
  - `src/services/localSttService.ts`: 로컬 브리지(http://127.0.0.1:2137)와 Socket.IO 통신, 16kHz PCM16 바이너리 오디오 전송, 세션 관리 및 실시간 텍스트 수신
  - `src/services/storageService.ts`: STT 모드 및 선택 모델 로컬 저장, 백업/복원 하위 호환성 유지
  - `src/context/LiveContext.tsx`: 클라우드 STT와 로컬 STT 스트림 분기, 발화 문장 분석, 판매 자동 등록 및 '캡처하세요' 화면 캡처 트리거
  - `src/pages/seller/LiveHomePage.tsx`: 상단 `[☁️ 클라우드 STT]` / `[💻 내 PC 무료 STT]` 탭 전환 UI, 모델 선택기, 오디오 입력(방송 탭/마이크) 선택
  - `src/pages/legal/PrivacyPolicyPage.tsx`: 구글 플레이 정책 심사용 공식 개인정보 처리방침 (`/privacy`)

### 2) 로컬 브리지 서버 및 오프라인 STT (`/server`)
- **기술 스택**: Node.js, Express, Socket.IO, Python 3.10+, faster-whisper 1.2.1, Silero VAD
- **주요 파일**:
  - `server/stt_worker.py`:
    - `faster_whisper.WhisperModel` 기반 추론 (CPU 환경: `device="cpu"`, `compute_type="int8"` 가속)
    - stdin/stdout JSON-RPC 프로토콜 지원 (`ping`, `load_model`, `start`, `audio`, `stop`)
    - Silero VAD 기반 음성/무음 구간 자동 분할 및 한국어(`ko`) 특화 전사
  - `server/sttBridge.js`:
    - Python 워커 프로세스 수명 주기 관리 (스폰, 하트비트, 크래시 시 자동 재시작)
    - Electron `app.asar.unpacked` 경로 자동 탐색 및 fallback 추출 로직 내장
    - Socket.IO 이벤트: `stt:start`, `stt:audio` (바이너리 청크), `stt:stop`, `stt:transcript`, `stt:status`
    - REST 상태 API: `GET /api/stt/status`
  - `server/index.js`: 브리지 서버 메인 진입점 (HTTP/Socket.IO 포트 `2137` 바인딩)

### 3) 데스크톱 댓글 도우미 (`/desktop/comment-helper`)
- **기술 스택**: Electron 35, Node.js
- **주요 파일**:
  - `desktop/comment-helper/main.cjs`: 메인 프로세스, 브리지 서버 백그라운드 구동, 틱톡 댓글 크롤러 창 관리, Xprinter 감열 라벨 인쇄 파이프라인
  - `desktop/comment-helper/package.json`: Electron 빌더 설정 (`asarUnpack: ["server/stt_worker.py"]` 포함)
  - `desktop/comment-helper/scripts/stage-server.cjs`: 빌드 전 `server/` 디렉터리의 필수 파일(`index.js`, `bridgeApi.js`, `bridgeStore.js`, `sttBridge.js`, `stt_worker.py`) 자동 복사
  - `desktop/comment-helper/scripts/upload-release.ps1`: GitHub Release 생성 및 `.exe` 인스톨러 자동 업로드 스크립트
  - `desktop/comment-helper/ui/index.html`: 도우미 창 UI (라벨 프린터 상태 + 무료 STT 상태 인디케이터 표시)

### 4) Android SMS 브리지 (`/android/voicecapSMS`)
- **기술 스택**: Android Studio, Kotlin/Java, Gradle
- **주요 규격**:
  - 패키지명: `shop.voicecap.smsbridge`
  - 버전: `v1.3.1` (versionCode `5`)
  - 타겟 SDK: **API 36 (Android 16)** (Google Play 2026년 최신 보안 규격 충족)
  - 서명: 4096-bit RSA 업로드 키 (`voicecap-upload.jks`)
  - 배포: Google Play 내부 테스트 완료 / 비공개 테스트 심사 진행 중

---

## 4. 무료 오프라인 STT (faster-whisper) 상세 분석 및 트러블슈팅

### 1) 기술적 배경 및 하드웨어 적합성
- **대상 장비**: 일반적인 Windows 노트북/데스크톱 (예: Intel UHD Graphics 내장 그래픽, 8GB RAM, CUDA 미지원 환경).
- **최적화 전략**:
  - 모델: `base` (약 140MB, CPU int8 양자화 시 메모리 점유 약 350MB 내외, 한국어 실시간 추론 레이턴시 0.3~0.7초 달성).
  - 옵션 제공: `small` (정확도 상향), `large-v3-turbo` (고성능 CPU/외장 GPU 환경 권장).

### 2) Electron 패키징 'DISCONNECTED' 이슈 및 해결 과정 (중요)
- **증상**: 댓글 도우미 설치 파일(`.exe`) 설치 후 실행 시 창 하단에 "무료 STT DISCONNECTED" 표시 및 음성인식 불가.
- **근본 원인**:
  1. Electron이 빌드될 때 모든 파일이 `app.asar`라는 가상 아카이브 파일 하나로 묶임.
  2. 시스템의 `python.exe`는 일반 Windows 실행 파일이므로 가상 아카이브(`app.asar`) 내부의 `stt_worker.py` 파일 경로를 인식하지 못함 (`ENOENT -4058` 오류).
  3. `child_process.spawn` 실행 시 `cwd`(작업 디렉터리)가 `app.asar` 내부로 지정되어 Windows의 프로세스 생성 API(`CreateProcessW`)가 실패함.
- **완전 해결책**:
  1. `desktop/comment-helper/package.json`의 `build.asarUnpack` 배열에 `"server/stt_worker.py"` 추가 ➔ 설치 시 `resources/app.asar.unpacked/server/stt_worker.py`에 실제 물리 파일로 존재하게 됨.
  2. `server/sttBridge.js`의 `resolveWorkerScript()` 함수 구현 ➔ `app.asar.unpacked` 경로 우선 탐색, 파일 없을 시 시스템 Temp 폴더로 자동 복사 후 물리 경로 반환.
  3. 자식 프로세스 `cwd`를 `app.asar`가 아닌 실제 디스크 폴더(`app.asar.unpacked` 또는 시스템 `tmpdir`)로 지정.

### 3) 2026-09-04 긴급 결함 진단(OFFLINE_STT_DIAGNOSIS_REPORT) 및 전면 개선 완료
- **진단 보고서**: 프로젝트 루트의 [`OFFLINE_STT_DIAGNOSIS_REPORT.md`](file:///c:/dev/voicecap-web/OFFLINE_STT_DIAGNOSIS_REPORT.md)
- **조치 내역**:
  1. **요청/실제 모델 동기화**: `storageService`의 기본 모델을 `base`로 일치시키고, `requestedModel`과 실제 워커 `loadedModel`을 분리하여 불일치 상태 표출 및 청취 시작 시 자동 로드 연동.
  2. **메모리 중복 점유 방지**: 모델 교체 시 명시적 `del current_model; gc.collect()`를 수행하여 저메모리 PC(Celeron J4105 등)에서 `mkl_malloc` 메모리 부족 에러 원천 차단.
  3. **비정상 반복 생성(한 글자/어절 연속 반복) 차단**:
     - 단일 글자 4회 이상 연속 반복, 어절 3회 연속 반복, Whisper 세그먼트 고압축률(`compression_ratio > 2.4`) 감지 필터 탑재.
     - 비정상 전사 감지 시 `is_abnormal: true` 플래그 부여 및 **판매 등록 / 화면 캡처 / 라벨 인쇄 파이프라인 진입 원천 차단**.
  4. **발화 기반 VAD 및 자음 유실 방지**:
     - 기존 고정 3.5초 절단 폐지.
     - 250ms pre-roll 버퍼 유지로 발화 시작 첫 자음/모음 보존.
     - 발화 감지 후 450ms 무음 확인 시 발화 단위로 안전 플러시.
  5. **세션 소유권 및 백프레셔 방어**:
     - 단일 청취 소켓(`ownerSocketId`) 등록으로 타 탭 오디오 혼입 차단.
     - 워커 stdin 버퍼 과부하 시 안전 프레임 드롭(Backpressure 방어) 및 소켓 연결 종료 시 고아 세션 자동 정리.

---

## 5. 배포 현황 및 다운로드 링크

### 1) 웹앱 (Vercel Production)
- **실서버 URL**: [https://www.voicecap.shop](https://www.voicecap.shop) (보조: `https://voice-pin-web.vercel.app`)
- **배포 방식**: GitHub `main` 브랜치에 커밋 푸시 시 Vercel 웹훅을 통해 자동 무중단 빌드 & 배포 완료.

### 2) 댓글 도우미 설치 파일 (GitHub Release)
- **릴리스 태그**: `comment-helper-v1.2.0`
- **다운로드 URL**: [GitHub Releases v1.2.0](https://github.com/nettman001-hub/voice-pin-web/releases/tag/comment-helper-v1.2.0)
- **파일명**: `VoiceCAP-Comment-Helper-Setup.exe` (약 107.9 MB)
- **로컬 빌드 경로**: `C:\dev\voicecap-web\desktop\comment-helper\release\VoiceCAP-Comment-Helper-Setup.exe`

---

## 6. 새 PC / 다른 개발자 작업 인계 절차 (A to Z 가이드)

새로운 PC에서 작업을 시작할 때 아래 순서대로 진행하면 100% 동일한 개발/배포 환경이 완성됩니다.

### 1단계: 필수 소프트웨어 사전 설치
1. **Node.js**: LTS 20.x 이상 설치 ([nodejs.org](https://nodejs.org))
2. **Git**: Git for Windows 설치 ([git-scm.com](https://git-scm.com))
3. **Python**: Python 3.10 또는 3.11 설치 (설치 시 `Add python.exe to PATH` 반드시 체크)
4. **Android Studio** (Android 앱 작업 시에만 필요): 최신 안정 버전 설치

### 2단계: 소스코드 클론 및 Node 패키지 설치
```powershell
# 1. 작업 폴더로 이동 및 클론
cd C:\dev
git clone https://github.com/nettman001-hub/voice-pin-web.git
cd voicecap-web

# 2. 웹 프런트엔드 의존성 설치
npm ci

# 3. 로컬 브리지 서버 의존성 설치
cd server
npm ci
cd ..

# 4. 데스크톱 도우미 의존성 설치
cd desktop\comment-helper
npm ci
cd ..\..
```

### 3단계: Python 가상환경 및 faster-whisper 환경 구성
오프라인 STT를 구동하기 위해 Python 패키지를 설치합니다:
```powershell
# Python 가상환경 생성 (권장 위치: 사용자 계정 또는 프로젝트 내부)
python -m venv venv
.\venv\Scripts\Activate.ps1

# faster-whisper 및 ctranslate2 설치 (CPU int8 지원)
pip install --upgrade pip
pip install faster-whisper==1.2.1 ctranslate2==4.8.0
```
> [!TIP]
> `sttBridge.js`는 시스템 PATH의 `python` 또는 로컬 venv(`venv/Scripts/python.exe`, `C:\Users\<사용자>\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` 등)를 자동 탐색하여 실행합니다.

### 4단계: USB에서 비공개 필수 파일 복사 (보안상 Git 제외 파일)
> [!CAUTION]
> 아래 파일들은 보안 파일이므로 GitHub에 없습니다. 기존 PC의 백업 USB에서 반드시 복사해야 합니다.

1. **Android 서명 키스토어 (구글 플레이 앱 업데이트에 필수)**:
   - 복사 위치: `android\voicecapSMS\signing\` 폴더 생성 후 복사
   - 파일:
     - `voicecap-upload.jks` (4096비트 RSA 업로드 키)
     - `voicecap-upload-certificate.pem` (인증서)
     - `KEY_INFO.txt` (비밀번호: `VoiceCAP!2026UploadKey#982`, alias: `voicecap-upload`)
2. **TikTok 댓글 API 키**:
   - 복사 위치: 프로젝트 루트에 `eulerstream_key.txt` 복사

### 5단계: 빌드 및 정상 작동 검증

```powershell
# 1. 프런트엔드 프로덕션 빌드 검증
npm run build
# -> tsc && vite build 통과 확인

# 2. 브리지 서버 단위 테스트 검증
npm test --prefix server
# -> 5개 테스트 모두 PASS 확인

# 3. 데스크톱 도우미 단위 테스트 검증
npm test --prefix desktop/comment-helper
# -> 3개 테스트 모두 PASS 확인
```

### 6단계: 일상 실행 방법

1. **웹 프런트엔드 개발 서버**:
   ```powershell
   npm run dev
   # http://localhost:5173 접속
   ```
2. **데스크톱 댓글 도우미 및 로컬 STT 실행**:
   - **일반 사용자/방송 시**: 설치된 `VoiceCAP 댓글 도우미` 바로가기 실행
   - **개발자 모드 시**:
     ```powershell
     cd desktop\comment-helper
     npm start
     ```
3. **데스크톱 도우미 설치 파일(`.exe`) 재빌드 및 배포가 필요할 때**:
   ```powershell
   cd desktop\comment-helper
   npm run build:win
   # 결과물: desktop\comment-helper\release\VoiceCAP-Comment-Helper-Setup.exe
   ```

---

## 7. 문제 해결 FAQ (Troubleshooting)

### Q1. 웹 화면에서 "무료 STT 브리지에 연결할 수 없습니다"라고 뜹니다.
- **원인**: 댓글 도우미(또는 로컬 서버)가 실행되어 있지 않거나 포트 2137이 차단된 경우입니다.
- **해결**:
  1. `VoiceCAP 댓글 도우미` 앱을 먼저 실행하세요.
  2. 개발 환경이라면 터미널에서 `node server/index.js`를 수동 실행해 포트 2137이 정상 리슨하는지 확인하세요.

### Q2. 도우미 창에서 "무료 STT: Python 실행 실패" 또는 "DISCONNECTED"가 표시됩니다.
- **원인**: PC에 Python이 설치되어 있지 않거나 `faster-whisper` 패키지가 설치되지 않은 경우입니다.
- **해결**:
  1. 명령 프롬프트에서 `python --version`을 실행하여 Python 3.10 이상이 설치되어 있는지 확인합니다.
  2. `pip show faster-whisper`를 실행하여 패키지가 존재하는지 확인하고 없으면 `pip install faster-whisper==1.2.1`을 실행하세요.

### Q3. Vercel 배포는 어떻게 반영되나요?
- `main` 브랜치에 코드를 푸시하면(`git push origin main`), Vercel 프로젝트가 GitHub 웹훅을 수신하여 1~2분 내에 `https://www.voicecap.shop`으로 자동 배포를 완료합니다.

### Q4. "캡처하세요" 음성 캡처가 안 됩니다.
- **확인 사항**:
  1. 오디오 소스가 **`[📺 방송 탭 소리]`**로 탭 공유되었는지 확인하세요. (탭 공유 시 '시스템 오디오 공유' 체크 필수)
  2. 판매자가 "캡처하세요"라고 말할 때 자막 창에 텍스트가 정확히 표출되는지 확인하세요. (인식 키워드: "캡처하세요", "캡쳐하세요", "캡처 하세요")

---

## 8. 최근 핵심 커밋 히스토리

- `85796a5`: fix(desktop): Electron asarUnpack 적용 및 Python worker 경로 해석 개선
- `c341182`: build: 댓글 도우미 GitHub Release 자동 업로드 스크립트 추가
- `f413786`: feat: 댓글 도우미 v1.2.0 - 로컬 faster-whisper STT 상태 UI 반영 및 패키지 업데이트
- `517882b`: feat: 무료 오프라인 로컬 STT (faster-whisper) 연동 및 라이브 청취 홈 모드 선택 UI 추가
- `5bc4f40`: docs: 2026-09-04 최신 마스터 인계인수서 개정 - 새 PC 작업자 완벽 인계 가이드 반영
- `228af81`: docs: 2026-09-04 인계인수서(HANDOFF.md) 최신화
- `8e68fbb`: feat: 구글 플레이 최신 규격(API 36 타겟, versionCode 5) 서명 AAB 빌드 및 스토어 PNG 에셋 반영
- `a947b33`: feat: Google Search Console 사이트 소유권 확인 메타 태그 추가
- `2641ff1`: feat: 판매 캡처 '캡처하세요' 필수 조건 반영, 이미지 90% 압축, 구글 플레이 서명 AAB 및 개인정보처리방침/스토어 에셋 추가
- `cfe1cdb`: feat: Xprinter 50x30mm 라벨 규격 추가 및 감열식 인쇄 파이프라인 최적화

---
*본 인계인수서는 프로젝트 루트의 [`HANDOFF.md`](file:///c:/dev/voicecap-web/HANDOFF.md)에 항시 최신 상태로 유지됩니다.*
