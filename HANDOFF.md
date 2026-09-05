# VoiceCAP 개발 인계인수서

기준: 2026-09-05 (Asia/Seoul)
최신 커밋: 9e4291b
작업 경로: C:\dev\voice-pin-anti

## 운영 기준점

| 항목 | 값 |
| --- | --- |
| Git 저장소 | https://github.com/nettman001-hub/voice-pin-web.git |
| 브랜치 | main |
| 운영 웹 | https://www.voicecap.shop |
| Vercel 프로젝트 | voice-pin-web |
| Supabase 프로젝트 ref | ymegrhxpbeanvxwdzfym |
| Edge Function | voicecap-onboard |
| 프런트엔드 | React 18, TypeScript, Vite, Tailwind CSS |

main에 push하면 Vercel Production이 자동 배포된다. 최종 확인 배포는 Ready 상태였다.

중요: Supabase Edge Function은 GitHub/Vercel 자동 배포 대상이 아니다. supabase/functions/voicecap-onboard/index.ts를 바꿨다면 Supabase Dashboard에서 별도로 Deploy updates를 실행해야 한다.

## 최근 커밋과 구현

| 커밋 | 내용 |
| --- | --- |
| 9e4291b | STT 키 클라우드 단일 원본, 새로고침 세션 복구, 관리자 권한 경계 |
| ffbda2a | 회원가입 버튼 문구를 회원가입하기로 변경 |
| 103df17 | 회원 데이터 클라우드 단일 원본 전환 |
| 37082fe | 가입 회원 관리자 목록 동기화 복구 |
| 053c8da | Supabase 가입 판매자 목록 연동 및 공유 DB 격리 |

### 2026-09-05 완료한 문제 해결

1. test@test.com은 STT 지원 권한이 허용됐지만 관리자 키 등록 대기로 보였다.
   - 원인: Deepgram/Soniox 공용 키가 과거 관리자 PC localStorage에만 있었고 클라우드에는 없었다.
   - 해결: 두 키와 기본 공급자 설정을 Supabase로 이전했다.
   - 검증: 기본 공급자는 SONIOX이고, Deepgram/Soniox 키가 모두 등록된 상태다. 실제 키 값은 절대 문서·Git·채팅·로그에 기록하지 않는다.

2. 브라우저 새로고침 시 로그아웃됐다.
   - 원인: Supabase persistSession false로 메모리 세션만 사용했다.
   - 해결: 회원 프로필은 저장하지 않고 탭 단위 sessionStorage에는 refresh token만 보관한다. 새로고침 때 서버에서 세션을 재발급한다.
   - 결과: 새로고침은 로그인 유지, 탭/브라우저를 닫으면 다시 로그인 필요.
   - 주의: 이 변경 배포 전 로그인 세션에는 refresh token이 없으므로 사용자마다 한 번만 재로그인이 필요하다.

3. 관리자 계정이 없었다.
   - nettman@naver.com을 관리자 계정으로 지정했다.
   - auth.users.app_metadata.role = ADMIN.
   - workspace_members.role = MANAGER.
   - 표시 이름은 관리자, 작업공간 이름은 관리자의 VoiceCAP.

4. 과거 로컬 회원 목록 4개는 실제 가입 계정이 아니라 코드 내 테스트 시드였다.
   - seller@dadryeo.com, admin@dadryeo.com, baduser@dadryeo.com, rookie@dadryeo.com.
   - 비밀번호와 Supabase 인증 계정이 없는 목업이므로 클라우드로 생성하지 않고 제거했다.
   - 실제 회원가입 계정은 Supabase auth.users가 원본이다.

## 회원·인증 아키텍처

### 단일 원본 정책

회원 원본은 Supabase다. 브라우저 localStorage에 회원 목록, 현재 회원, 역할, STT 권한, Supabase 전체 세션 객체를 저장하지 않는다.

src/services/storageService.ts의 clearLegacyMemberData()는 아래 과거 데이터를 제거한다.

- dadryeo_users
- dadryeo_current_user
- dadryeo_token
- 과거 Supabase sb-*-auth-token
- 과거 Deepgram/Soniox 로컬 키와 STT 공급자 값

### Supabase 데이터 역할

| 위치 | 용도 |
| --- | --- |
| auth.users | 이메일 인증 계정 및 권한 메타데이터 |
| user_metadata.auth_app | VoiceCAP 계정 표식 voicecap |
| user_metadata.display_name | 표시 이름 기본값 |
| app_metadata.role | ADMIN이면 관리자 |
| app_metadata.voicecap_stt_allowed | 판매자의 관리자 공용 STT 키 사용 허용 |
| app_metadata.voicecap_status | 활성 또는 정지 |
| app_metadata.voicecap_suspended_reason | 정지 사유 |
| profiles | display_name, phone 등 표시 정보 |
| workspaces | 회원 작업공간 |
| workspace_members | 작업공간 소속과 역할. MANAGER면 목록에서 관리자 |
| workspace_settings | 공용 STT 설정 등 작업공간 설정 |

