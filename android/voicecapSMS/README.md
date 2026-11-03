# voicecapSMS (Android 8.0+)

VoiceCAP 웹앱의 판매자 작업공간에 1회용 연결 코드로 연결되는 안드로이드 앱 두 개입니다. 한 프로젝트에서 같이 빌드하지만 휴대폰에는 따로 설치됩니다.

| 모듈 | 앱 이름 | 패키지 | 하는 일 |
|---|---|---|---|
| `app` | VoiceCAP SMS Bridge (문자) | `shop.voicecap.smsbridge` | 기본 문자앱. 구매정보·업무 고객 문자 동기화, 웹에서 넣은 문자 발송 |
| `deposit` | VoiceCAP 입금확인 | `shop.voicecap.deposit` | 고른 은행 앱의 입금 알림(선택: 은행 입금 문자)에서 입금만 읽어 `payment-incoming`으로 전송 |
| `sales` | VoiceCAP 판매 | `shop.voicecap.seller` | 폰 단독 판매(PC 없음): [판매] 탭 댓글터치 판매, [관리] 탭 판매내역. 블루투스 라벨프린터로 전표, 앞카메라로 판매 사진 |

- 두 앱은 웹앱에 따로 연결합니다. 웹앱 **마이페이지 → voicecapSMS 휴대폰 연결**에서 코드를 앱마다 한 번씩 만들어 입력합니다.
- 입금확인 앱은 기본 문자앱이 아니어도 됩니다. 은행 입금 문자 읽기를 켤 때만 문자 수신 권한(`RECEIVE_SMS`)을 묻습니다.
- 빌드: `gradlew.bat :app:assembleDebug`(문자) → `app/build/outputs/apk/debug/app-debug.apk`, `gradlew.bat :deposit:assembleDebug`(입금확인) → `deposit/build/outputs/apk/debug/deposit-debug.apk`. 두 앱 모두 `release-output/`에 `voicecap-sms-<버전>-*.apk`, `voicecap-deposit-<버전>-*.apk`로도 복사됩니다. 업로드 키 설정(`VOICECAP_UPLOAD_*`, `signing/`)은 두 앱이 같이 씁니다(`build.gradle`).
- 문자 앱 1.7.0부터 입금확인 탭이 없습니다. 예전 앱에 쌓인 입금 기록은 문자 앱 저장소에 남지만 화면에는 보이지 않고, 새 입금확인 앱은 빈 기록에서 시작합니다(서버로 올라간 입금은 웹앱에 그대로 있습니다).

## 판매 앱 (`sales`)

- 웹 화면을 그대로 쓰는 앱입니다(WebView). 로그인도 웹과 같습니다. 서버 주소는 `VOICECAP_WEB_BASE_URL` 빌드 속성(기본 `https://www.voicecap.shop`). `voicecap.shop`과 `www.voicecap.shop` 사이의 HTTPS 이동은 앱 안에서 열려 프린터 연결이 유지됩니다.
- 1.0.4부터 판매·관리 탭은 하나의 WebView와 로그인 상태를 함께 씁니다. `/app/sell`에서 시작하며 탭을 바꿔도 웹 문서를 다시 읽지 않아 판매 화면과 연결이 유지됩니다. 탭 버튼은 웹에 `app-tab-change`(`tab`: `sell` 또는 `manage`) 이벤트를 보내고, 웹의 뒤로가기는 `VoiceCapAndroid.setTab`으로 앱의 선택 표시를 맞춥니다. 해당 경로와 이벤트를 처리하는 웹 수정도 함께 반영해야 합니다.
- 웹이 라벨(50×30mm 용지, 유효 인쇄폭 48mm, 384×240px)을 그리고 기종별 명령을 만들면 앱이 블루투스로 전송합니다. M50은 Marklife/BLE(서비스 ff00, 쓰기 ff02, 허용 신호 ff03), XP-237BT는 TSPL/SPP 시험 지원입니다. 결과는 `voicecap-android` 이벤트로 돌려줍니다(`src/services/labelPrinter/androidBridge.ts`).
- 판매 사진은 웹의 `getUserMedia`(앞카메라)로 찍습니다. 앱은 카메라 권한만 묻고 마이크는 허용하지 않습니다.
- 판매 중에는 "VoiceCAP 판매 중" 알림(전경 서비스, connectedDevice)이 떠 있어 화면을 꺼도 프린터 연결이 유지됩니다.
- CSV는 다운로드/VoiceCAP 폴더에 저장하고 공유할 수 있습니다(`saveFile`, `shareFile`).
- 빌드: `gradlew.bat :sales:assembleRelease :sales:bundleRelease` → `release-output/voicecap-sales-<버전>-release.apk`, `-release.aab`. 다른 두 앱과 같은 업로드 키로 서명합니다.
- 필요한 서버: sales-api `touch-comment-token`(댓글 연결), 관리자 메뉴 "댓글 연결 키 (Euler)"에 키 저장, DB `202610290002_comment_connection_key.sql`.

