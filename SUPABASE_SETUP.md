# VoiceCAP 수파베이스 운영 전환

## 구성

- **Supabase Auth**: 판매자 로그인 및 비밀번호 재설정
- **Postgres + RLS**: 모든 업무 행을 `workspace_id`로 분리
- **Private Storage**: 판매 캡처와 MMS 이미지는 로그인한 해당 작업공간만 읽음
- **Edge Functions**: `device-pair`, `sms-bridge`가 Android 연결 코드·수발신을 처리
- **별도 Node 워커**: 장시간 연결이 필요한 TikTok 수집은 Edge Function에 넣지 않고 별도 배포한다.

## 최초 설정 순서

1. 전용 프로젝트 대신 기존 `sermon-guide-db` 프로젝트를 함께 사용한다. VoiceCAP는 기존 인증 트리거를 건드리지 않고, 첫 VoiceCAP 로그인 시 `voicecap-onboard` 함수가 별도 판매자 작업공간을 만든다.
2. SQL Editor에서 `supabase/migrations/202608300001_initial_multitenant.sql` 전체를 한 번 실행한다.
3. 프로젝트 API 설정에서 **Project URL**과 **publishable/anon key**를 확인해 루트의 `.env.local`에 넣는다.

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
VITE_VOICECAP_API_BASE_URL=https://ymegrhxpbeanvxwdzfym.supabase.co/functions/v1
```

4. Edge Function 비밀값을 설정한다. `VOICECAP_PAIRING_PEPPER`는 암호학적으로 무작위인 긴 문자열이며, Git이나 프런트엔드 환경변수에 넣지 않는다. `VOICECAP_WEB_ORIGIN`은 실제 웹앱 주소로 바꾼다.

```powershell
npx supabase login
npx supabase link --project-ref ymegrhxpbeanvxwdzfym
npx supabase secrets set VOICECAP_PAIRING_PEPPER=<long-random-secret> VOICECAP_WEB_ORIGIN=https://www.voicecap.shop
npx supabase functions deploy voicecap-onboard --no-verify-jwt
npx supabase functions deploy device-pair --no-verify-jwt
npx supabase functions deploy sms-bridge --no-verify-jwt
```

5. 웹을 재배포한다. 인증 URL 설정에서 Site URL과 Redirect URL에 `https://www.voicecap.shop` 및 `https://www.voicecap.shop/password/reset`을 등록한다.
6. Android APK는 배포 API 주소로 빌드한다.

```powershell
cd android/voicecapSMS
.\gradlew.bat :app:assembleRelease -PVOICECAP_API_BASE_URL=https://ymegrhxpbeanvxwdzfym.supabase.co/functions/v1
```

검증 중에는 실제 수파베이스 함수 주소로 바꾼다.

```powershell
.\gradlew.bat :app:assembleDebug -PVOICECAP_API_BASE_URL=https://<project-ref>.supabase.co/functions/v1
```

## 운영 확인

1. 웹에서 판매자 계정을 새로 만든다.
2. 마이페이지에서 1회용 연결 코드를 만든다.
3. Android 앱에서 코드를 입력하고 기본 SMS 앱·권한을 허용한다.
4. 휴대폰에서 고객 문자를 동기화하고 웹의 고객/판매 상세에서 수신 이력이 보이는지 확인한다.
5. 웹에서 정산서 또는 문의 문자를 발송하고 앱이 큐를 가져와 발송 상태를 `SENT`로 바꾸는지 확인한다.

## 주의사항

- Free 플랜은 비활성 프로젝트를 일시 중지할 수 있고 자동 백업이 없다. 정기적으로 `supabase db dump` 또는 관리 화면 백업을 별도로 보관한다.
- `service_role` 키와 업로드 서명키는 절대 `.env.local`, Git, APK, 브라우저 코드에 넣지 않는다. `sermon-guide-db`의 기존 테이블, Auth 사용자, 트리거, Storage 객체는 VoiceCAP 배포 과정에서 수정하거나 삭제하지 않는다.
- `api.voicecap.shop`은 Supabase Edge Function으로 HTTPS 프록시/DNS를 연결한 뒤에만 Android 운영 APK 기본 주소로 사용한다. DNS가 준비되기 전에는 프로젝트별 `supabase.co/functions/v1` 주소로 검증한다.