### 확인된 운영 회원 (2026-09-05)

- nettman@naver.com: 관리자 (ADMIN / MANAGER)
- test@test.com: 판매자, STT 키 지원 허용
- nettman004@gmail.com: 판매자, STT 키 지원 허용
- nettman005@gmail.com: 판매자
- nettman006@gmail.com: 판매자

이 값은 운영 중 변경될 수 있으므로 작업 시작 전 관리자 목록 또는 Supabase auth.users에서 재확인한다.

## 로그인 세션 구현

관련 파일:

- src/services/supabaseClient.ts
- src/context/AuthContext.tsx
- src/pages/auth/LoginPage.tsx

동작:

1. Supabase client는 persistSession false다. Supabase가 localStorage에 전체 세션과 사용자 객체를 저장하지 않는다.
2. 로그인/회원가입 인증 완료 시 refresh token만 sessionStorage의 voicecap_session_refresh_token에 저장한다.
3. 새로고침 시 restoreSupabaseSession()이 refreshSession()으로 세션을 다시 발급한다.
4. access token과 최신 회원 메타데이터는 서버에서 다시 받아 React 메모리에만 둔다.
5. 로그아웃, 만료, 탭/브라우저 종료 시 token은 제거된다.

이 방식을 persistSession true 또는 localStorage 전체 세션 저장으로 되돌리지 말 것. 새로고침 유지와 회원 정보 로컬 저장 최소화를 함께 만족시키기 위한 설계다.

## 공용 STT 구조

### 정책

- 공급자: DEEPGRAM 또는 SONIOX.
- 판매자는 voicecap_stt_allowed = true를 부여받아야 공용 키를 쓸 수 있다.
- 관리자는 항상 공용 키 사용이 허용된다.
- Soniox는 한국어 힌트 엄격 제한을 사용하며 자동 엔드포인트 감지와 화자 분할은 사용하지 않는다.

### 저장 위치

공용 설정은 workspace_settings에 아래 형식으로 저장된다.

    namespace: voicecap-global-stt
    value: {
      provider: DEEPGRAM | SONIOX,
      deepgramApiKey: string,
      sonioxApiKey: string
    }

2026-09-05에 이 설정 레코드를 nettman@naver.com의 관리자 작업공간으로 옮겼다. 키 원문은 어떤 산출물에도 기록하지 않는다.

### 요청 흐름

    관리자 대시보드에서 키 저장
      -> LiveContext.setDeepgramApiKey / setSonioxApiKey / setSttProvider
      -> remoteWorkspaceService.saveGlobalSttSettings()
      -> Edge Function voicecap-onboard (set-stt-settings)
      -> Supabase workspace_settings

    판매자 로그인
      -> AuthContext가 최신 권한 조회
      -> LiveContext가 get-stt-settings 호출
      -> 허용된 판매자에게만 키를 React 메모리에 전달
      -> 클라우드 STT 연결

### 관리자 보안 경계

voicecap-onboard의 다음 action은 app_metadata.role === ADMIN만 처리할 수 있다.

- list-voicecap-sellers
- set-stt-access
- set-member-status
- set-stt-settings

프런트엔드도 src/App.tsx의 AdminRoute로 /admin 경로를 관리자에게만 열고, src/components/common/Header.tsx의 관리자 모드 버튼도 관리자에게만 표시한다.

중요: 현재 브라우저가 STT 공급자 WebSocket에 직접 연결하므로 허용된 판매자 브라우저는 API 키를 메모리에서 받아야 한다. 키를 브라우저에 전혀 전달하지 않으려면 실시간 오디오 중계 서버 프록시가 필요하다.

## 파일 맵

| 파일 | 책임 |
| --- | --- |
| src/services/supabaseClient.ts | Supabase client 및 refresh-token 세션 복구 |
| src/context/AuthContext.tsx | 로그인·가입·프로필, auth 메타데이터를 앱 User로 변환 |
| src/context/AppDataContext.tsx | 관리자 회원 목록 클라우드 조회 |
| src/services/remoteWorkspaceService.ts | Edge Function 호출과 Supabase 매핑 |
| src/context/LiveContext.tsx | 클라우드 STT 키 로드와 스트림 시작 |
| src/pages/admin/AdminDashboardPage.tsx | 공용 STT 서비스·키 관리 UI |
| src/pages/admin/MemberManagementPage.tsx | 회원 정지/해제와 STT 키 지원 토글 |
| src/pages/seller/LiveHomePage.tsx | 판매자 STT 상태·안내·청취 UI |
| src/services/storageService.ts | 비회원 UI 설정과 과거 데이터 정리. 회원·공용 키 원본으로 사용 금지 |
| supabase/functions/voicecap-onboard/index.ts | 온보딩, 관리자 회원 관리, 공용 STT API |
| src/App.tsx | 인증 및 관리자 라우트 가드 |

