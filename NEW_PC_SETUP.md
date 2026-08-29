# 새 컴퓨터 로컬 파일 복구 안내

Git에서 제외된 항목이 없는 것은 정상이다. 저장소 루트의 자동화 스크립트로 재생성하고, 비밀키만 안전하게 입력한다.

## 빠른 복구

관리자 권한이 아닌 일반 PowerShell에서 실행한다.

```powershell
cd C:\dev\voice-pin-anti
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\bootstrap-new-pc.ps1 -EnableLanBridge
```

`-EnableLanBridge`는 Android 폰이 같은 Wi-Fi에서 PC의 SMS 브리지에 접속할 때만 사용한다. 웹과 서버만 개발하면 옵션을 빼고 실행한다.

## 항목별 처리

| 없는 항목 | 처리 방법 |
|---|---|
| `eulerstream_key.txt` | 기존 PC에서 암호화 USB/비밀번호 관리자로 복사하거나 Euler Stream에서 재발급한 뒤 초기화 스크립트의 보안 입력창에 입력 |
| `.env.local` | 복사하지 않음. `VERCEL_OIDC_TOKEN`은 새 PC에서 `vercel login`과 `vercel link --project voice-pin-web`로 재인증 |
| `server/.env` | 초기화 스크립트가 `.env.example` 기반으로 만들고 새로운 강력한 `SMS_BRIDGE_API_KEY` 생성 |
| Android `local.properties` | 초기화 스크립트가 새 PC의 Android SDK 위치를 감지해 생성 |
| 업로드 서명키 | 아직 기존 키가 없으므로 `scripts/create-android-upload-key.ps1`로 최초 1회 생성하고 반드시 별도 백업 |
| `node_modules` | 루트와 `server`에서 `npm ci`로 재설치 |
| APK/AAB | Gradle Wrapper로 새 PC에서 재빌드 |

## Vercel 재연결

```powershell
npm install -g vercel
vercel login
cd C:\dev\voice-pin-anti
vercel link --project voice-pin-web
```

`.env.local`의 기존 OIDC 토큰은 단기 또는 환경 종속 자격 증명일 수 있으므로 다른 PC로 옮기지 않는다.

## Android 업로드 키와 서명 AAB

Play Console에 앱을 아직 한 번도 올리지 않았으므로 새 PC에서 업로드 키를 최초 생성할 수 있다.

```powershell
cd C:\dev\voice-pin-anti
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\create-android-upload-key.ps1
```

스크립트는 비밀번호를 화면에 표시하지 않으며 다음을 생성한다.

- `android/voicecapSMS/signing/voicecap-upload.jks`
- `android/voicecapSMS/signing/voicecap-upload-certificate.pem`
- `android/voicecapSMS/app/build/outputs/bundle/release/app-release.aab`

`signing` 폴더는 Git에서 제외된다. JKS 파일은 암호화된 USB/보안 저장소에, 비밀번호는 비밀번호 관리자에 따로 백업한다. 향후 이미 Play Console에 등록한 키가 생기면 새 키를 다시 만들지 말고 기존 키를 복원해야 한다.

## 기존 데이터도 필요한 경우

코드 실행에 필요한 파일과 별개로 실제 업무 데이터를 이전하려면 다음도 별도 복사한다.

- 웹앱 **마이페이지 & 백업**에서 내보낸 브라우저 데이터
- `server/data/bridge.json`

`bridge.json`에는 고객 전화번호, 문자, 주소, 계좌 안내가 포함될 수 있으므로 서버를 중지하고 암호화된 매체로 이전한다.

## 수동 검증

```powershell
cd C:\dev\voice-pin-anti
npm run build
cd server
npm test
cd ..\android\voicecapSMS
.\gradlew.bat :app:assembleDebug :app:lintDebug :app:bundleRelease
```

디버그 APK는 갤럭시 사이드로드 보안 정책으로 차단될 수 있다. 실기기 설치는 서명 AAB를 Google Play 내부 테스트에 배포하는 방식으로 진행한다.
