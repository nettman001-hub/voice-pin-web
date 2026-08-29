# VoiceCAP 개발 인계인수서

작성일: 2026-08-30 (Asia/Seoul)
목적: 다른 Windows PC에서 웹앱, 로컬 브리지 서버, Android `VoiceCAP SMS Bridge` 개발을 그대로 이어가기 위한 문서

## 1. 현재 기준점

| 항목 | 현재 값 |
|---|---|
| 저장소 | `https://github.com/nettman001-hub/voice-pin-web.git` |
| 기본 브랜치 | `main` |
| 인계 기준 커밋 | `55bddc4 feat: 고객 거래 문자 대화 연동` |
| 운영 사이트 | `https://www.voicecap.shop` |
| Vercel 프로젝트 | `voice-pin-web` |
| 마지막 확인 운영 번들 | `index-DaYTcMuf.js` |
| Android 앱 ID | `shop.voicecap.smsbridge` |
| Android 지원 | 최소 Android 8.0/API 26, target/compile API 35 |

문서 작성 직전 상태는 `main...origin/main` 동기화 상태이며, 코드 변경은 없었다. 이 문서를 추가한 커밋은 문서 작성 후 별도로 확인한다.

## 2. 새 PC에서 가장 먼저 할 일

권장 방법은 새 PC 초기화 스크립트를 실행하는 것이다. Git 제외 파일 중 재생성 가능한 항목을 만들고 전체 빌드까지 확인한다.

```powershell
cd C:\dev\voice-pin-anti
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\bootstrap-new-pc.ps1 -EnableLanBridge
```

항목별 설명과 서명키 생성 방법은 `NEW_PC_SETUP.md`를 참고한다. 수동으로 진행하려면 아래 명령을 사용한다.

```powershell
git clone https://github.com/nettman001-hub/voice-pin-web.git C:\dev\voice-pin-anti
cd C:\dev\voice-pin-anti
git status --short --branch
git log -5 --oneline
npm ci
cd server
npm ci
cd ..
npm run build
cd server
npm test
cd ..
```

`git status`가 깨끗한지 확인한 뒤 작업한다. 다른 PC에서 이미 수정한 내용이 있다면 덮어쓰지 말고 먼저 커밋·백업하거나 병합한다.

## 3. 권장 개발 환경

현재 PC에서 검증한 환경:

- Windows + PowerShell
- Node.js `v24.12.0` (서버 최소 요구는 Node 18)
- npm `11.6.2`
- Android Studio의 JBR/OpenJDK 21
- Gradle Wrapper `9.3.1`
- Android Gradle Plugin `9.1.1`
- Android SDK Platform 35
- Vercel CLI `59.5.0`

Android Studio에서 `android/voicecapSMS` 폴더를 프로젝트로 연다. `local.properties`는 Android Studio가 새 PC의 SDK 위치에 맞춰 만들도록 한다.

## 4. Git으로 옮겨지지 않는 항목

다음 파일과 데이터는 `.gitignore` 대상이므로 필요한 경우 안전한 별도 매체로 직접 옮긴다. 비밀값을 Git, 인계 문서, 메신저에 기록하지 않는다.

### 현재 PC에서 확인된 항목

- 루트 `eulerstream_key.txt`: 존재함. TikTok 댓글 수집용 Euler Stream API 키이며 새 PC로 안전하게 복사해야 한다.
- 루트 `.env.local`: 존재하며 `VERCEL_OIDC_TOKEN` 변수가 있음. 이 토큰은 복사하지 말고 새 PC에서 `vercel login`으로 다시 인증하는 편이 안전하다.
- `server/.env`: 현재 없음. 새 PC에서 `server/.env.example`을 복사해 실제 값을 설정한다.
- `android/voicecapSMS/local.properties`: 존재하지만 PC별 SDK 경로이므로 복사하지 않는다.
- Android 업로드 서명키: 아직 생성되지 않음. `android/voicecapSMS/signing` 폴더도 현재 없음.

### 사용자 데이터

- 웹앱의 계정, 판매, 문자 대조, 정산서, 배송 데이터는 대부분 브라우저 `localStorage`에 저장된다. Git이나 Vercel 배포로 이동되지 않는다.
- 기존 브라우저 데이터를 보존해야 하면 기존 PC의 **마이페이지 & 백업**에서 내보낸 뒤 새 PC 브라우저에서 가져온다.
- SMS 브리지 서버의 실데이터는 `server/data/bridge.json`에 저장된다. 이 파일도 Git에 포함되지 않으므로 실제 데이터가 있으면 서버를 중지한 상태에서 별도 복사한다.
- 브라우저의 API 키/브리지 URL 설정도 로컬 저장소에 있으므로 새 브라우저에서 다시 입력해야 할 수 있다.

