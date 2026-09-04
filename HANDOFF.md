# VoiceCAP 개발 인계인수서

작성일: 2026-09-04 (Asia/Seoul)
목적: 다른 Windows PC에서 웹앱, 로컬 브리지 서버, Android `VoiceCAP SMS Bridge`, Electron `VoiceCAP 댓글 도우미 (라벨 프린터 연동)` 개발 및 배포를 그대로 완벽하게 이어가기 위한 최신 마스터 인계 문서

---

## 1. 현재 기준점 (2026-09-04 최신)

| 항목 | 현재 값 | 비고 |
|---|---|---|
| 저장소 | `https://github.com/nettman001-hub/voice-pin-web.git` | `main` 브랜치 최신화 완료 |
| 운영 사이트 | `https://www.voicecap.shop` | Vercel 자동 배포 연동 |
| 공식 개인정보처리방침 | `https://www.voicecap.shop/privacy` | Google Play 정책 심사용 웹페이지 |
| Google Search Console | 소유권 확인 메타 태그 반영 완료 | `index.html` 내 인증 태그 라이브 배포 |
| Android 앱 ID | `shop.voicecap.smsbridge` | VoiceCAP SMS Bridge |
| Android 규격 | 최소 API 26 (Android 8.0) ~ **target API 36** | **versionCode 5 (v1.3.1)** |
| Android 배포 상태 | **Google Play 내부 테스트 정상 설치 완료**, **비공개 테스트(Alpha) 심사 제출 완료** | 갤럭시 피싱 차단 100% 우회 |
| Android 서명키 | 4096비트 RSA 업로드 키 생성 완료 | `signing/voicecap-upload.jks` |
| 데스크톱 도우미 | Electron `shop.voicecap.commenthelper` v1.1.4 | 틱톡 댓글 수집 + 라벨 프린터 연동 |
| 검증 라벨 프린터 | `Xprinter XP-DT108B LABEL` (50x30 mm 감열 라벨지 지원) | 순수 흑색 모드, 자동 인쇄 |
| 실시간 STT 엔진 | Deepgram Nova-3 / Soniox / faster-whisper (로컬 무료) / Web Speech | 클라우드 & 무료 오프라인 하이브리드 지원 |
| 라이브 판매 캡처 | '캡처하세요' 발화 시 화면 자동 캡처 & 90% 용량 압축 | 960px 다운스케일링, JPEG 0.72 |
| 댓글 구매의사 감지 | '저요', '구매', '주세요', **'ㅈㅇ'** 등 | 초성 'ㅈㅇ' 인식 확장 완료 |

---

## 2. 다른 PC로 이동 시 반드시 챙겨야 할 필수 파일 (USB 복사 필수!)

> [!CAUTION]
> 아래 파일들은 보안 및 `.gitignore` 설정으로 인해 **GitHub에 올라가지 않는 로컬 전용 파일**입니다.
> 다른 PC에서 빌드 및 연동을 정상 수행하려면 **USB나 암호화된 외장 드라이브로 직접 복사**해야 합니다.

1. **Android 업로드 서명 키스토어 (가장 중요!)**:
   - 폴더 위치: `C:\dev\voice-pin-anti\android\voicecapSMS\signing\`
   - 포함 파일:
     - `voicecap-upload.jks` : 4096비트 RSA 정식 서명 키스토어
     - `voicecap-upload-certificate.pem` : 공개 인증서
     - `KEY_INFO.txt` : 서명 키 비밀번호 및 알리아스 정보 (`VoiceCAP!2026UploadKey#982`, alias: `voicecap-upload`)
   - ⚠️ 이 JKS 파일을 분실하면 향후 구글 플레이 앱 업데이트가 불가능하므로 반드시 2중 백업하세요!
2. **Euler Stream API 키 파일**:
   - 파일 위치: `C:\dev\voice-pin-anti\eulerstream_key.txt` (TikTok 댓글 실시간 수집용)
