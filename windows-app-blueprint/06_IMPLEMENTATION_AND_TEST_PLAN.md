# 06. 초보 개발자용 구현 순서와 검증·출시 기준

작성일: 2026-09-26. **아래 작업·파일·검증은 신규 Windows 앱을 개발하기 위한 계획이다. 이번 문서 작성에서 앱 구현, 앱 테스트, 실문자, 프린터 출력, 클라우드 배포를 수행하지 않았다.** 기존 설계도의 테스트 결과는 과거 기준 소스의 결과이며 새 앱의 통과 증거가 아니다.

기능 기준은 [01. 전체 기능 이전 행렬](01_SCOPE_AND_FEATURE_PARITY.md)의 WF-001~WF-067이다. 개발 결과는 각 WF의 완료 기준과 연결해야 한다. 이 문서의 목표 경로는 앞으로 만들 `voicecap-studio/` 기준이다. 문서 폴더 안에 실행 파일을 만들거나 기존 `src/`를 바로 덮어쓰지 않는다.

## 1. 개발을 시작하기 전에 알아야 할 순서

한 단계는 **작게 구현 → 실패 상황 검사 → 증거 저장 → 다음 단계**로 진행한다. 화면을 전부 만든 뒤 데이터를 연결하면 현재 모의 결제·훈련 같은 기능을 완성품으로 오해하기 쉬우므로, 먼저 계약·저장·인증·수동 판매를 완성한다. 이후 댓글·음성을 자동 입력으로 연결한다.

| 말 | 초보자를 위한 설명 | 이 프로젝트에서 지킬 규칙 |
|---|---|---|
| 기능 ID | 무엇을 구현했는지 추적하는 번호 | PR·테스트 제목·인수표에 WF 번호 사용 |
| 단계 gate | 다음 단계로 넘어가기 위한 통과 조건 | 테스트 미수행을 성공으로 적지 않음 |
| 계약 | 화면/프로세스/서버가 주고받는 필드 약속 | TypeScript 타입만 아니라 실행 시 입력 검증 포함 |
| fixture | 실제 고객 대신 사용하는 고정 예제 자료 | 가짜 workspace A/B·고객·발화·결제 ID 사용 |
| adapter | 기존 코드를 새 환경에 연결하는 얇은 변환기 | 원본 업무 규칙과 Windows OS 호출을 분리 |
| outbox | 통신이 끊겨도 남아 있는 전송 대기 기록 | 작업을 저장한 뒤 전송, 동일 operationId 재사용 |
| 멱등성 | 같은 요청을 반복해도 업무가 한 번만 실행되는 성질 | 판매·출력·문자 요청별 ID와 서버 dedupe |
| revision 충돌 | 읽은 뒤 다른 기기가 먼저 수정한 상황 | 최신값을 보여주고 사용자가 다시 적용; 조용한 덮어쓰기 금지 |
| 회귀 검사 | 새 코드로 옛 기능이 망가지지 않았는지 확인 | 기존 순수 로직 테스트와 새 앱 동작 시험을 함께 사용 |
| 실기기 인수 | 마이크·GPU·프린터·휴대폰에서 직접 검증 | mock 테스트 통과가 이 검사를 대신하지 않음 |

### 문서·결과 저장 구조 제안

```text
voicecap-studio/                       # 앞으로 만들 구현 저장소/프로젝트
  apps/desktop/main/                  # 인증·권한·OS·네트워크·worker 감독
  apps/desktop/preload/               # 제한된 renderer API
  apps/desktop/renderer/              # React 화면
  apps/desktop/resources/             # 아이콘·동봉 글꼴·전표 템플릿
  packages/domain/                   # 원화·닉네임·판매·정정 순수 규칙
  packages/contracts/                # 공통 타입·IPC schema·error code
  packages/ui/                       # 공통 React UI 구성요소
  packages/broker/                   # 단일 SQLite 소유 Data broker worker
  packages/storage/                  # broker에서만 사용하는 SQL/migration
  packages/comments/                 # 댓글 수집 worker
  packages/stt/                      # STT worker
  packages/ai/                       # AI worker
  packages/audio/                    # 입력 장치·PCM·장치 복구
  packages/printing/                 # 인쇄 큐·전표·spool adapter
  packages/cloud/                    # main에서 사용하는 클라우드 adapter
  runtime/                           # 런타임·모델 manifest와 조립 도구
  supabase/functions/                # 실제 인증·업무 서버 함수
  tests/unit/                         # 순수 로직
  tests/integration/                  # IPC/SQLite/서버 계약
  tests/e2e/                          # 앱에서 사용자 시나리오
  tests/fixtures/                     # 가짜 입력과 정답
  docs/acceptance/feature-status.csv  # WF 전수 추적
  docs/acceptance/results/            # 로그·성능·스크린샷·인수 기록
  docs/acceptance/migration/          # 익명화한 dry-run 요약
```

위 구조는 각 상세 아키텍처 문서와 함께 적용한다. 파일명 변경은 가능하지만 책임 경계와 기능 추적은 유지한다. 초기 `feature-status.csv`에는 67행을 만들고 상태를 모두 `NOT_STARTED`, 증거를 `미수행: 신규 앱 구현 전`으로 채운다. 빈칸 대신 해당 상태를 적어 누락과 미수행을 구분한다.

## 2. 단계별 작업명세

### P00 — 기준 소스·계약·시연 자료 확정

- **선행:** 기존 복제 설계와 01장의 기능표를 읽는다. 운영 계정이 아닌 별도 개발 환경을 준비한다.
- **수정/생성할 파일:** `docs/acceptance/feature-status.csv`, `packages/contracts/`, `tests/fixtures/`, `docs/decisions/data-semantics.md`.
- **작업:** 41개 route, 67개 WF, API action 목록, 두 판매 경로의 필드 차이를 기록한다. 금액은 원 단위 정수, 수량은 양의 정수, 상품번호는 문자열로 정한다. `0` 가격과 가격 누락을 별도로 표현한다. legacy SaleRecord와 상품 API Sale을 강제 cast하지 않는다.
- **산출물:** workspace A/B, 관리자/판매자/정지 계정, 회차 2개, 같은 번호의 다른 회차 상품, 보류/정정/취소/입금/배송 fixture; 요청/응답/error schema.
- **검증/gate:** 원본 route 41개가 계획에 모두 존재하고 WF 전수가 파일에 있다. 모든 클라우드 action을 성공·인증 실패·충돌·중복 fixture로 설명할 수 있다. 실제 운영 서버 호출은 하지 않는다.
- **실패 복구:** 계약 해석이 다른 경우 소스/SQL 차이를 D 항목으로 등록하고 fixture가 원하는 운영 정책을 명시할 때까지 dependent 작업을 멈춘다.

