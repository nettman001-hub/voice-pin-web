# VoiceCAP 작업 인수인계서

작성일: 2026-08-27 (Asia/Seoul)

## 1. 저장소 및 배포

- 로컬 작업 경로: `C:\dev\voice-pin-anti`
- GitHub: https://github.com/nettman001-hub/voice-pin-web
- 운영 사이트: https://www.voicecap.shop
- 기본 브랜치 및 배포 브랜치: `main`
- 배포 방식: GitHub `main` 푸시 후 운영 사이트 자동 배포
- 현재 배포 커밋: `56c7ca9276eeff9632a9d4927a2298a394d9ce46`
- 현재 운영 JS 번들: `index-BqKuez2i.js`

작업 시작 시 반드시 아래 순서로 다른 컴퓨터의 변경 여부를 확인한다.

```powershell
git status --short --branch
git fetch origin
git rev-list --left-right --count HEAD...origin/main
git pull --ff-only origin main
npm install
npm run build
```

사용자가 작업 중인 Chrome과 GitHub에는 로그인되어 있다. 로그인 정보나 API 키는 문서 및 커밋에 기록하지 않는다.

## 2. 현재 구현된 주요 변경

### 캡처 영역 스튜디오

- 기존 직접 드래그/2회 터치 모드, 프리셋 버튼, 가상 TikTok·OBS 화면을 제거했다.
- 최초 진입 시 16:9 흰색 빈 상자를 표시한다.
- 빈 상자 중앙에 `실시간 캡처영역설정` 버튼을 표시한다.
- 공유 화면이 연결되면 실제 화면을 박스 안의 비디오로 보여주고 캡처 영역을 드래그하거나 모서리 핸들로 조절한다.
- `현재 윈도우 영역 설정 저장하기` 클릭 시 현재 비디오 프레임을 JPEG 정지 이미지로 저장하고 실시간 미리보기를 정지 화면으로 전환한다.
- 정지 이미지는 최대 폭 960px, JPEG 품질 0.72로 저장한다.
- 메뉴 이동 후 돌아왔을 때 메모리 캐시 또는 `localStorage`의 `voicecap_capture_area_snapshot`에서 마지막 저장 화면을 복원한다.
- 저장 공간 부족 시에도 현재 탭의 메뉴 이동 간에는 메모리 캐시로 정지 화면을 유지한다. 브라우저를 완전히 종료한 뒤 복원은 영구 저장 성공 여부에 따라 달라진다.
- 화면 저장 시 실제 공유 스트림은 강제로 종료하지 않는다. 라이브 청취에서 기존 공유를 재사용하기 위함이다.

관련 파일:

- `src/pages/seller/RecognitionRulesPage.tsx`
- `src/services/storageService.ts`
- `src/services/screenCaptureService.ts`
- `src/context/LiveContext.tsx`

### 댓글 자동 캡처

- 신규 환경의 기본 활성 상태는 `중지(false)`다. 사용자가 직접 저장한 선택은 유지한다.
- 자동 캡처가 꺼져 있어도 로컬 댓글 서버 Socket.IO 연결은 유지해 서버 생존 상태를 확인한다.
- `로컬 서버 상태` 카드는 다음처럼 표시한다.
  - 연결 실패: `로컬 서버 미실행`
  - 연결 시도: `로컬 서버 연결중`
  - 서버 연결 후 모든 상태: `로컬서버 대기중`
- 라이브 청취 홈에서 `청취 중지하기`를 누르면 댓글 캡처도 중지되고 `댓글캡처 함께시작` 체크가 해제된다.
- 알림창 닫기 음성 명령은 쉼표로 여러 개 등록할 수 있다. 예: `닫아, 알림 닫기, 확인`.
- 새 전사 문장에 등록 명령 중 하나라도 포함되면 댓글 키워드 알림창을 닫는다.

관련 파일:

