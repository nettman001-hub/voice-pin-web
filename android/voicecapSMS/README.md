# voicecapSMS (Android 8.0+)

VoiceCAP 웹앱의 판매자 작업공간에 1회용 연결 코드로 연결되는 SMS/MMS 브리지 앱입니다.

## 지원 범위

- 최소 Android 8.0 (API 26), 대상 Android 15 (API 35)
- 닉네임·주소·상품/금액 항목이 함께 있는 첫 구매정보 SMS/MMS로 업무 고객 번호를 등록
- 등록 고객의 배송·입금·계좌번호 등 후속 문의와 판매자 답변을 같은 거래 문자 이력으로 동기화
- 등록되지 않은 번호의 OTP, 은행 알림, 일반 개인 문자는 서버로 전송하지 않음
- 웹앱에서 큐에 넣은 정산서·배송·문의 SMS를 Android의 기본 메시지 기능으로 전송
- Android 8.0 이상의 백그라운드 제한을 지키기 위해 수신 이벤트는 `JobScheduler`로 넘기고 15분마다 재동기화

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