## 5. 현재 구현 상태

### 웹앱

- 판매 내역에서 방송 회차를 선택하고 구매자를 펼치면 구매 캡처 이미지를 비율 유지한 크기로 표시한다.
- 자동 생성 판매정보와 고객 SMS 구매정보를 나란히 비교한다.
- 문자 수신 여부, 일치/불일치, 판매자 확인완료, 문자 발송, 입금 여부를 판매 목록에 표시한다.
- 불일치 구매정보는 닉네임, 금액, 상품명, 주소, 전화번호를 판매자가 수정하고 재대조할 수 있다.
- 판매 상세와 구매자 펼침 영역에서 SMS 수발신 이력을 확인한다.
- 판매자는 고객에게 자유 문자를 보낼 수 있다. 배송 답변, 입금 확인, 입금 계좌번호 안내 등을 지원한다.
- `정산서 관리 & 발송`, `택배발송 관리`, 일자별/회차별 정산 및 CSV 내보내기가 구현됐다.
- 사이드바의 `고객 관리 (모바일)`, `고객 관리 (카카오톡)`은 아직 비활성 메뉴다.

주요 파일:

- `src/context/CommerceContext.tsx`
- `src/components/sales/BuyerReconciliationPanel.tsx`
- `src/pages/seller/SalesListPage.tsx`
- `src/pages/seller/SalesDetailPage.tsx`
- `src/pages/seller/InvoiceManagementPage.tsx`
- `src/pages/seller/ShipmentManagementPage.tsx`
- `src/pages/seller/SettlementPage.tsx`
- `src/services/customerMessageParser.ts`
- `src/services/smsBridgeService.ts`
- `src/types/commerce.ts`

### 고객 문의 연결 규칙

모든 개인 문자를 서버로 전송하지 않는다.

1. 닉네임·주소·상품 또는 금액이 들어 있는 첫 구매정보 문자로 전화번호를 업무 고객으로 등록한다.
2. 판매자가 웹에서 해당 번호로 먼저 문자를 보내도 업무 고객으로 등록한다.
3. 등록된 번호에서 이후 들어오는 `택배 언제 오나요?`, `입금했습니다`, `계좌번호 다시 알려주세요` 같은 일반 문의는 `CUSTOMER_INQUIRY`로 업로드한다.
4. 웹앱은 전화번호를 기존 구매 주장 또는 발신 문자에 연결해 판매 상세 문자 이력에 표시한다.
5. 등록되지 않은 번호의 OTP, 은행 알림, 일반 개인 문자는 업로드하지 않는다.

Android 관련 파일:

- `android/voicecapSMS/app/src/main/java/com/voicecap/sms/BusinessContactStore.java`
- `android/voicecapSMS/app/src/main/java/com/voicecap/sms/SmsSyncManager.java`
- `android/voicecapSMS/app/src/main/java/com/voicecap/sms/BridgeClient.java`

### 로컬 브리지 서버

`server`는 기존 TikTok 댓글 수집과 SMS/입금 브리지 API를 함께 제공한다.

주요 SMS API:

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/api/bridge/status` | Android 브리지 연결 확인 |
| GET | `/api/sms/messages?sellerId=...` | 판매자 문자 이력 조회 |
| POST | `/api/sms/incoming` | Android가 수신 SMS/MMS 업로드 |
| GET | `/api/sms/outbox?sellerId=...` | Android가 발송 대기 문자 조회 |
| POST | `/api/sms/outbox` | 웹에서 발송 문자 큐 생성 |
| PATCH | `/api/sms/outbox/:id/status` | Android가 발송 상태 갱신 |
| GET | `/api/payments?sellerId=...` | 입금 내역 조회 |
| POST | `/api/payments/incoming` | 추후 입금 알림 앱/서비스가 입금 내역 업로드 |

인증은 `X-VoiceCAP-Key` 헤더와 `SMS_BRIDGE_API_KEY`로 처리한다. 저장 파일은 기본 `server/data/bridge.json`이다.

관련 파일:

- `server/index.js`
- `server/bridgeApi.js`
- `server/bridgeStore.js`
- `server/test/bridgeStore.test.js`
- `server/.env.example`

## 6. 로컬 서버와 Android 연결

새 PC에서 `server/.env`를 만든다.

```powershell
cd C:\dev\voice-pin-anti\server
Copy-Item .env.example .env
```

동일 Wi-Fi의 Android 폰이 PC 서버에 접속해야 하면 다음을 설정한다.

```dotenv
PORT=2137
HOST=0.0.0.0
SMS_BRIDGE_API_KEY=<충분히 긴 무작위 키>
SMS_BRIDGE_DATA_FILE=./data/bridge.json
```

그다음:

```powershell
cd C:\dev\voice-pin-anti\server
npm start
```

PC에서 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:2137/api/bridge/status -Headers @{ 'X-VoiceCAP-Key' = '<같은 키>' }
ipconfig
```