### P01 — 안전한 Windows shell·디자인 시스템

- **선행:** P00, UI/UX 설계.
- **수정/생성할 파일:** `apps/desktop/main/app.ts`, `apps/desktop/main/windows.ts`, `apps/desktop/preload/index.ts`, `packages/contracts/ipc/`, `apps/desktop/renderer/App.tsx`, `apps/desktop/renderer/routes.tsx`, `packages/ui/`, `apps/desktop/renderer/styles/tokens.css`.
- **작업:** Electron 44 기존 lock 기준을 검토해 의존성을 잠근다. `contextIsolation`, sandbox, `nodeIntegration: false`를 적용한다. 임의 채널 IPC나 임의 URL/파일 경로를 넘기는 API를 만들지 않는다. 창/트레이는 하나의 main 수명주기에 묶는다. 가짜 상태로 41개 경로와 shell을 연결한다.
- **산출물:** 실행 가능한 빈 shell, 버튼/폼/표/패널/모달/배지/토스트의 상태별 UI 목록, 창 상태 저장, 단축키·접근성 기준.
- **검증/gate:** renderer에서 Node/filesystem/token 접근 불가; preload 미등록 command 거절; 마우스 없이 로그인·라이브·판매·설정 접근. 빈 데이터/로딩/오류/긴 한글/축소 창/DPI 확인. 이 단계는 실제 판매 기능 완료가 아니다.
- **실패 복구:** renderer crash는 재시작 안내와 복원 동선만 제공하고 임의로 업무 command를 다시 실행하지 않는다.

### P02 — main 인증 broker·계정·권한

- **선행:** P01, 분리된 개발 Supabase/Auth redirect 설정.
- **파일:** `apps/desktop/main/auth/authBroker.ts`, `apps/desktop/main/security/credentialStore.ts`, `apps/desktop/main/security/authorization.ts`, `packages/contracts/ipc/auth.ts`, `apps/desktop/renderer/features/auth/`.
- **작업:** 가입/OTP/재발송/로그인/세션 갱신/로그아웃/복구를 main에 연결한다. OS 암호화 저장소는 refresh token 등 최소 자격증명만 보관한다. renderer는 `getSessionSummary()`의 사용자/역할/상태만 받는다. recovery callback에는 state·nonce·만료·허용 redirect 검사와 실제 비밀번호 갱신을 연결한다.
- **산출물:** WF-001~007, WF-066의 실제 인증; 서버 관리자 claim 및 workspace membership 검사; 시연 프로필 분리.
- **검증/gate:** 잘못된 OTP·사용한 recovery 링크·role 조작·다른 workspace ID·만료/철회 토큰이 거절된다. 로그아웃 시 댓글/STT/네트워크 구독과 화면 캐시를 정리한다. 로그인 폼의 비밀번호는 전달 후 제거하고 영구 저장하지 않는다. renderer의 저장소/상태 스냅샷/로그/백업에 비밀번호·refresh token이 없다.
- **실패 복구:** 갱신 실패는 재로그인 상태로 전환하고 outbox를 버리지 않는다. 다른 계정이 이전 계정의 대기 작업을 볼 수 없도록 계정+workspace에 격리한다.

### P03 — SQLite 저장·클라우드 어댑터·schema 정합성

- **선행:** P00, P02.
- **파일:** `packages/storage/database.ts`, `packages/storage/migrations/`, `packages/broker/repositories/`, `packages/broker/sync/outbox.ts`, `packages/broker/sync/reconciler.ts`, `packages/cloud/`, 새로운 Supabase migration/함수.
- **작업:** DB는 Data broker utility process만 열어 쓴다. main은 인증·전송·worker 감독을 담당하고 broker에 typed command를 전달한다. 캐시·설정·미전송 command·첨부 staging·동기화 cursor를 분리한다. `operationId/workspaceId/schemaVersion/attempts/nextAttemptAt/lastError`를 저장한다. 서버의 예약 만료·회차 번호 고유성·transaction·RLS·publication 차이 D01~05를 개발 DB에서 해결한다.
- **산출물:** broker repository API와 main 조정자, migration version, 재시도/충돌 상태, 각 판매 필드의 저장/복원 변환표, private asset fetch.
- **검증/gate:** 저장→프로세스 종료→재실행→같은 command 재전송이 한 업무로 수렴. A 토큰으로 B 데이터/Storage 읽기·변경 실패. DB migration 중 실패하면 이전 파일 snapshot으로 복구. 보류·AI·정정 메타를 서버 왕복한 결과가 동일.
- **실패 복구:** 네트워크 단절은 전송 대기, 인증 실패는 재인증 대기, revision 충돌은 검토 필요로 표시하고, 실제 상태 코드와 전이는 03장의 계약을 따른다. 일시 서버 장애만 지수 backoff한다. 데이터 손상을 자동으로 빈 DB 초기화하여 숨기지 않는다. 오프라인에서 이미 받은 자료 조회와 로컬 초안/허용 command 접수는 가능하지만, 서버 승인 전 판매 확정·유료권한 변경·기기 권한 변경을 성공으로 표시하지 않는다.

### P04 — 수동 회차·상품·판매를 먼저 완성

- **선행:** P03.
- **파일:** `packages/domain/sales/`, `apps/desktop/main/commands/sessionCommands.ts`, `apps/desktop/main/commands/productCommands.ts`, `apps/desktop/main/commands/saleCommands.ts`, `apps/desktop/renderer/features/products/`, `apps/desktop/renderer/features/sales/`.
- **작업:** 회차 시작/종료/이어가기, 상품 draft→이미지→commit, 활성 상품, 구매자 선택/수량/판매 commit, preview→commit 변경을 구현한다. 서버 응답 전에는 `동기화 대기`로 표시한다.
- **산출물:** WF-008, WF-020~024, WF-029~030의 실제 저장 흐름. operation 조회·충돌 비교 패널.
- **검증/gate:** 두 회차에 같은 상품번호 사용, 0/미입력 가격, 업로드 실패, draft 만료, stale preview, 동일 operation 두 번, 두 기기 동시 수정. 화면·서버·재시작 후 건수와 합계가 일치.
- **실패 복구:** 이미지 업로드만 성공한 orphan 정리 작업, commit 응답 분실 시 `get-operation`; 상품번호를 임의로 다시 발급하며 재시도하지 않는다.

### P05 — 댓글 도우미를 앱 안으로 통합