## 로컬 개발과 검증

    cd C:\dev\voice-pin-anti
    npm ci
    npm run build
    npm run dev

기본 검증:

    npm run build
    git diff --check
    git status --short

Edge Function 문법 점검:

    npx esbuild supabase/functions/voicecap-onboard/index.ts --bundle --platform=browser --format=esm --outfile=$env:TEMP\voicecap-onboard-check.js

환경 변수:

- .env.example: 공개 가능한 형식 확인용.
- .env.local, .env.production.local: 비밀값을 포함할 수 있다. Git·문서·채팅에 복사하지 않는다.
- server/.env.example: 로컬 브리지 설정 예시.

## 배포 절차

### 웹 프런트엔드

    git add -- <changed-files>
    git commit -m "<message>"
    git push origin main

확인:

    npx vercel ls --yes
    npx vercel inspect <deployment-url>

Ready / Production과 www.voicecap.shop alias를 확인한다.

### Supabase Edge Function

현재 PC에는 Supabase CLI access token이 없어 아래 명령은 실패할 수 있다.

    npx supabase functions deploy voicecap-onboard --project-ref ymegrhxpbeanvxwdzfym

대신 Supabase Dashboard에서 배포한다.

1. 프로젝트 ymegrhxpbeanvxwdzfym -> Edge Functions -> voicecap-onboard -> Code.
2. 로컬 supabase/functions/voicecap-onboard/index.ts 전체를 붙여 넣는다.
3. Deploy updates를 누른 뒤 확인 대화상자에서 배포한다.
4. Successfully updated edge function 토스트와 업데이트 시각을 확인한다.

프런트엔드와 Edge Function의 action/응답 형식이 같이 변하면 반드시 양쪽을 모두 배포한다.

## 운영 검증 체크리스트

- [ ] npm run build 성공.
- [ ] Vercel Production Ready.
- [ ] Edge Function 변경 시 Successfully updated edge function 확인.
- [ ] 관리자 로그인 후 /admin 접근 가능.
- [ ] 판매자 로그인 후 /admin 접근 시 /live로 이동.
- [ ] STT 지원 토글이 클라우드 메타데이터를 갱신.
- [ ] 허용된 판매자 로그인 시 관리자 지원 키 연결됨 표시.
- [ ] 미허용 판매자는 키 값 없이 관리자 승인 필요 표시.
- [ ] 로그인 뒤 새로고침 시 세션 유지.
- [ ] 탭을 닫고 재접속 시 다시 로그인 필요.

## 후속 주의 사항

1. 새로고침 세션은 구현·빌드까지 완료됐다. 실제 운영 계정으로 한 번 재로그인한 다음 새로고침을 확인해야 한다.
2. 판매 기록, 캡처, 규칙, 알림 등 일부 비회원 앱 상태는 호환성 때문에 localStorage 코드가 남아 있다. 회원 프로필·권한·세션·공용 STT 키는 로컬 원본이 아니다.
3. 모든 업무 데이터까지 완전 클라우드화하라는 별도 요청이 오면 범위를 합의하고 마이그레이션을 진행한다.
4. 댓글 도우미와 Android 영역은 별도 재검증이 필요하다. 수정 전 desktop/comment-helper/package.json, GitHub Releases, Android Gradle, 실제 설치 파일을 대조한다.

## 보안 원칙

- API 키, service-role key, access token, 비밀번호, 인증번호, keystore 비밀번호를 Git·문서·채팅·스크린샷에 남기지 않는다.
- 권한 변경 시 auth.users 메타데이터, profiles, workspace_members의 역할 표현이 서로 다른지 확인한다.
- 관리자 변경은 app_metadata.role = ADMIN과 workspace_members.role = MANAGER를 함께 검토한다.
- Supabase SQL 검증은 API 키 원문 대신 length(...), boolean, row count로 수행한다.
- 공용 STT 키 변경은 관리자 계정으로만 수행한다.

이 문서가 현재 프로젝트 루트 HANDOFF.md의 최신 기준이다. 이전 문서의 경로, 릴리스 버전, 비밀값 관련 서술은 신뢰하지 않는다.