3. **사용자 브라우저 데이터 (필요 시)**:
   - 판매, 정산, 닉네임 인식 규칙 등은 브라우저 `localStorage`에 저장됩니다.
   - 기존 PC의 웹 화면 **[마이페이지] > [데이터 백업/내보내기]**에서 JSON으로 백업받아 새 PC에서 복원할 수 있습니다.

---

## 3. 다른 PC에서 처음 시작할 때 명령어 가이드

### 1단계: Git 클론 및 의존성 설치
```powershell
# 작업 폴더 생성 및 이동
git clone https://github.com/nettman001-hub/voice-pin-web.git C:\dev\voice-pin-anti
cd C:\dev\voice-pin-anti

# 웹 프런트엔드 패키지 설치
npm ci

# 로컬 브리지 서버 패키지 설치
cd server
npm ci
cd ..
```

### 2단계: USB에서 복사해 온 필수 파일 배치
- `C:\dev\voice-pin-anti\eulerstream_key.txt` 복사
- `C:\dev\voice-pin-anti\android\voicecapSMS\signing\` 폴더 생성 후 `voicecap-upload.jks` 및 `KEY_INFO.txt` 복사

### 3단계: 전체 빌드 및 테스트 검증
```powershell
# 1. 웹 빌드 검증 (TypeScript 컴파일 + Vite 번들링)
npm run build

# 2. 서버 단위 테스트 검증 (4개 통과 확인)
cd server
npm test
cd ..
```

### 4단계: Android 릴리스 AAB 빌드 (필요 시)
```powershell
cd C:\dev\voice-pin-anti\android\voicecapSMS
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:VOICECAP_UPLOAD_KEYSTORE = 'C:\dev\voice-pin-anti\android\voicecapSMS\signing\voicecap-upload.jks'
$env:VOICECAP_UPLOAD_STORE_PASSWORD = 'VoiceCAP!2026UploadKey#982'
$env:VOICECAP_UPLOAD_KEY_ALIAS = 'voicecap-upload'
$env:VOICECAP_UPLOAD_KEY_PASSWORD = 'VoiceCAP!2026UploadKey#982'

.\gradlew.bat :app:bundleRelease
```
- 산출물: `android/voicecapSMS/app/build/outputs/bundle/release/app-release.aab`

---

## 4. 2026-09-04 핵심 구현 및 해결 내역

### 1) Android Google Play 정식 등록 및 갤럭시 차단 우회 해결
- **문제**: 갤럭시 실기기에서 직접 사이드로드(APK 파일 설치) 시 삼성 보안 정책에 의해 "악성/보이스피싱 의심 앱"으로 강제 차단됨.
- **해결**:
  - 4096비트 RSA 업로드 키 생성 및 서명 파이프라인 구축.
  - 구글 최신 보안 규격인 **API 36 (Android 16) 타겟팅** 및 **versionCode 5 (v1.3.1)** 반영.
  - **Google Play Console 내부 테스트(Internal Testing) 트랙** 배포를 통해 대표님 실제 갤럭시 폰에 공식 구글 플레이 인증으로 정상 설치 완료!
  - **비공개 테스트(Alpha) 트랙** 출시 및 구글 검수팀 공식 심사 제출 완료.

### 2) Google Play 정책 및 스토어 에셋 완비
- **공식 개인정보처리방침**: `src/pages/legal/PrivacyPolicyPage.tsx` 구축, `/privacy` 공개 라우트 등록 및 `https://www.voicecap.shop/privacy` 실시간 라이브 배포.
- **스토어 그래픽 에셋 (`android/voicecapSMS/play_assets/`)**:
  - `app_icon_512.png`: 512x512 32비트 앱 아이콘
  - `feature_graphic_1024x500.png`: 1024x500 그래픽 이미지 배너
  - `screenshot_01.png` ~ `03.png`: 휴대전화 스크린샷 3종