- **선행:** P03~04, 테스트 방송/수집 권한.
- **파일:** `packages/comments/index.ts`, `apps/desktop/main/comments/commentController.ts`, `apps/desktop/main/comments/commentPublisher.ts`, `packages/contracts/ipc/comments.ts`, `apps/desktop/renderer/features/comments/`.
- **작업:** 기존 `server/index.js`의 수집 책임과 cloudCommentPublisher의 적재 책임을 UI/HTTP에서 분리해 이식한다. 한 회차당 collector 한 개, publisher 한 개만 활성화한다. 플랫폼 원문 ID·ingestSequence·capturedAt·sessionId를 SQLite에 기록한 뒤 batch 전송한다. 웹 Socket.IO와 2137 HTTP 대신 IPC를 쓴다.
- **산출물:** WF-025~028, WF-044; TikTok ID·수집 토글·재연결·알림·기록·검색·CSV/TXT.
- **검증/gate:** 중복 replay/순서 뒤바뀜/잠시 끊김/방송 종료/잘못된 ID/회차 전환/worker crash를 시험한다. DB ACK된 수만 동기화 성공으로 표시한다. worker를 두 번 시작해도 중복 수집이 되지 않는다. 별도 댓글 도우미 설치 없이 동작한다.
- **실패 복구:** 대기열을 유지하고 제한된 backoff로 재연결한다. 디스크 부족이면 수집중 표시만 유지하지 말고 저장 불가와 영향을 즉시 안내한다.

### P06 — 오디오·STT·캡처 실기기 검증

- **선행:** P01~03, P05의 회차 경계; P04 수동 판매는 독립적으로 사용 가능해야 함.
- **파일:** `apps/desktop/main/media/audioController.ts`, `apps/desktop/main/media/captureController.ts`, `packages/stt/`, `packages/contracts/ipc/media.ts`, `apps/desktop/renderer/features/live/`, `apps/desktop/renderer/features/engines/`.
- **작업:** 마이크와 방송소리 adapter를 분리한다. Electron capture와 Windows WASAPI loopback 방식 중 실제 타깃 OS/브라우저/드라이버에서 검증한 경로를 선택한다. Python/Vulkan은 전용 worker와 모델 manifest로 실행한다. PCM→STT→interim/final→자막의 ID/generation 경계를 구현한다.
- **산출물:** WF-009~015, WF-047; 모델 다운로드/검증/취소/변경, 권한 복구, 파형, 무음 안내.
- **검증/gate:** 마이크·Chrome/Edge 방송 오디오·헤드셋·장치 교체·독점모드 충돌·다중모니터/DPI·오디오 무음·GPU 실패/CPU fallback 시험. 탭 단독 캡처가 되지 않는 경우 시스템소리 범위를 정확히 안내하고 지원했다고 표기하지 않는다. 오프라인 엔진은 인터넷을 끈 상태에서 전사한다.
- **실패 복구:** 입력 권한 거절은 재선택, engine crash는 현재 generation 폐기 후 재시작. 누락 음성을 자동으로 추정해 판매 생성하지 않는다. 중지 이후 늦게 도착한 final을 무시한다.

### P07 — 음성 명령·판매·보류·정정·AI

- **선행:** P04~06.
- **파일:** `packages/domain/recognition/`, `packages/domain/nickname/`, `packages/domain/pending/`, `packages/domain/corrections/`, `apps/desktop/main/commands/voiceCommands.ts`, `apps/desktop/main/ai/taskRunner.ts`, `apps/desktop/renderer/features/review/`.
- **작업:** 기존 파서·매칭·규칙·정정의 순수 함수를 이전한다. 음성 SaleRecord 경로는 adapter로 읽되 새 쓰기는 공통 command 파이프라인으로 단계적으로 옮긴다. 규칙 우선→AI 보완→근거 검증→변경 이력 순서를 구현한다.
- **산출물:** WF-016~019, WF-031~035, WF-049, WF-063~064의 소비 경로.
- **검증/gate:** 음성 정확도만 확인하지 말고 오판매율을 측정한다. 부정/질문/복수 후보/다른 회차 댓글/소수 가격/후속 발화/정정 대상 불명확을 검증한다. AI가 임의 buyerId를 반환하면 거절한다. 보류근거와 정정 이력은 다른 PC에서 동일하게 보인다.
- **실패 복구:** AI 장애와 근거 부족을 구분하고 전자는 설정된 fallback만 사용한다. 후자는 보류를 유지한다. 인쇄/입금/배송 이후 rollback에는 명시적 업무 검토를 요구한다.

### P08 — 출력·트레이·자동 실행·진단

- **선행:** P03~04, P05의 통합 main 수명주기.
- **파일:** `apps/desktop/main/printing/printController.ts`, `apps/desktop/main/printing/printQueue.ts`, `apps/desktop/main/lifecycle/`, `apps/desktop/main/diagnostics/`, `apps/desktop/renderer/features/devices/`, `apps/desktop/renderer/features/printQueue/`.
- **작업:** 기존 직접 인쇄와 클라우드 print worker를 하나의 consumer에 연결한다. 프린터별 용지 설정은 `LABEL_50_30`, `RECEIPT_80`, `RECEIPT_58`, `A4` 네 종류를 보존한다. job의 saleId/revision/jobId를 저장하고 트레이·시작 옵션·engine restart를 통합한다.
- **산출물:** WF-043~048; 출력 이력, 재출력 사유, worker 상태, 안전한 진단 번들.
- **검증/gate:** 용지 4종 미리보기와 지원 프린터 실출력; 긴 한글/닉네임/큰금액; 프린터 제거/오프라인/취소/ACK 분실. 창 닫기→트레이 유지와 완전 종료를 각각 시험. cloud job이 앱 시작 후 실제 처리된다.
- **실패 복구:** 로컬 journal에 제출 성공이 확정되어 있고 서버 ACK만 유실되면 ACK만 재시도한다. 제출 여부 자체를 알 수 없을 때는 `UNKNOWN / 출력 확인 필요`로 보존하며 자동 재출력하지 않는다. 서명 업데이트는 청취/출력/DB 작업 중 설치하지 않는다. `spool 접수`를 `종이 출력 완료`라고 쓰지 않는다.

### P09 — Android 연결·문자·고객·정산·배송

- **선행:** P04, P08의 출력 기기 정책, Android 개발 환경.
- **파일:** `apps/desktop/main/commerce/`, `apps/desktop/main/devices/`, `apps/desktop/renderer/features/customers/`, `apps/desktop/renderer/features/invoices/`, `apps/desktop/renderer/features/shipments/`, `apps/desktop/renderer/features/settlement/`, companion의 필요한 repository 전환 수정.
- **작업:** pairing→기기 capability→실제 repository, 문자 수신/첨부/대조, 문의/정산/배송 발송 큐, 입금 자료, 고객 통계를 연결한다. Windows에서 통신 SIM 직접 발송을 가정하지 않는다.
- **산출물:** WF-036~043; 백그라운드 동기화 상태와 발송 결과 의미 문서.
- **검증/gate:** 시험 휴대폰과 허용된 시험 번호에서 SMS/MMS·재부팅·오프라인 복구·동일 메시지 재수신·첨부 만료를 확인한다. 보류 제외, 부분/초과 입금, 취소 후 정산, 배송 재발송을 검증한다. 실제 고객에게 시험 문자를 보내지 않는다.
- **실패 복구:** 휴대폰 미연결은 발송 대기이며 완료가 아니다. 응답 불명확 작업의 동일 ID 상태를 먼저 조회한다. 텍스트 추정만으로 자동 입금확정·배송을 하지 않는다.

