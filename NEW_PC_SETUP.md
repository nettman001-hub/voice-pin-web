# 새 컴퓨터 로컬 파일 복구 및 환경 구축 안내

> [!IMPORTANT]
> 최신 기능·버전·배포 상태와 새 PC 체크리스트는 [`HANDOFF.md`](HANDOFF.md)를 우선 확인하세요. 이 문서는 이전 환경 구축 절차를 보존한 참고 자료입니다.

Git에서 제외된 항목(시크릿 파일, 환경변수 등)이 없는 것은 정상입니다. 아래 가이드를 따라 새 PC에서 환경을 복구하고 실행합니다.

> **상세 종합 인계인수서**: [PROJECT_HANDOVER.md](file:///c:/dev/voicecap-web/PROJECT_HANDOVER.md)  
> **안드로이드 상세 매뉴얼**: [docs/ANDROID_APP_USER_GUIDE.md](file:///c:/dev/voicecap-web/docs/ANDROID_APP_USER_GUIDE.md)  

---

## 1. 필수 도구 설치

1. **Git for Windows**: [git-scm.com](https://git-scm.com/) (Git Credential Manager 활성화)
2. **Node.js**: v20.x 또는 v22.x LTS ([nodejs.org](https://nodejs.org/))
3. **Microsoft OpenJDK 17**: [다운로드 페이지](https://learn.microsoft.com/ko-kr/java/openjdk/download#openjdk-17)
   - 설치 후 환경변수 `JAVA_HOME` 등록: `C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`
   - `PATH`에 `%JAVA_HOME%\bin` 추가
4. **Android Studio**: 최신 버전 (SDK API 35, Build-Tools 35.0.0 설치)
5. **Python 3.10 / 3.11** (NVIDIA CUDA 개발 환경 시)

---

## 2. 저장소 복제 및 패키지 설치

```powershell
git clone https://github.com/nettman001-hub/voice-pin-web.git C:\dev\voicecap-web
cd C:\dev\voicecap-web

# 루트 웹 의존성 설치
npm install

# 서버 의존성 설치
cd server
npm install
cd ..

# 데스크톱 댓글 도우미 의존성 설치 및 스테이징
cd desktop/comment-helper
npm install
node scripts/stage-server.cjs
cd ../..
```

---

## 3. 필수 설정 파일 복구

| 없는 항목 | 복구 및 처리 방법 |
| :--- | :--- |
| `.env.local` | 루트에 생성 후 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_VOICECAP_API_BASE_URL` 설정 ([PROJECT_HANDOVER.md](file:///c:/dev/voicecap-web/PROJECT_HANDOVER.md) 4.1 참조) |
| `server/.env` | `server/.env.example` 복사 후 포트(2137) 및 `SMS_BRIDGE_API_KEY` 설정 |
| `eulerstream_key.txt` | 틱톡 라이브 서명 키 (기존 PC에서 복사하거나 Euler Stream에서 재발급) |
| `android/voicecapSMS/local.properties` | 새 PC의 SDK 경로 지정: `sdk.dir=C\:\\Users\\<계정명>\\AppData\\Local\\Android\\Sdk` |
| Android 서명 키 | Google Play Console용 배포 빌드 시 `VOICECAP_UPLOAD_*` 환경변수 또는 백업된 JKS 키 복원 |

---

## 4. Vercel CLI 재연결 (선택 사항)

```powershell
npm install -g vercel
vercel login
cd C:\dev\voicecap-web
vercel link --project voice-pin-web
```

---

## 5. 수동 전체 검증

```powershell
cd C:\dev\voicecap-web

# 1. 공통 계약 및 API 44개 테스트
npm test

# 2. 웹앱 빌드 검증 (tsc + vite)
npm run build

# 3. 서버 단위 테스트 (11개)
cd server
npm test
cd ..

# 4. 데스크톱 도우미 테스트 (5개)
cd desktop/comment-helper
npm test
cd ../..

# 5. 안드로이드 APK 빌드
cd android/voicecapSMS
.\gradlew.bat :app:assembleDebug
```

---
*자세한 아키텍처 및 트러블슈팅은 [PROJECT_HANDOVER.md](file:///c:/dev/voicecap-web/PROJECT_HANDOVER.md)를 참조하세요.*