### Xprinter XP-237BT 시험 지원 (판매 앱 1.0.5)

- Android 판매 앱과 웹 수정이 모두 필요합니다. 서버/DB 변경은 없습니다. 기존 앱에는 M50 연결을 제공하며, 새 앱의 `printerPickV2`에서 기종을 선택합니다. 오래된 웹 화면이 XP에 Marklife 명령을 보내면 네이티브에서 거절합니다.
- Android 블루투스 설정에서 XP-237BT를 먼저 페어링합니다. 판매 시작 화면 → 프린터 연결 → Xprinter XP-237BT → 페어링된 기기 선택 순서로 연결합니다. 연결한 기종과 기기 주소를 저장하며, 판매 자동출력과 관리 재출력이 함께 사용합니다. 한 번에 한 대를 선택합니다.
- 현재 지원 프로필: **TSPL 라벨 모드, Classic Bluetooth SPP, 간격 2mm, 농도 8, 속도 2ips**. 용지 크기는 **50×30mm(384×240도트), 40×25mm(320×200도트), 40×30mm(320×240도트)** 중 선택합니다. 기본값은 50×30mm입니다. BLE 전용 장치와 영수증 모드는 지원 대상으로 확인하지 않았습니다.
- 판매 시작 화면에서 프린터 연결 후 **용지 크기**를 선택합니다. 선택한 용지를 먼저 장착하세요. 크기를 변경하면 저장과 용지 맞춤 명령을 함께 수행합니다. 선택값은 작업공간·기종·기기별로 이 폰에 저장되며 M50/XP 판매 자동출력·시험 출력·관리 재출력에 공통 적용됩니다. 판매 중에는 변경할 수 없으므로 판매를 멈춘 뒤 용지를 교체합니다. PC 판매도우미의 용지는 해당 PC 설정을 따릅니다.
- 연결 후 `라벨 다시 맞추기`로 용지를 학습하고, `시험 출력`으로 한글·상품번호·금액·방향·여백을 확인합니다. 초기 연결 때도 기기/용지별로 학습 명령을 한 번 보냅니다. 관리 화면에서 먼저 연결한 경우 판매 화면에서 용지를 맞춘 뒤 시험 출력합니다.
- SPP 전송은 직렬 처리하고, 연결은 15초·전송은 25초에 제한합니다. 부분 전송을 자동 재시도하지 않습니다. 전송 예외 시 연결을 닫고 판매 대기열은 UNKNOWN으로 기록합니다. 관리 직접 재출력은 기존 서버 임대 만료 처리로 출력 여부 확인 상태가 되도록 결과를 미확정으로 둡니다. 전송 완료는 종이가 실제로 출력됐다는 센서 확인을 뜻하지 않습니다.
- 공식 자료: [국내 XP-237BT 제품](https://www.xprinter.co.kr/product/detail.html?product_no=93), [제조사 XP-237B 계열 사양](https://www.xprintertech.com/thermal-printer-for-restaurant-for-mall-xprinter). 계열 자료를 참고한 구현이며 **실제 XP-237BT의 펌웨어·SPP 연결·비트맵 극성·간격 검출은 미검증**입니다. 실물 확인 전에는 지원 완료로 취급하지 않습니다.

실물 인수 확인:

1. 자체 테스트 출력으로 모델·펌웨어·TSPL 모드를 기록하고 SPP 페어링/연결을 확인합니다.
2. 시험 라벨의 흑백 극성·한글·금액·상품번호·첫 장 위치를 확인합니다. 50장 연속 출력에서 누락·중복·빈 라벨·누적 밀림이 없어야 합니다.
3. 앱 재실행, 화면 꺼짐, 전원 재시작 후 재연결을 확인합니다. 용지 없음·커버 열림·전송 중 전원 차단 후 실제 출력 여부와 서버 상태를 대조합니다.
4. M50 ↔ XP 기종 전환 후 자동출력·관리 재출력과 기기별 보정을 확인합니다. 기존 M50 및 PC 출력 전환도 재검증합니다.

자동 검증: `node --test test/xprinter-protocol.test.mjs test/label-printer-protocol.test.mjs test/phone-printer-reconnect.test.mjs test/app-reprint.test.mjs test/phone-print-target.test.mjs test/sale-print-dispatch.test.mjs`, `npx tsc --noEmit`, `node scripts/verify-phone-print-routing.mjs`, `gradlew.bat :sales:assembleDebug :sales:testDebugUnitTest`.

## 지원 범위

댓글 수신 연결은 종료 이벤트뿐 아니라 수신 정지도 감시합니다. 모든 WebSocket 프레임이 90초간 없거나, 토큰 요청 15초·연결 시도 20초·방송 연결 복구 상태 20초가 지나면 댓글 연결만 다시 만듭니다. 좋아요 등 댓글 외의 유효 프레임도 수신 활동으로 인정합니다. 네트워크 복귀·화면 복귀에서도 연결 상태를 확인하며 이전 소켓의 늦은 이벤트는 무시합니다. 같은 댓글의 중복 표시를 막는 기록은 재연결 때 유지합니다. 판매·프린터·촬영 실행은 댓글 재연결로 다시 시작하지 않습니다. 펼친 판매 설정의 **댓글 재연결** 버튼으로 즉시 다시 시도할 수도 있습니다.

연결 진단은 이 폰의 `voicecap-comment-connection:<workspaceId>` 로컬 저장소에 최근 40개의 원인 코드·시각·종료 코드·수신 공백 시간만 남깁니다. 댓글 원문·닉네임·연결 URL·JWT는 포함하지 않습니다. 자동 검증은 `test/euler-stream-recovery.test.mjs`, 실제 시간의 수신 중단 복구 검증은 `node scripts/verify-comment-recovery-ui.mjs`, 운영 파일 확인은 `node scripts/verify-printer-release.mjs --compact --comments`입니다.

판매 앱 1.0.6은 하단 탭을 웹과 통합합니다. 판매 화면의 하단은 **판매 · 관리 · 취소 · 확인** 한 줄이며, 가격 입력·판매 상세·판매내역·관리 화면에서도 판매/관리 이동을 유지합니다. 새 웹이 `setWebNavigation(true)`를 호출한 경우 네이티브의 기존 탭을 숨기고, 웹이 이전 버전이면 기존 탭을 유지합니다.

상품명이 없는 댓글터치 판매는 서버가 회차별로 `1번`, `2번` 순서로 이름을 배정합니다(`202611030001_touch_auto_product_numbers.sql`). 저장 재시도는 기존 번호를 반환하며 취소한 번호는 재사용하지 않습니다. 기존 회차 이어서 판매는 같은 번호 순서를 유지합니다. 판매 상세의 키핑하기는 기존 고객 키핑에 해당 판매만 추가합니다.

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

입금확인 앱은 Play용으로 `.\gradlew.bat :deposit:bundlePlay`를 씁니다(`deposit/build/outputs/bundle/play/deposit-play.aab`, `release-output/voicecap-deposit-<버전>-play.aab`). `play` 빌드 유형은 release와 같은 키로 서명하고 은행 입금 문자 읽기만 뺍니다(`RECEIVE_SMS`·문자 수신기 제거, 스위치·안내 문구 숨김, `deposit/src/play/`). Play는 기본 문자앱이 아닌 앱의 문자 권한을 정해진 예외로만 허용하기 때문입니다. 직접 설치용 debug·release APK에는 그대로 있습니다.