### P10 — 관리자·권한·실제 집계

- **선행:** P02~04, P07, P09.
- **파일:** `apps/desktop/renderer/features/admin/`, `apps/desktop/main/admin/`, 관리자 전용 Edge API·audit·report/metrics schema.
- **작업:** 회원 정지/해제·STT 사용권, 전체 판매·회원 사용시간, 제공자 키 저장, AI 저장/적용/진단, 신고 상태, 시스템 로그와 KPI를 연결한다. 현재 코드의 상수 및 목록+상수 계산을 실제 집계로 대체한다.
- **산출물:** WF-058~064; 정의된 지표 계산식·집계 시각·데이터 출처·관리자 변경 이력.
- **검증/gate:** 판매자 토큰으로 관리자 IPC와 서버 action 직접 호출 모두 거절. 관리자 아닌 기기의 캐시에 타 workspace 개인정보가 남지 않는다. 집계실패를 매출 0원으로 표시하지 않는다. 동일 fixture에 대한 SQL 합계와 UI가 일치한다.
- **실패 복구:** 서버에서 저장 거절하면 로컬 토글을 원복한다. 모의 health 응답을 실제 모델 가동 상태로 사용할 수 없다.

### P11 — 판매용 계정·구독·알림·음성 연습

- **선행:** P02~03, P06, 외부 결제/이메일 계약.
- **파일:** `apps/desktop/renderer/features/billing/`, `apps/desktop/main/billing/`, `apps/desktop/renderer/features/training/`, `apps/desktop/main/notifications/`, `apps/desktop/main/account/`, 결제 webhook/entitlement API.
- **작업:** PG hosted checkout와 서버 승인 webhook을 구현한다. 7일 체험/갱신/해지 예약/결제이력/환불을 서버로 관리한다. email 토글은 실제 서버 이벤트로 연결한다. 음성훈련 시뮬레이션은 시연으로 유지하고 운영 UI는 실제 녹음/전사 비교/사전 보정으로 구현한다. 삭제 접수·진행·완료 API를 연결한다.
- **산출물:** WF-050~055 및 WF-005 운영화 완료. 카드 입력 화면은 PG 소유이며 앱은 결제 ID·상태·승인된 표시용 결제수단만 취급한다.
- **검증/gate:** PG sandbox 성공/취소/실패·웹훅 중복/순서역전·환불·기간 만료; 서버 허위 플랜 요청 거절. 훈련 화면 정확도는 실제 정답 corpus로 계산되며 가짜 수치 증가는 시연만 가능. 계정 삭제는 실제 서버 상태를 재조회한다.
- **실패 복구:** 브라우저 결제 완료 화면만으로 플랜 상승 금지. webhook 지연은 `확인 중`이며 결제 조회로 복구한다. 신규 실결제/실삭제는 정해진 인수 계정·권한 절차에서만 수행한다.

### P12 — 설정·데이터 이전·새 PC 복원

- **선행:** P03~11, 아래 5장의 데이터 이전 명세.
- **파일:** `apps/desktop/main/migration/legacyImporter.ts`, `apps/desktop/main/backup/`, `apps/desktop/renderer/features/dataManagement/`, `tests/fixtures/migration/`.
- **작업:** JSON legacy export를 명시적으로 받아 구조·버전·workspace를 검사한다. 기존 브라우저 저장소/프로필을 몰래 읽지 않는다. 클라우드 자료와 로컬 자료 출처를 구분하고 dry-run 후 import한다. 프린터·오디오 장치는 다시 선택한다.
- **산출물:** WF-056, WF-065; 이행 manifest·검증 결과·복원 rollback 경로; 새 PC 첫 로그인 안내.
- **검증/gate:** 손상 JSON·중복 ID·다른 workspace·누락 필드·앞자리 0·한글·대용량 이미지·CVC 필드가 있는 legacy 파일을 처리한다. 비밀 자격증명/카드자료는 import하지 않는다. 이전 전후 건수·합계·상태별 수·첨부 hash를 비교한다.
- **실패 복구:** dry-run은 쓰기 0건; import 실패는 transaction rollback 또는 migration batch별 보상. 원본 export를 삭제하지 않는다. 누락된 근거 필드를 새로 만들어 역사적 사실처럼 채우지 않는다.

### P13 — 전체 기능·성능·시각 품질·패키지 출시 검증

- **선행:** P00~12의 필수 gate 모두 통과.
- **파일:** `docs/acceptance/results/`, `docs/acceptance/release-decision.md`, installer/update 설정, CI workflow.
- **작업:** 41 route·67 WF의 전수 결과를 묶고, clean Windows 설치→로그인→시험 한 회차→업데이트→복원→삭제를 수행한다. 코드 서명·업데이트 서명/무결성·SBOM/라이선스·모델 manifest를 검증한다. 사용 설명서에 판매자용 설치/복구 절차만 제공한다.
- **산출물:** 서명된 후보 설치 파일, 측정 결과, 알려진 제한, WF별 증거, rollback 가능한 이전 버전, 시험 완료 보고서.
- **검증/gate:** 6장의 G01~G10 모두 통과. 실사용 기능을 시뮬레이션으로 대신하거나 필수 WF를 삭제해 통과할 수 없다.
- **실패 복구:** 손상 업데이트/이전 schema와 불호환 업데이트는 안전하게 거절한다. 데이터 rollback 가능 여부를 확인하지 않고 구버전 바이너리만 덮어쓰지 않는다.

## 3. 의미 있는 테스트 명세

테스트는 구현 한 줄을 복제하지 않고 **사용자에게 중요한 결과·경계·재시작 이후 상태**를 검증한다. 작은 스타일 수정마다 새 단위테스트를 만들 필요는 없다. 금전·권한·중복·정정·데이터 손실처럼 위험한 경로에 자동 검증을 집중한다.

