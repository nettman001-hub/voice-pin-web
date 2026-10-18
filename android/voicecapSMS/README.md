# voicecapSMS (Android 8.0+)

VoiceCAP 웹앱의 판매자 작업공간에 1회용 연결 코드로 연결되는 안드로이드 앱 두 개입니다. 한 프로젝트에서 같이 빌드하지만 휴대폰에는 따로 설치됩니다.

| 모듈 | 앱 이름 | 패키지 | 하는 일 |
|---|---|---|---|
| `app` | VoiceCAP SMS Bridge (문자) | `shop.voicecap.smsbridge` | 기본 문자앱. 구매정보·업무 고객 문자 동기화, 웹에서 넣은 문자 발송 |
| `deposit` | VoiceCAP 입금확인 | `shop.voicecap.deposit` | 고른 은행 앱의 입금 알림(선택: 은행 입금 문자)에서 입금만 읽어 `payment-incoming`으로 전송 |

- 두 앱은 웹앱에 따로 연결합니다. 웹앱 **마이페이지 → voicecapSMS 휴대폰 연결**에서 코드를 앱마다 한 번씩 만들어 입력합니다.
- 입금확인 앱은 기본 문자앱이 아니어도 됩니다. 은행 입금 문자 읽기를 켤 때만 문자 수신 권한(`RECEIVE_SMS`)을 묻습니다.
- 빌드: `gradlew.bat :app:assembleDebug`(문자) → `app/build/outputs/apk/debug/app-debug.apk`, `gradlew.bat :deposit:assembleDebug`(입금확인) → `deposit/build/outputs/apk/debug/deposit-debug.apk`. 두 앱 모두 `output/`에 `voicecap-sms-<버전>-*.apk`, `voicecap-deposit-<버전>-*.apk`로도 복사됩니다. 업로드 키 설정(`VOICECAP_UPLOAD_*`, `signing/`)은 두 앱이 같이 씁니다(`build.gradle`).
- 문자 앱 1.7.0부터 입금확인 탭이 없습니다. 예전 앱에 쌓인 입금 기록은 문자 앱 저장소에 남지만 화면에는 보이지 않고, 새 입금확인 앱은 빈 기록에서 시작합니다(서버로 올라간 입금은 웹앱에 그대로 있습니다).

## 지원 범위

- 최소 Android 8.0 (API 26), 대상 Android 16 (API 36)
- 닉네임·주소·상품/금액 항목이 함께 있는 첫 구매정보 SMS/MMS로 업무 고객 번호를 등록
- 등록 고객의 배송·입금·계좌번호 등 후속 문의와 판매자 답변을 같은 거래 문자 이력으로 동기화
- 등록되지 않은 번호의 OTP와 일반 개인 문자는 서버로 전송하지 않음
- 입금확인 앱(`deposit`, 선택): 알림 접근을 켜고 직접 고른 은행 앱의 입금 알림만 읽어 금액·입금자명·시각·은행·받는 계좌 별칭만 `payment-incoming`으로 전송. 알림 원문은 기기 밖으로 나가지 않고, 고르지 않은 앱의 알림은 즉시 버림. 규칙은 `deposit/src/main/assets/bank_rules.json`, fixture는 `deposit/src/test/resources/bank-noti/`
- 웹앱에서 큐에 넣은 정산서·배송·문의 SMS를 Android의 기본 메시지 기능으로 전송
- Android 8.0 이상의 백그라운드 제한을 지키기 위해 수신 이벤트는 `JobScheduler`로 넘기고 15분마다 재동기화
- 웹 즉시 발송(1.6.0): 웹이 문자를 대기열에 넣으면 서버(`device-pair` `notify-outbox`)가 내용 없는 FCM 고우선순위 신호(`data.type=OUTBOX`)를 보내고, `PushService`가 바로 `outbox-claim` → 발송한다. 웹에서 문자를 보낼 때 휴대폰을 깨우기 위해 Firebase 클라우드 메시징(FCM) 알림 토큰을 서버에 저장하며, 휴대폰 연결을 해제하면 삭제합니다. 구글 서비스가 없는 폰이나 서버에 `FCM_SERVICE_ACCOUNT_JSON`이 없을 때는 기존 15분 주기(앱 화면이 떠 있으면 30초마다)로 처리한다. Firebase 설정은 `app/google-services.json`(공개 설정, 비밀 키 아님)

## 설치 및 연결

1. Android Studio에서 이 폴더를 연다.
2. 웹앱 **마이페이지 → voicecapSMS 휴대폰 연결**에서 연결 코드를 만든다.
3. 앱의 **기기 연결 코드**에 표시된 코드를 입력해 연결한다. 코드는 10분 안에 한 번만 쓸 수 있다.
4. 앱의 개인정보 전송 안내에 동의한다.
5. 기본 SMS 앱 역할을 먼저 허용한 뒤 SMS/MMS 권한을 허용한다.
6. **지금 동기화 및 발송 처리**를 눌러 연결을 확인한다.

운영 APK는 `VOICECAP_API_BASE_URL` 빌드 속성으로 정한 HTTPS API 주소만 사용합니다. 기본값은 VoiceCAP Supabase 함수 주소인 `https://ymegrhxpbeanvxwdzfym.supabase.co/functions/v1`입니다. 휴대폰 사용자가 서버 주소·API 키·판매자 ID를 직접 입력하지 않습니다.

`SENT` 상태는 Android OS에 문자 전송을 요청한 결과입니다. 통신사 최종 배달 상태는 별도 전송/배달 리포트 연동이 필요합니다.

## 공식 테스트 배포

최신 갤럭시 보안 정책은 이메일·브라우저·메신저에서 받은 사이드로드 APK를 피싱 의심 앱으로 차단할 수 있습니다. 실기기 테스트는 Google Play Console의 내부 테스트 트랙 또는 Galaxy Store 비공개 테스트로 배포합니다.

Play Console용 서명 AAB를 만들 때 다음 환경 변수를 지정합니다.

```powershell
$env:VOICECAP_UPLOAD_KEYSTORE='C:\secure\voicecap-upload.jks'
$env:VOICECAP_UPLOAD_STORE_PASSWORD='스토어 비밀번호'
$env:VOICECAP_UPLOAD_KEY_ALIAS='voicecap-upload'
$env:VOICECAP_UPLOAD_KEY_PASSWORD='키 비밀번호'
.\gradlew.bat :app:bundleRelease
```

생성 파일은 `app/build/outputs/bundle/release/app-release.aab`입니다. 업로드 키와 비밀번호는 저장소에 커밋하지 말고 안전하게 백업합니다. Play Console에는 패키지 ID `shop.voicecap.smsbridge`를 등록하고 SMS/통화 기록 권한 선언에서 **기본 SMS 처리**를 핵심 기능으로 정확히 고지해야 합니다.