Windows 방화벽은 TCP 2137을 **사설 네트워크에서만** 허용한다. Android 디버그 앱에는 `http://<PC 사설 IP>:2137`을 입력하고 같은 API 키와 웹앱의 판매자 ID를 입력한다.

주의: 릴리스 Android 빌드는 민감한 문자 데이터 보호를 위해 HTTPS만 허용한다. 로컬 HTTP는 디버그 빌드에서만 허용한다. 실제 운영에는 HTTPS 브리지 서버 또는 안전한 HTTPS 터널/역방향 프록시 설계가 필요하다.

## 7. Android 앱 빌드

PowerShell 예시:

```powershell
cd C:\dev\voice-pin-anti\android\voicecapSMS
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat :app:assembleDebug :app:lintDebug :app:bundleRelease
```

산출물:

- 디버그 APK: `android/voicecapSMS/app/build/outputs/apk/debug/app-debug.apk`
- Play용 AAB: `android/voicecapSMS/app/build/outputs/bundle/release/app-release.aab`

서명 환경 변수가 없으면 release AAB는 서명되지 않는다. 업로드 키 생성 후 다음 네 변수를 모두 설정해야 한다.

```powershell
$env:VOICECAP_UPLOAD_KEYSTORE='C:\secure\voicecap-upload.jks'
$env:VOICECAP_UPLOAD_STORE_PASSWORD='<스토어 비밀번호>'
$env:VOICECAP_UPLOAD_KEY_ALIAS='voicecap-upload'
$env:VOICECAP_UPLOAD_KEY_PASSWORD='<키 비밀번호>'
.\gradlew.bat :app:bundleRelease
```

키와 비밀번호는 Git에 넣지 않는다. 업로드 키를 잃으면 업데이트 배포가 어려우므로 암호화된 백업을 별도로 만든다.

## 8. Android 설치 차단 현황

갤럭시 실기기에서 이메일/브라우저 등으로 받은 디버그 APK 설치 시 `악성 앱으로 의심` 화면이 표시됐으며 사용자가 해제할 수 없었다. APK 서명 손상은 아니고, 갤럭시의 보이스피싱 방지용 사이드로드 차단 정책에 해당한다.

우회 설치를 제품 배포 방식으로 사용하지 않는다. 다음 중 하나로 진행해야 한다.

1. Google Play Console 내부 테스트 트랙
2. Galaxy Store 비공개 테스트
3. 기업용 앱이라면 삼성에 기업 정보와 APK를 제출해 예외 심사

현재 앱은 공식 배포 준비를 위해 다음을 반영했다.

- 고유 패키지 ID `shop.voicecap.smsbridge`
- Android 8.0 이상 지원
- 사용자 전송 동의 후 기본 SMS 앱 역할을 먼저 요청
- 기본 SMS 역할 승인 후에만 SMS/MMS 런타임 권한 요청
- 역할 해제 또는 동의 철회 시 동기화 중단
- 민감 데이터의 Android 백업/기기 이전 제외
- release 빌드의 cleartext HTTP 차단

배포 전 필요한 실제 정보는 `android/voicecapSMS/PLAY_DISTRIBUTION.md`를 참고한다.

## 9. 공식 Android 배포의 현재 차단점

아직 준비되지 않은 항목:

- Google Play 또는 Galaxy Store 개발자 계정 접근
- 실제 운영자/법인명
- 고객지원 이메일
- 개인정보 보호 문의 연락처
- 데이터 보유기간과 삭제 요청 처리기한
- 업로드 서명키와 안전한 백업
- 공개 개인정보 처리방침 URL

Google Play SMS 권한 선언도 필요하다. 핵심 기능을 `기본 SMS 처리`로 정확히 설명해야 한다.

추가 위험: 현재 앱은 VoiceCAP 브리지 중심 UI이며 일반 SMS 앱 수준의 전체 받은편지함/대화 목록 기능은 없다. Play 심사에서 기본 SMS 앱의 핵심 사용자 경험이 부족하다고 판단할 가능성이 있다. 심사 전에 기본 문자 앱으로서 수신 메시지 저장, 대화 목록, 읽기/답장 기능을 보강할지 검토한다.

## 10. 실행과 테스트

프런트엔드:

```powershell
cd C:\dev\voice-pin-anti
npm run build
npm run dev
```

서버:

```powershell
cd C:\dev\voice-pin-anti\server
npm test
npm start
```

Android:

```powershell
cd C:\dev\voice-pin-anti\android\voicecapSMS
.\gradlew.bat :app:assembleDebug :app:lintDebug :app:bundleRelease
```

2026-08-30 마지막 검증 결과:

- 웹 `npm run build`: 성공
- 서버 `npm test`: 4개 모두 성공
- Android `assembleDebug`: 성공
- Android `lintDebug`: 오류 0개. 디버그 빌드의 사내망 HTTP 허용 경고 1개는 의도된 설정
- Android `bundleRelease` 및 release lint vital: 성공
- Vercel 프로덕션: Ready
- 운영 `https://www.voicecap.shop`: 최신 번들 응답 확인

웹 빌드에는 약 575KB 청크 경고가 남아 있으나 빌드는 성공한다. 추후 라우트 단위 코드 분할을 고려한다.

## 11. Vercel 배포

새 PC에서:

```powershell
npm install -g vercel
vercel login
cd C:\dev\voice-pin-anti
vercel link --project voice-pin-web
npm run build
vercel --prod --yes
```

배포 확인:

```powershell
vercel inspect <배포 URL> --wait --timeout 2m
vercel curl https://www.voicecap.shop
```

운영 별칭은 `https://www.voicecap.shop`, `https://voicecap.shop`, `https://voice-pin-web.vercel.app`이다.

중요: Vercel에는 Vite 웹 프런트엔드만 배포된다. `server`의 TikTok Socket.IO 및 SMS 브리지 JSON 서버는 로컬 Windows 프로세스이며 Vercel에서 실행되지 않는다.

## 12. 프로토타입과 운영 시스템의 차이

현재 구현은 기능 검증 단계다. 운영 전 다음을 반드시 보강해야 한다.

- 웹 로그인은 실제 서버 인증이 아니라 브라우저 저장 기반 데모 구조다.
- 판매·정산·문자 연결 데이터 상당 부분이 `localStorage`에 있다.
- SMS 브리지 데이터는 로컬 JSON 파일에 평문 저장된다.
- API 인증은 단일 브리지 API 키 방식이다.
- 계좌번호와 고객 주소/전화번호가 문자 본문 및 로컬 저장소에 포함될 수 있다.
- 다중 판매자 운영 전 서버 DB, 계정별 인증/인가, 암호화, 감사로그, 보유기간/삭제 정책이 필요하다.
- `SENT`는 Android가 OS에 발송을 요청한 상태이며 통신사 최종 배달 성공을 뜻하지 않는다.
- 입금 알림 업로드 API는 있으나 실제 스마트폰 입금 알림 수집 기능은 아직 구현하지 않았다.

## 13. 다음 작업 권장 순서

1. 실제 운영자 정보와 Google Play 개발자 계정을 확보한다.
2. 업로드 키를 생성·백업하고 서명된 AAB를 만든다.
3. 기본 SMS 앱으로서 필요한 대화 목록/수신 저장/답장 경험을 보강한다.
4. 공개 개인정보 처리방침을 만들고 Play SMS 권한 선언을 작성한다.
5. Play 내부 테스트에 올려 갤럭시에서 정상 설치되는지 확인한다.
6. HTTPS SMS 브리지 호스팅 구조와 실제 사용자 인증을 설계한다.
7. 실기기에서 구매정보 MMS 이미지, 고객 후속 문의, 판매자 계좌 안내, 배송 안내를 왕복 테스트한다.
8. 추후 입금 알림 수집과 자동 대조 기능을 구현한다.

## 14. 최근 핵심 커밋

- `55bddc4` 고객 거래 문자 대화 연동
- `c3d31d0` SMS 앱 공식 배포 보안 요건 반영
- `1aefe4c` Android 8 SMS 백그라운드 동기화 지원
- `913a872` 판매 문자 대조 및 정산 배송 관리
- `3308988` 고객 관리 메뉴 추가

## 15. 작업 종료 전 체크리스트

- `git status --short --branch`로 예상하지 못한 파일 확인
- 비밀값과 고객 데이터가 staged 상태가 아닌지 확인
- 웹 빌드, 서버 테스트, Android 빌드/린트 실행
- 변경 파일만 커밋하고 `main` 푸시
- 웹 변경이 있으면 Vercel 프로덕션 배포 후 Ready 상태 확인
- 운영 사이트가 새 JS 번들을 응답하는지 확인
- Android 키 또는 AAB를 Git에 올리지 않았는지 확인