| 시험 ID | 입력·행동 | 기대 결과 | 대상 WF |
|---|---|---|---|
| T01 | 41 route를 비로그인/판매자/관리자로 직접 열기 | 공개/보호/관리 경계, 별칭, unknown redirect, query 유지 | 001~007,067 |
| T02 | 세션 만료→갱신 실패→재로그인, 동시에 worker 이벤트 도착 | 재인증 전 쓰기 차단; 이전 세션 이벤트는 폐기 | 003,008,025,066 |
| T03 | 잘못된/만료된 OTP·복구 링크·state와 사용한 링크 | 허위 성공 없음, 실제 비밀번호 변경 후 새 로그인 | 004,005 |
| T04 | A계정에서 B workspace/sale/image/admin action 요청 | IPC·서버·RLS·Storage 각 경계에서 거절 | 030,043,058~066 |
| T05 | 같은 operationId commit 3회, 첫 응답 유실 | 판매/통계/print job 각 1회 생성, 결과 조회 복원 | 019,022,024,046 |
| T06 | 두 기기가 같은 revision으로 상품/판매 변경 | 둘 중 오래된 요청은 충돌; 최신값 비교 표시 | 020,023,030 |
| T07 | 회차 A/B에 `0007`, 0원/미입력/소수발화 가격 | 번호 문자열과 회차 범위 보존, 허용 정책 일치 | 008,016,020,041 |
| T08 | 사진 권한 거절·upload만 성공·draft 만료·commit 실패 | fallback 확인·orphan 정리·재시도 상태, 가짜 상품확정 없음 | 015,020,023 |
| T09 | 1만 댓글에 중복 10%, 순서 역전, worker crash 후 replay | 원문 ID 기준 중복 제거, ACK cursor 복원, 데이터 손실 탐지 | 025,027 |
| T10 | 댓글 수집 중 회차 전환·로그아웃·동일 collector 두 번 시작 | 이전 회차 유입 차단, 수집기 하나, 타 계정 데이터 없음 | 008,025,044 |
| T11 | 같은 닉네임이 과거 회차에만 존재·유사 닉네임 2명 | 현재 근거 부족으로 보류/후보 선택, 자동 오확정 없음 | 018,033 |
| T12 | 마이크/방송소리·장치 분리·무음·sleep/resume | 입력 표시 정확, 권한 복구/카운트다운 취소, stale final 차단 | 009,012,013,057 |
| T13 | 최종 자막 반복·interim수정·중지 뒤 늦은 final | 최종 문장당 판매 최대 1회, 중지 후 쓰기 0건 | 010~012,016~019 |
| T14 | GPU out-of-memory·Python/Vulkan crash·손상 모델 | 명시 fallback/복구, UI 반응 유지, 손상 모델 실행 거절 | 011,047 |
| T15 | 부정·질문·일반 판매 단어·0.9/구천원·불완전 발화 | 정상 변환은 기대금액, 불완전/부정은 오판매 없음 | 016,017,019 |
| T16 | 판매 저장 후 재시작·다른 PC 조회 | 캡처·근거·후보·상태·revision·history까지 같은 값 | 019,031~035,065 |
| T17 | 보류 3건 중 1건 필수값 없음, 전체 확정 | 유효 2건만 확정, 실패 1건과 이유 표시 | 032,033 |
| T18 | AI 오류/근거 부족/다른 buyerId/과거 session 응답 | 오류만 fallback, 임의ID 거절, 보류 유지·이력 기록 | 034,063,064 |
| T19 | 음성 정정→rollback→출력/입금/배송 이후 rollback | 원 판매ID 보존, revision 상승, 위험 변경 검토·이력 | 035,039,040,046 |
| T20 | 모든 판매 필터/그룹/정렬→상세→캡처→뒤로 | 동일 회차·선택·정렬 복원, CSV합과 UI합 일치 | 029~031,041 |
| T21 | 댓글 5천건 초과 자료 검색/CSV/TXT export·필터 삭제 | 전체 페이지/범위 표시, 출력건수와 삭제범위 정확 | 027,028 |
| T22 | 프린터 offline/교체/용지4종/긴한글/ACK분실 | 실패/불명확 구분, 자동 중복출력 없음, 재출력 사유 | 043,045,046 |
| T23 | 앱 창닫기→트레이, 전체종료, 앱중복실행 | 프로세스 수명주기 일관, 수집/인쇄 중복 없음 | 044,048 |
| T24 | pairing 만료/재사용/Android연결 직후 판매조회 | 무효 코드 거절, Fake가 아닌 실제 workspace repository | 042,043 |
| T25 | 업무 SMS/MMS·일반 문자·동일수신·첨부만료 | 범위 필터, 중복방지, private첨부 복구, 대조 출처 | 036,039,065 |
| T26 | 동일 발송 요청 재시도·휴대폰 off·응답분실 | 요청ID 재사용, 요청/전송 상태 분리, 맹목 재발송 없음 | 036,038,040 |
| T27 | 보류·취소·부분/초과입금·정정·배송 완료 자료 | 합계/정산/고객통계/청구 상태 정책 일치 | 037~041 |
| T28 | 관리자 아닌 계정에서 키설정/정지/AI직접호출 | 권한 거절·감사로그; 원키 조회/로그 노출 없음 | 058,060,063 |
| T29 | 관리자 KPI 집계실패·0건·신고 처리 실패 | 실패/0/미수집 구분, 로컬 성공 선반영 원복 | 058~062 |
| T30 | PG sandbox 결제 취소/실패/중복 webhook/환불 | 서버 상태 기준 entitlement, 카드/CVC 잔존 0건 | 051~053 |
| T31 | 훈련 3회 버튼 클릭 vs 실제 녹음/정답 비교 | 시연지표와 실측을 분리, 클릭만으로 실측 정확도 증가 없음 | 050 |
| T32 | 알림/소리/이메일 토글·집중지원·권한거절 | 설정별 실제 전달 또는 명시된 미전달 상태 | 026,054,057 |
| T33 | 실제 탈퇴 요청·서버실패·재로그인/복구 | 요청 접수/진행/완료 구분, 실제 철회 이후 접근 거절 | 055,066 |
| T34 | legacy 백업 dry-run·중복 import·손상·다른 workspace | 미리보기 쓰기0, 중복0, 검증오류 명확, rollback | 056,065 |
| T35 | 시연 시작/종료·시연에서 결제/문자/인쇄 | 실제 환경 side effect 0건, 배너와 종료 후 원상복구 | 014,050~053 |
| T36 | 버전 update 중 청취/프린트·손상패키지·전원중단 | 작업중 설치 연기, 무결성거절, 재시작/DB 복구 | 048,065 |
| T37 | 8시간 시험 라이브·10만건 cache·정기메모리 측정 | 아래 성능 목표, 큐수렴·재연결·메모리증가 감시 | 008~048,065 |
| T38 | 100/125/150/200%DPI·키보드·Narrator·고대비 | 핵심 작업 접근, 텍스트/표 잘림 없음, focus 복원 | 전체 화면 |