- **SMS 권한 선언 양식(Permissions Declaration)**:
  - 핵심 기능: `기본 SMS 처리기 (Default SMS Handler)`
  - 틱톡 라이브 판매자의 주문 문자 수신 및 안내 문자 발송 목적 공식 선언 완료.

### 3) 라이브 판매 자동 캡처 최적화 & 용량 90% 절감
- **발화 멘트 조건**: 판매자가 상품을 보여주며 **"캡처하세요"** (또는 '캡처 하세요', 단어 규칙 등록 키워드)를 말할 때만 화면 캡처가 실행되고, 생성된 판매 내역에 사진이 한 세트로 묶여서 DB에 저장됨.
- **이미지 압축**: `screenCaptureService.ts`에서 가로/세로 최대 960px 다운스케일링 및 `image/jpeg (품질 0.72)` 압축 적용 (기존 1~2MB ➔ 30~70KB 수준으로 축소).
- **댓글 인식 개선**: 구매 의사 댓글 감지 패턴에 초성 **`ㅈㅇ`** (저요) 추가.

### 4) Google Search Console 사이트 소유권 확인 연동
- `index.html`의 `<head>` 섹션에 소유권 확인 메타 태그(`h_I_KItXuFu7NRFoHcnkiXeBTbIBrCxFNks972JSTtU`) 삽입 및 배포 완료.

### 5) 무료 오프라인 로컬 STT (faster-whisper) 연동
- **도입 목적**: 클라우드 STT API(유료) 없이 사용자 PC에서 완전 무료로 오프라인 음성인식을 구동할 수 있도록 지원.
- **아키텍처**: 브라우저(16kHz PCM16 바이너리 오디오) ➔ 댓글 도우미 로컬 브리지(Socket.IO `127.0.0.1:2137`) ➔ Python 워커(`faster-whisper` + Silero VAD + CPU `int8` 양자화 가속).
- **UI 지원**: 라이브 청취 홈에서 `[☁️ 클라우드 STT]` / `[💻 내 PC 무료 STT]` 원클릭 전환, 모델(`base`, `small`, `large-v3-turbo`) 선택 및 준비 상태 뱃지 제공. 무료 모드 시 API 키 검사 자동 생략.

---

## 5. 일상 실행 및 방송 운영 가이드

### 1) 웹 개발 서버 실행
```powershell
cd C:\dev\voice-pin-anti
npm run dev
# 브라우저에서 http://localhost:5173 또는 운영 사이트 https://www.voicecap.shop 접속
```

### 2) 라벨 프린터 및 댓글 도우미 실행
```powershell
cd C:\dev\voice-pin-anti\desktop\comment-helper
npm start
```
- 프린터: `Xprinter XP-DT108B LABEL` (50x30mm 감열 라벨지)
- 라이브 청취 홈에서 판매 인식 시 50x30mm 스티커 라벨 즉시 자동 출력

### 3) 안드로이드 문자 브리지 연동
- 스마트폰에서 `VoiceCAP SMS Bridge` 앱 실행
- 웹앱 [마이페이지]에서 [휴대폰 연결 코드 만들기] 클릭 후 발급된 10자리 코드를 앱에 입력
- 고객이 보낸 주문 문자(닉네임, 금액, 주소)가 웹 대시보드에 실시간 대조 및 자동 적재됨

---

## 6. 최근 주요 커밋 이력

- `228af81`: docs: 2026-09-04 인계인수서(HANDOFF.md) 최신화
- `8e68fbb`: feat: 구글 플레이 최신 규격(API 36 타겟, versionCode 5) 서명 AAB 빌드 및 스토어 PNG 에셋 반영
- `a947b33`: feat: Google Search Console 사이트 소유권 확인 메타 태그 추가
- `2641ff1`: feat: 판매 캡처 '캡처하세요' 필수 조건 반영, 이미지 90% 압축, 구글 플레이 서명 AAB 및 개인정보처리방침/스토어 에셋 추가
- `cfe1cdb`: feat: Xprinter 50x30mm 라벨 규격 추가 및 감열식 인쇄 파이프라인 최적화

---