- `src/context/CommentCaptureContext.tsx`
- `src/services/commentStreamService.ts`
- `src/pages/seller/RecognitionRulesPage.tsx`
- `src/pages/seller/LiveHomePage.tsx`
- `src/types/comment.ts`
- `server/index.js`

### 5분 무자막 자동 중지

- 라이브 청취 시작 또는 마지막 자막 생성 후 5분 동안 새 자막이 없으면 경고창을 표시한다.
- 경고창은 20초 카운트다운을 표시한다.
- 카운트다운 중 새 최종/중간 자막이 생성되면 경고를 자동 해제하고 5분 타이머를 다시 시작한다.
- 20초가 끝나면 경고창을 닫고 음성 청취와 댓글 캡처를 함께 중지한다.
- 현재 타이머와 경고창은 `LiveHomePage`가 마운트되어 있을 때 동작한다. 청취 중 다른 메뉴로 이동한 상태에서도 감시해야 한다면 `LiveContext` 또는 공통 레이아웃으로 옮겨야 한다.

관련 파일:

- `src/pages/seller/LiveHomePage.tsx`

## 3. 최근 커밋

- `56c7ca9` 무자막 자동 중지 및 다중 음성 명령 지원
- `214e172` 로컬 서버 상태와 댓글 캡처 중지 연동
- `a5bc8ec` 캡처 영역 저장 시 화면 고정 보장
- `da38526` 캡처 영역 저장 화면 유지
- `a828099` 빈 캡처 화면 중앙에 설정 버튼 배치
- `dde8c98` 캡처 영역 설정 단순화 및 댓글 수집 기본 중지
- `585fc5e` 실시간 댓글과 전사 로그 위치 교체

## 4. 실행 및 검증

프런트엔드:

```powershell
npm run build
npm run dev
```

로컬 댓글 서버:

```powershell
cd server
npm install
npm start
```

서버 생존 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:2137/status
```

배포 후 운영 번들 확인 예시:

```powershell
$html = (Invoke-WebRequest -UseBasicParsing 'https://www.voicecap.shop/?deploy=확인할커밋').Content
($html | Select-String -Pattern 'index-[A-Za-z0-9_-]+\.js' -AllMatches).Matches.Value
```

## 5. 다음 작업 시 우선 확인할 항목

1. 실제 Chrome 화면 공유로 캡처 영역을 설정한 뒤 저장 버튼을 눌렀을 때 영상이 즉시 정지 이미지로 바뀌는지 확인한다.
2. 다른 메뉴로 이동했다 돌아왔을 때 마지막 정지 화면과 영역 박스가 복원되는지 확인한다.
3. 로컬 서버가 켜져 있고 댓글 자동 캡처가 꺼진 상태에서 `로컬서버 대기중`이 표시되는지 확인한다.
4. 청취 중지 버튼 클릭 시 댓글 캡처 체크가 즉시 해제되는지 확인한다.
5. 5분 무자막 경고는 실제 시간 검증이 오래 걸린다. 테스트가 필요하면 상수를 임시로 줄여 확인하되, 커밋 전 반드시 5분/20초로 되돌린다.
6. 여러 음성 명령을 저장한 뒤 각 명령으로 댓글 알림창이 닫히는지 확인한다.

## 6. 주의사항

- 화면 공유 선택창은 브라우저 보안 정책상 자동 승인할 수 없다. 실제 사용자가 공유 대상을 선택해야 한다.
- `MediaStream` 자체는 브라우저를 완전히 종료한 뒤 복원할 수 없다. 저장된 정지 이미지만 복원 가능하다.
- 현재 자동화된 테스트 스크립트는 없으며 검증 기준은 TypeScript + Vite 프로덕션 빌드와 운영 화면 확인이다.
- 빌드 시 500kB 초과 번들 경고가 나오지만 현재 빌드는 성공한다.
- 작업 트리에 사용자 변경이 있을 수 있으므로 커밋 전 `git status`와 `git diff`를 반드시 확인한다.
- 배포 후에는 운영 `index-*.js` 해시가 로컬 최신 빌드 해시와 일치하는지 확인한다.