기존 자동 테스트는 [루트 test](../test), [서버 test](../server/test), [PC UI/print test](../desktop/comment-helper/ui), [계약](../contracts/product-sales/v1)에서 순수 규칙과 fixture를 선별 재사용한다. 기존 테스트 개수 261개를 새 앱의 목표 점수로 삼지 않는다. 실제 소비되지 않는 코드의 테스트가 통과해도 새로운 IPC/queue/data 경로는 별도로 검증해야 한다.

## 4. 성능·안정성 목표와 측정 방법

**아래 수치는 모두 측정 전의 설계 목표다. 달성했다고 주장하지 않는다.** 출하 전 기준 PC를 기록하고 결과에 따라 모델 기본값·지원 하드웨어·제품 표시를 조정한다. STT·TikTok·클라우드 속도는 네트워크/모델/장치 차이가 크므로 UI 성능과 분리 보고한다.

기준 시험군: Windows 11 x64, 4코어 이상 CPU, RAM 16GB, NVMe SSD, 내장 GPU, 1920×1080/150% DPI. 추가군은 8GB 저사양·외장 GPU·4K/200% DPI·서로 다른 오디오/프린터 드라이버다. 정확한 OS build·CPU·RAM·SSD·GPU·드라이버·앱 버전·모델 hash를 결과에 적는다.

| 지표 | 측정 전 목표 | 측정 방법·조건 | 실패 시 조치 |
|---|---|---|---|
| 첫 창 반응 | cold start p95 5초 이내 | 재부팅 후 20회, 모델 다운로드/첫 모델 load 제외 | shell과 worker lazy init 분리 |
| 기존 화면 재진입 | p95 200ms 이내 | 로컬 캐시 있는 라이브↔판매 100회 | route분할·불필요 provider재렌더 제거 |
| 버튼/키입력 반응 | p95 100ms 이내 | 1만 댓글/판매 표시 중 사용자 입력 200회 | worker 분리·렌더 batching |
| 댓글 화면 지연 | 로컬 수신→표시 p95 250ms 이내 | 50개/초 10분; burst 200개/초 30초 | 배치 IPC·가상화·backpressure |
| 목록 탐색 | 10만건 캐시에서 화면 100행 검색 p95 500ms 이내 | SQLite index 적용, 전체 renderer 로드 금지 | 서버 pagination/FTS index 검토 |
| 판매 로컬 접수 | durable enqueue p95 150ms 이내 | operation write commit 완료까지 | DB transaction 크기/디스크 점검 |
| 판매 원격 반영 | 정상 네트워크 p95 2초 목표 | 100건 순차·동시5건, 외부 왕복 별도 기록 | 느린 서버/재시도 원인 분리 |
| 오프라인 STT | RTF 1.0 이하인 지원 기본모델 확보 목표 | 정답 오디오 30분, 처리시간/오디오길이, CPU/GPU별 측정 | 작은모델 권장·지원 제한 표시 |
| 최종 전사 지연 | 발화종료→final p95 2.5초 목표 | 고정 corpus와 배경음3종, engine별 보고 | VAD/segment길이 조정, 정확도 재시험 |
| 기본 메모리 | STT model 제외 private working set 500MB 이하 목표 | idle 10분, main/renderer/worker 합산 | 이미지/리스트 cache·구독 정리 |
| 장시간 메모리 | steady state 대비 8시간 후 +100MB 이하 목표 | 동일 유입 fixture, GC후 비교·모델 메모리 별도 | leak·event listener·배열 무한증가 제거 |
| 오프라인 큐 복구 | 1만댓글+100판매 대기열을 정상망 복귀 5분 내 수렴 목표 | 기존 operation 유지·재시작 포함 | batch/제한/backoff 조정, 순서 검증 |
| 안정성 | 8시간 강제오류 시험에서 데이터 손실·중복확정 0건 | queue/서버/출력 작업ID 대조 | 성능보다 정합성 우선, 출시 차단 |

STT 품질은 CER/WER 같은 전사 지표와 **판매 이벤트 precision/recall**, 잘못된 구매자 확정 수, 가격 오류 수를 함께 보고한다. 실제 학습/튜닝이 없는 상황에서 “99% 정확도”를 영업 문구로 사용하지 않는다. 금액·구매자가 애매하면 보류하는 정책의 효과를 별도로 측정한다.

## 5. 기존 웹/도우미에서 새 Windows 앱으로 데이터 이전

### 5.1 자료별 이전 규칙

| 자료 | 원본 | 가져올 내용 | 가져오지 않을 내용 | 검증·복구 |
|---|---|---|---|---|
| 계정 | Supabase Auth | 사용자 재로그인→같은 workspace | Base64 이메일/비밀번호, 원 refresh token 복사 | 권한/계정 확인, 새 기기 세션 |
| 판매·상품·회차·댓글 | Supabase | 원 ID·회차·상태·revision·근거·참조 | legacy 로컬 판매를 최신 원본이라고 덮어쓰기 | 상태별건수/회차합계/정정이력 비교 |
| 캡처·상품사진·MMS | private Storage | object key·mime·hash·엔티티 참조 | 만료 signed URL을 영구 식별자로 저장 | 권한별 재발급·누락 객체 보고 |
| 인식/훈련/캡처 규칙 | workspace settings+legacy JSON | namespace별 명시값·version | 빈 초기값으로 원격 값 덮어쓰기 | preview diff 후 import, 원본 snapshot |
| UI/음성 입력 | localStorage/도우미 설정 | 안전한 선호값·선택했던 장치 표시명 | 새 PC에서 유효하지 않은 장치 ID 강제 활성 | 사용자가 장치 재선택, fallback 안내 |
| 출력 설정/기록 | 기존 도우미 설정·print store | 용지·명시 설정; 이력은 provenance와 함께 | 완료 여부 불명확 job 자동 재출력 | 실제 프린터 재선택, history를 새 job으로 소비 금지 |
| 미전송 작업 | 새 앱 outbox / 명시적 이행자료 | workspace와 operationId가 확인된 작업 | 다른 기기/계정으로 유출될 토큰 | 서버 상태 조회→이미 완료면 ack, 나머지만 재전송 |
| 결제·구독 | 현재 로컬 시뮬레이션 | 과거 시연 이력은 `시연` 표시 | raw카드/CVC/생년월일, 시뮬레이션을 실제 청구로 변환 | 실제 PG 이력/entitlement는 서버에서 새로 조회 |
| STT 모델·비밀키 | 모델 cache·서버 설정 | hash 검증 모델 또는 재다운로드 | 배포용 exe 안에 기존 공유 비밀키 복사 | 모델 manifest·서버 vault 재설정 |

### 5.2 dry-run부터 전환까지

