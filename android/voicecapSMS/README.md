# voicecapSMS (Android 8.0+)

VoiceCAP 웹앱과 같은 판매자 ID로 연결되는 SMS/MMS 브리지 앱입니다.

## 지원 범위

- 최소 Android 8.0 (API 26), 대상 Android 15 (API 35)
- 수신 SMS와 MMS 본문/이미지(이미지당 최대 4MB, 최대 8개)를 판매 대조 API로 업로드
- 웹앱에서 큐에 넣은 정산서·배송·문의 SMS를 Android의 기본 메시지 기능으로 전송
- Android 8.0 이상의 백그라운드 제한을 지키기 위해 수신 이벤트는 `JobScheduler`로 넘기고 15분마다 재동기화

## 설치 및 연결

1. Android Studio에서 이 폴더를 열거나 `gradlew.bat :app:assembleDebug`로 APK를 빌드한다.
2. 앱을 설치한 뒤 서버 주소, API 키, 웹앱과 같은 판매자 ID를 저장한다.
3. 문자 권한을 허용하고 기본 SMS 앱 역할을 허용한다.
4. **지금 동기화 및 발송 처리**를 눌러 연결을 확인한다.

PC의 로컬 서버와 연결할 때는 서버 `.env`의 `HOST=0.0.0.0`과 강한 `SMS_BRIDGE_API_KEY`를 설정하고, 같은 신뢰할 수 있는 Wi-Fi에서 PC의 사설 IP를 서버 주소로 사용한다. 인터넷에 노출되는 환경은 HTTPS 역방향 프록시를 사용한다.

`SENT` 상태는 Android OS에 문자 전송을 요청한 결과입니다. 통신사 최종 배달 상태는 별도 전송/배달 리포트 연동이 필요합니다.
