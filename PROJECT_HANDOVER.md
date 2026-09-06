# VoiceCAP 프로젝트 종합 인계인수서 (Handover Document)

> **작성일자**: 2026년 9월 7일  
> **프로젝트**: VoiceCAP (실시간 틱톡 라이브 댓글 수집 + 감열식 영수증 자동 출력 + 오프라인 로컬 STT 엔진)  
> **저장소**: [https://github.com/nettman001-hub/voice-pin-web](https://github.com/nettman001-hub/voice-pin-web)  
> **최신 릴리스**: `v1.3.4` (`comment-helper-v1.3.4`)

---

## 1. 프로젝트 개요 및 핵심 구성 요소

VoiceCAP은 라이브 커머스 판매자를 위한 **실시간 댓글 수집·영수증 라벨 출력·음성인식(STT) 통합 솔루션**입니다.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        웹 프론트엔드 (Vercel 배포)                        │
│              React 19 + TypeScript + Vite + Tailwind CSS               │
│               - 실시간 핀 고정 판매 관리, 매출 정산, 라이브 청취 홈           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Socket.IO (포트 2137) / WebRTC PCM
┌───────────────────────────────────▼────────────────────────────────────┐
│                  데스크톱 도우미 (Electron 44 / Windows)                 │
│                      desktop/comment-helper (v1.3.4)                   │
│  - 틱톡 라이브 웹소켓 수집 (tiktok-live-connector)                       │
│  - Windows 감열식 영수증/라벨 자동 출력 (Xprinter, 50x30, 80mm 등)       │
│  - 로컬 STT 소켓 브리지 (server/sttBridge.js)                           │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │ (AMD / Vulkan 감지 시)          │ (NVIDIA GPU 감지 시)
┌──────────────────▼──────────────┐ ┌────────────────▼───────────────────┐
│ whisper.cpp Vulkan 엔진 (C/C++) │ │ faster-whisper 엔진 (Python 3.10+) │
│ - whisper-server.exe (포트 2139) │ │ - stt_worker.py (JSON-RPC stdin)   │
│ - ggml-vulkan.dll (16GB 가속)   │ │ - CUDA 12 Tensor Core (cuBLAS)     │
│ - large-v3-turbo (0.2~0.4초 전사)│ │ - large-v3-turbo / small / base    │
└─────────────────────────────────┘ └────────────────────────────────────┘
```

---

## 2. 하드웨어별 STT 가속 매트릭스 및 동작 방식

시스템은 PC에 장착된 그래픽카드를 **실시간 자동 감지**하여 최적의 연산 백엔드와 모델을 자동 할당합니다.

| 환경 | 장착 하드웨어 | 추천 백엔드 | 추천 모델 | VRAM/RAM 점유 | 비고 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **AMD 하이엔드** | **AMD Radeon RX 6800 XT (16GB)** | **DirectX 12 / Vulkan** | `large-v3-turbo` | VRAM 1.6GB | **0.2~0.4초 초고속 실시간 전사**, 청크 드롭 0개 |
| **NVIDIA 메인** | **RTX 3060 (12GB) / 4060** | **NVIDIA CUDA (FP16)** | `large-v3-turbo` | VRAM 1.8GB | CTranslate2 Tensor Core 가속 |
| **NVIDIA 보급** | **RTX 2060 (6GB) / GTX 1660** | **NVIDIA CUDA (INT8)** | `large-v3-turbo` 또는 `small` | VRAM 1.2GB | VRAM 안전 마진 확보 |
| **NVIDIA 구형** | **GTX 1060 (6GB) / Pascal** | **NVIDIA CUDA (INT8)** | `small` 또는 `base` | VRAM 0.8GB | INT8 양자화로 지연 최소화 |
| **온보드 / 내장** | **인텔 UHD/Iris 또는 AMD 내장** | **Vulkan 또는 CPU 멀티스레드** | `base` | RAM 0.5GB | 8~16스레드 병렬 연산 |

---

## 3. 다른 컴퓨터에서 개발 환경 구축하기 (개발자 가이드)

### 필수 요구사항
- **OS**: Windows 10 / 11 64-bit
- **Node.js**: v20+ 또는 v22+ (npm 포함)
- **Git**: Windows용 Git (Git Credential Manager 활성화 권장)
- **Python** (NVIDIA CUDA 환경 개발 시): Python 3.10 또는 3.11 64-bit

---

### Step 1: 저장소 복제 및 의존성 설치

```powershell
# 1. 저장소 클론
git clone https://github.com/nettman001-hub/voice-pin-web.git
cd voice-pin-web

# 2. 웹 프론트엔드 의존성 설치
npm install

# 3. 데스크톱 도우미 의존성 설치
cd desktop/comment-helper
npm install
cd ../..
```

---

### Step 2: 웹 프론트엔드 실행 및 빌드

```powershell
# 웹앱 로컬 개발 서버 기동 (http://localhost:5173)
npm run dev

# 웹앱 타입 검사 및 프로덕션 빌드 검증
npm run build
```

---

### Step 3: 데스크톱 댓글 도우미 개발 및 테스트

```powershell
cd desktop/comment-helper

# 1. 서버 파일 스테이징 (server/ -> desktop/comment-helper/server/)
node scripts/stage-server.cjs

# 2. 단위 테스트 실행 (프린터 및 렌더러 테스트 5개)
npm test

# 3. 개발 모드로 일렉트론 실행
npm start
```

---

### Step 4: 데스크톱 설치 파일(NSIS) 빌드 및 배포

```powershell
cd desktop/comment-helper

# 1. 로컬 배포용 EXE 빌드 (release/VoiceCAP-Comment-Helper-Setup.exe 생성)
npm run dist

# 2. GitHub Releases로 자동 업로드 (v1.3.x 태그)
# (주의: GH_TOKEN 또는 GITHUB_TOKEN 환경변수 필요, 또는 Git 자격 증명 사용)
npm run upload
```

---

## 4. 새 컴퓨터에서 판매자/사용자 실행 가이드 (간편 설치)

새 컴퓨터에서 코드를 빌드할 필요 없이 프로그램만 실행하려는 경우:

1. **최신 릴리스 다운로드**:
   - [VoiceCAP-Comment-Helper-Setup.exe (v1.3.4 다운로드)](https://github.com/nettman001-hub/voice-pin-web/releases/latest)
2. **원클릭 설치**:
   - `VoiceCAP-Comment-Helper-Setup.exe` 실행 (바탕화면 및 시작메뉴에 바로가기 생성)
3. **그래픽카드별 자동 설정 확인**:
   - **AMD 라데온 PC**: 설치 즉시 내장된 Vulkan 바이너리와 모델이 자동 작동하여 `⚡ AMD Radeon ... (Vulkan GPU 가속)` 상태로 준비됩니다.
   - **NVIDIA GPU PC**: 바탕화면 또는 설치 폴더의 `setup-offline-stt.bat`을 1회 실행하여 CUDA 가속 패키지를 자동 세팅합니다.
4. **웹 브라우저 접속**:
   - [https://www.voicecap.shop/live](https://www.voicecap.shop/live) 접속 후 라이브 청취 시작.

---

## 5. 핵심 소스코드 구조 및 주요 역할

```
c:\dev\voice-pin-web/
├── server/                               # 댓글 수집 및 STT 백엔드 (로컬 포트 2137)
│   ├── index.js                          # Express + Socket.IO 서버 진입점
│   ├── sttBridge.js                      # [핵심] 하이브리드 STT 오케스트레이터
│   │                                     #  - AMD: vulkanRunner로 라우팅
│   │                                     #  - NVIDIA: stt_worker.py로 라우팅
│   ├── vulkanRunner.js                   # [신규] whisper.cpp Vulkan 엔진 데몬 관리자 (포트 2139)
│   │                                     #  - VAD 발화 감지, 250ms 프리롤 버퍼, WAV 변환
│   ├── stt_worker.py                     # Python faster-whisper CTranslate2 워커
│   └── bin/whisper-vulkan/               # whisper.cpp Vulkan 바이너리 및 의존 DLL
│       ├── whisper-server.exe            # Vulkan 기반 고속 추론 REST 데몬
│       ├── whisper-cli.exe               # CLI 테스트 유틸리티
│       ├── ggml-vulkan.dll               # DirectX 12 / Vulkan GPU 가속 코어 (58MB)
│       ├── ggml-cpu.dll, ggml-base.dll   # CPU 및 백엔드 인터페이스 DLL
│       └── whisper.dll                   # GGML whisper 코어 라이브러리
│
├── desktop/comment-helper/               # Windows 일렉트론 데스크톱 클라이언트
│   ├── main.cjs                          # Electron 메인 프로세스 (트레이, 자동시작, 프린터 IPC)
│   ├── package.json                      # 버전(1.3.4), asarUnpack 설정
│   ├── ui/
│   │   ├── renderer.js                   # 도우미 UI (GPU 배지, STT 상태 표시, 프린터 설정)
│   │   └── renderer.test.cjs             # UI 상태 및 GPU 표시 회귀 테스트 (5개 패스)
│   └── scripts/
│       ├── stage-server.cjs              # server/ 코드를 일렉트론 번들로 자동 복사
│       ├── setup-offline-stt.bat         # 새 PC용 원클릭 Python/CUDA 자동 설치기
│       └── upload-release.cjs            # GitHub Releases 자동 업로더
│
├── src/                                  # 웹 프론트엔드 (React + Vite)
│   ├── context/LiveContext.tsx           # STT 상태 구독, 모델 전환(vulkan/cuda 라우팅)
│   ├── pages/seller/LiveHomePage.tsx     # 라이브 청취 홈 (⚡ GPU 배지, 모델 선택 드롭다운)
│   ├── services/localSttService.ts       # 웹 브라우저 <-> 로컬 도우미 Socket.IO 클라이언트
│   └── types/stt.ts                      # STT 관련 TypeScript 타입 정의
│
└── PROJECT_HANDOVER.md                   # 본 인계인수서
```

---

## 6. 시크릿 및 환경변수 설정

다른 컴퓨터로 이전 시 필요한 주요 설정 파일들입니다:

### 1) Euler Stream API 키 (틱톡 라이브 웹소켓 서명)
- **위치**: `eulerstream_key.txt` (저장소 루트 또는 `server/eulerstream_key.txt`)
- **설명**: 틱톡 라이브 WebSocket URL 서명을 위한 API 키. 미입력 시 무료 커뮤니티 한도로 자동 폴백 동작.

### 2) 웹 프론트엔드 환경변수 (`.env`)
- **위치**: `.env` (저장소 루트)
- **설명**: Supabase URL, Anon Key 등 Supabase 인증/DB 연동 정보.

### 3) GitHub 릴리스 토큰 (선택 사항)
- **설명**: `npm run upload` 실행 시 새 버전을 GitHub Releases에 업로드하기 위한 권한. Git Credential Manager가 설정되어 있으면 별도 토큰 입력 없이 동작합니다.

---

## 7. 문제 해결 (Troubleshooting FAQ)

### Q1. 도우미 실행 시 "Single Instance Lock"으로 즉시 종료되는 경우
- **원인**: 백그라운드에 이전 프로세스가 남아 있어 포트나 뮤텍스를 점유 중인 상태.
- **해결**:
  ```powershell
  Stop-Process -Name 'VoiceCAP 댓글 도우미', 'whisper-server', 'electron' -Force -ErrorAction SilentlyContinue
  ```

### Q2. AMD 그래픽카드인데 "Vulkan GPU 가속" 배지가 안 뜨고 CPU로 표시될 때
- **원인**: 이전 실행 시 저장된 캐시(`stt-settings.json`)에 CPU가 기록되어 있는 경우.
- **해결**:
  1. 도우미 UI의 [연산 장치] 드롭다운에서 `⚡ AMD Radeon ... (Vulkan GPU 16GB 가속 권장)`을 직접 선택.
  2. 또는 설정 파일 삭제:
     ```powershell
     Remove-Item "$env:APPDATA\voicecap-comment-helper\stt-settings.json" -Force -ErrorAction SilentlyContinue
     ```
  3. 도우미를 재시작하면 Vulkan GPU가 1순위로 자동 지정됩니다.

### Q3. 패키징 빌드 시 `ENOENT (-4058)` 에러가 발생할 때
- **원인**: Windows `CreateProcess`는 Electron `app.asar` 내부의 `.exe`를 직접 실행할 수 없음.
- **해결**: 이미 `package.json`의 `asarUnpack`에 `"server/bin/whisper-vulkan/**"` 및 `"server/stt_worker.py"`가 등록되어 있고, `vulkanRunner.js`에서 `app.asar.unpacked` 경로를 1순위로 탐색하도록 구현되어 있습니다. 항상 `npm run stage`를 거쳐 빌드하면 정상 작동합니다.

---

## 8. 향후 권장 작업 사항

1. **Vulkan INT8/INT4 양자화 모델 옵션 추가**:
   - 현재 `ggml-large-v3-turbo.bin` (FP16, 1.62GB)을 기본 사용 중입니다.
   - VRAM이 4GB 이하인 구형 AMD 그래픽카드를 위해 `ggml-large-v3-turbo-q5_0.bin` (약 600MB) 선택 옵션을 추가하면 저사양 GPU 지원 폭이 더욱 넓어집니다.
2. **다중 오디오 입력 디바이스 선택 UI**:
   - 현재 시스템 기본 마이크 입력을 캡처하여 스트리밍합니다. 방송용 오디오 인터페이스(오인페) 사용자들을 위해 웹 UI에서 입력 마이크 장치를 선택하는 기능을 추가하면 유용합니다.