1. **대상 고정:** 동일 클라우드에 새 앱을 붙이는지, 독립 Supabase까지 이전하는지 기록한다. 후자는 DB/Auth/Storage 이전을 별도 운영 작업으로 취급한다.
2. **기준 snapshot:** export 버전·출처 workspace·추출시각·테이블별 수·상태별 수·합계·파일 hash를 manifest로 만든다. 시크릿과 고객 원문이 인수 보고서에 포함되지 않게 한다.
3. **dry-run:** 실제 쓰기 없이 스키마·ID·회차·중복·누락·잘못된 가격·카드/CVC 필드를 검출한다. 보존/변환/제외/수동검토 수를 표시한다.
4. **적용:** `migrationBatchId`를 발급하고 범위 확인 후 적용한다. 안전한 설정/자료만 가져온다. 원격에 이미 있는 판매는 revision/원본 해시를 대조하고 단순 덮어쓰기를 금지한다.
5. **대조:** 판매 총액, 회차별 금액, 확정/보류/취소 수, 고객 연결, 정산/배송 수, 첨부 hash, pending operation 수를 대조한다. 옛 코드가 저장하지 않은 증거는 `원본 미보존`으로 표시한다.
6. **전환:** 한 PC에서 기존 helper와 새 collector를 동시에 켜지 않는다. 기존 수집/출력을 종료하고 새 앱의 회차/출력 기기 lease를 확인한다.
7. **실패 시:** 새 작업을 중지하고 migration batch와 DB snapshot을 기준으로 되돌린다. 이후 생성한 정상 업무까지 무조건 삭제하지 않는다. 구버전이 새 schema를 읽을 수 없다면 읽기전용 export와 정방향 복구를 선택한다.

## 6. 출시 gate: 모두 통과해야 완료

| Gate | 통과에 필요한 증거 | 이번 설계 시점 상태 |
|---|---|---|
| G01 기능 완전성 | 41 route·WF-001~067 전수 PASS 또는 사용자 승인된 제품범위 변경 기록; 필수 누락 0 | 개발 전, 미수행 |
| G02 데이터 정합성 | 두 판매 경로·operation/revision·meta 왕복·회차 합계·중복0 | 개발 전, 미수행 |
| G03 통합 도우미 | 별도 helper 없이 수집·STT·인쇄·트레이·자동실행·진단, 공개 2137 의존0 | 개발 전, 미수행 |
| G04 운영화 | 결제·복구·탈퇴·알림·훈련지표·신고·KPI가 실제 상태 사용; 데모 분리 | 개발 전, 미수행 |
| G05 권한·자격증명 | cross-workspace/role/IPC/RLS/Storage 실패 테스트, secret/card 잔존0 | 개발 전, 미수행 |
| G06 실기기 | 오디오/모델/GPU/CPU/캡처/DPI/프린터/Android/SMS/MMS 지원 조합별 기록 | 개발 전, 미수행 |
| G07 장애·복구 | crash/네트워크/디스크부족/ACK분실/계정변경/업데이트/이전 복구 기록 | 개발 전, 미수행 |
| G08 시각·접근성 | 모든 화면의 loading/empty/error/success, 키보드/Narrator/고대비/DPI 점검 | 개발 전, 미수행 |
| G09 성능·안정성 | 기준PC 수치·8시간 soak·메모리·큐수렴·STT품질 측정, 미달시 해결/지원범위 재승인 | 개발 전, 미수행 |
| G10 설치·상업출시 | clean PC 설치·서명·업데이트 무결성·복원·모델/의존라이선스·판매자 설명서 | 개발 전, 미수행 |

공통 행 상태는 `NOT_STARTED → IMPLEMENTING → READY_FOR_TEST → PASS`로 사용한다. 실패는 `FAIL`, 외부 조건 미확보는 `BLOCKED`와 이유를 적는다. `시연 통과`는 별도 필드이며 `PASS`를 대신하지 않는다. scope를 바꾸면 변경 날짜·사유·사용자 합의·영향 WF를 문서에 남겨 “모든 기능”의 뜻이 사라지지 않게 한다.

### 기능 인수 한 행의 작성 예시

```json
{
  "featureId": "WF-046",
  "source": "server/cloudPrintWorker.js",
  "target": "apps/desktop/main/printing/printQueue.ts",
  "status": "NOT_STARTED",
  "requiredTests": ["T05", "T19", "T22", "T23", "T36"],
  "evidence": "미수행: 신규 Windows 앱 구현 전",
  "realDeviceResult": "미수행: 지원 프린터 시험 필요",
  "blockingReason": "구현 및 실제 출력 검증 필요",
  "reviewDecision": "출시 승인 전"
}
```

## 7. 테스트가 사용자의 실제 환경을 바꾸지 않게 하기

기존 [STT 테스트](../server/test/sttBridge.test.js)는 설정 저장을 포함할 수 있다. 새 테스트 runner는 테스트 시작 전에 별도 `userData`, `APPDATA`, `LOCALAPPDATA`, SQLite 경로, 로그 경로를 강제한다. 지정이 없으면 로컬 저장 테스트를 실패시키는 guard를 둔다. 실프린터·실SMS·실PG 호출은 기본 test에서 금지하고 이름이 분리된 실기기 인수 작업에서만 허용한다.

새 runner를 구현할 때 지킬 절차:

1. 임시 시험 디렉터리의 **해석된 절대 경로**가 `voicecap-studio/test-output/` 아래인지 검사한다.
2. `app.setPath('userData', 시험경로)`는 Electron ready 이전에 적용한다. worker에도 같은 시험 namespace를 명시한다.
3. 테스트는 Fake API·Fake spooler·Fake Android bridge를 기본으로 주입한다. 엔진을 실제 실행하는 시험은 사용 모델/cache도 분리한다.
4. 테스트 종료 시 queue·worker·DB handle을 닫고 결과를 저장한다. 삭제가 필요하면 확인한 시험 디렉터리만 정리한다.
5. 실기기 test에는 대상 프린터/시험전화/PG sandbox 여부를 실행 전에 표시한다. 환경변수가 비어 있으면 운영 기본값으로 fallback하지 않는다.

이 설계 문서 작성 중에는 위 테스트를 실행하지 않았다. 신규 프로젝트의 설치·실행·검증 명령은 개발 환경 문서에서 **실제로 생성된 scripts**와 일치시키고, 아직 존재하지 않는 명령은 계획으로 표시한다.

## 8. 완료 보고서에 반드시 남길 것

최종 보고서는 “테스트 통과” 한 줄 대신 앱 버전/소스 SHA, 테스트 환경, PASS/FAIL/미수행 WF 개수, 실제 시험한 장치 조합, 성능 실측값, 데이터 이전 검증 범위, 모의 기능 잔존 여부, 업데이트/복원 결과를 포함한다. 고객 정보·비밀키는 포함하지 않는다. **UI가 아름다운 것, 기능을 이전한 것, 실서비스 출시가 가능한 것은 서로 다른 검증 결과이며 세 가지 모두 충족해야 이 프로젝트의 사용자 요청이 개발 단계에서 완성된다.**

## 9. 67개 기능의 작업·검증 개별 대응표

이 표는 개발용 추적 시트의 초기값이다. 모든 행의 현재 상태는 **개발 전 / 시험 미수행**이며, 테스트 번호에 나열되지 않은 각 기능의 세부 완료 기준도 01장에서 함께 검사한다. T38의 화면 품질 검사는 UI가 있는 모든 행에 공통 적용한다.

| 기능 ID | 주 구현 단계 | 필수 시험 | 추가 확인할 산출물 |
|---|---|---|---|
| WF-001 | P01,P02 | T01,T02 | 경로별 권한·redirect 결과 |
| WF-002 | P01 | T01,T38 | 첫 실행 안내와 시작 동선 |
| WF-003 | P02 | T01,T02,T04 | 안전한 자동 로그인·세션 복원 |
| WF-004 | P02 | T03,T04 | 가입·OTP·온보딩 결과 |
| WF-005 | P02,P11 | T03 | 실제 비밀번호 변경 후 로그인 |
| WF-006 | P01,P11 | T01,T30 | 공개 가격과 서버 카탈로그 일치 |
| WF-007 | P01,P13 | T01,T38 | 현재 기능과 일치하는 정책 버전 |
| WF-008 | P04,P06 | T07,T10,T12,T37 | 회차와 청취 분리 상태 |
| WF-009 | P06 | T12,T37 | 지원 오디오 입력 실기기 목록 |
| WF-010 | P06 | T13,T37 | 실제 클라우드 STT·사용량 |
| WF-011 | P06 | T14,T37 | 오프라인 STT·모델 manifest |
| WF-012 | P06 | T12,T13 | interim/final·generation 로그 |
| WF-013 | P06 | T12 | 무음 안내·중지 취소 결과 |
| WF-014 | P01,P11 | T35 | 시연 환경 격리·원상 복구 |
| WF-015 | P06 | T08,T12,T38 | DPI별 캡처 좌표·프리셋 |
| WF-016 | P07 | T07,T13,T15 | 파서 정답 fixture |
| WF-017 | P07 | T13,T15 | 후보 수정·취소·중복 방지 |
| WF-018 | P07 | T11,T18 | 현재 회차 구매자 근거 |
| WF-019 | P07 | T05,T15,T16 | legacy 음성 경로 데이터 왕복 |
| WF-020 | P04 | T06,T07,T08 | 상품 draft/이미지/commit |
| WF-021 | P04 | T06,T07 | 활성 상품·목록·회차 선택 |
| WF-022 | P04 | T05,T06 | 구매자 선택/해제·수량·확정 |
| WF-023 | P04 | T06,T08 | 변경 preview와 영향 합계 |
| WF-024 | P03,P04 | T05,T06,T36 | durable operation·복구 |
| WF-025 | P05 | T09,T10,T37 | 내장 수집기·publisher·ACK |
| WF-026 | P05,P11 | T10,T32 | 감지어·수집·소리 설정 |
| WF-027 | P05 | T09,T21 | 전체 댓글 검색·CSV/TXT |
| WF-028 | P05 | T04,T21 | 개별/선택/필터 삭제 범위 |
| WF-029 | P04 | T20,T27 | 그룹·개별·검색·정렬·CSV |
| WF-030 | P04,P07 | T04,T06,T16,T20 | 수정/삭제 권한·revision |
| WF-031 | P07 | T16,T20 | 여러 이미지·확대·다운로드 |
| WF-032 | P07 | T17 | 행 저장·삭제·일괄확정 결과 |
| WF-033 | P07 | T11,T16,T17 | 보류사유·규칙·후속 발화 |
| WF-034 | P07 | T16,T18 | 실제 AI task·근거·후보 적용 |
| WF-035 | P07 | T16,T19 | 정정·rollback·후속 업무 영향 |
| WF-036 | P09 | T25,T26 | 문자 대조·문의·MMS |
| WF-037 | P09 | T27 | 구매횟수·금액·미입금 배지 |
| WF-038 | P09 | T26,T27 | 정산서 생성/발송/취소 |
| WF-039 | P09 | T19,T25,T27 | 입금자료·부분/초과 대조 |
| WF-040 | P09 | T19,T26,T27 | 배송 단계·송장·발송 문자 |
| WF-041 | P09 | T07,T20,T27 | 일자/회차 합계·내보내기 |
| WF-042 | P09 | T24 | Android 코드 만료·연결 |
| WF-043 | P08,P09 | T04,T22,T24 | capability·출력 기기 전환 |
| WF-044 | P05,P08 | T10,T23 | 단일 설치·트레이·엔진 |
| WF-045 | P08 | T22 | 지원 프린터·용지 4종 |
| WF-046 | P08 | T05,T19,T22,T23,T36 | 인쇄 queue·불명확 상태·재출력 |
| WF-047 | P06,P08 | T14 | CPU/GPU 실제 backend·설정 |
| WF-048 | P08,P13 | T23,T36 | 자동시작·재시작·로그·업데이트 |
| WF-049 | P07,P12 | T15,T34 | 필수 규칙 보호·동기화 |
| WF-050 | P11 | T31,T35 | 연습/실측/시연 구분 |
| WF-051 | P11 | T30,T35 | 플랜·서버 시각 체험기간 |
| WF-052 | P11 | T30,T35 | PG sandbox·webhook·자료 최소화 |
| WF-053 | P11 | T30 | 구독 이력·해지·만료 |
| WF-054 | P11 | T32 | toast·소리·실제 이메일 전달 |
| WF-055 | P02,P11 | T02,T33 | 프로필·로그아웃·실제 탈퇴 상태 |
| WF-056 | P12 | T34 | legacy import·백업 범위 |
| WF-057 | P06,P11 | T12,T32,T38 | OS 권한 복구 |
| WF-058 | P10 | T04,T28,T29 | STT 제공자/키·실제 KPI |
| WF-059 | P10 | T04,T27,T29 | 전체 판매·STT 사용량 |
| WF-060 | P10 | T04,T28 | 회원 정지/해제·사용권·로그 |
| WF-061 | P10 | T29 | 실제 신고 상태·처리이력 |
| WF-062 | P10 | T29 | 통계 출처·시스템 로그 |
| WF-063 | P07,P10 | T18,T28 | AI 2슬롯·설정/적용 버전 |
| WF-064 | P07,P10 | T18,T28 | AI task 소비·health·모델목록 |
| WF-065 | P03,P12 | T04,T16,T25,T34,T36,T37 | broker/클라우드·이미지·복원 |
| WF-066 | P02 | T02,T04,T33 | main 인증·OS 자격증명 격리 |
| WF-067 | P01 | T01,T38 | 전체 shell·키보드·화면 상태 |


