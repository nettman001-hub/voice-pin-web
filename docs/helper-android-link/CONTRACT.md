# Windows 댓글도우미 → Android 판매 앱 댓글 연결: 계약과 구현 보고

계획서: `윈도우_댓글도우미_안드로이드_연결_개발계획서.md` (main 49f1614)

## 1. 구조

```
틱톡 라이브 → [Windows 트레이 도우미: 댓글 서버(utilityProcess) → 메인 프로세스 연결 관리자 + 디스크 대기열]
           → sales-api helper-push → helper_comment_feed (+ live_comments)
           → sales-api helper-pull (커서) → [Android 판매 앱: 댓글 목록 → 기존 판매확정·촬영·전표]
```

- 판매 실행권(`touch-run`)은 계속 폰이 갖는다. 도우미는 수집기 역할만 한다.
- 폰은 판매 시작 설정의 **댓글 받기**에서 `이 폰이 직접`(기존) 또는 `PC 댓글도우미`를 고른다. 출력 위치(전표)와 별개다.
- 도우미 모드에서는 폰의 직접 Euler 수신기를 함께 돌리지 않는다. 조용한 자동 전환도 없다.
- `TouchSettings.commentSource`(`PHONE_DIRECT` | `WINDOWS_HELPER`)만 설정에 남는다. 연결 토큰은 설정·실행 상태에 넣지 않는다.

## 2. 데이터 (마이그레이션 `supabase/migrations/202611030002_helper_android_link.sql`)

| 테이블 | 내용 |
| --- | --- |
| `devices` (기존) | 도우미는 `device_type='WINDOWS_HELPER'`, `capabilities={HELPER_COMMENTS}`, 토큰은 해시만 |
| `helper_registrations` | PC 등록 요청: 확인코드 해시, 비밀값 해시, 10분, 상태 PENDING→APPROVED→CONSUMED |
| `helper_delivery` | 도우미 1행: 켜짐, `state_version`, `generation`, 생존 기한(30초), 연결된 폰, 활성 회차·폰 producer, 수집 상태 |
| `helper_pair_codes` | 6자리 코드 해시, 3분, 1회 사용, 재발급 시 이전 코드 폐기 |
| `helper_phone_links` | 폰 연결: PENDING(코드 입력)→ACTIVE(PC 승인)→REVOKED. **도우미당 ACTIVE 1개를 부분 유일 인덱스로 보장** |
| `helper_pair_failures` | 틀린 코드 입력 기록(사용자 10회/10분, 작업공간 30회/10분) |
| `helper_comment_feed` | 폰이 읽는 댓글. `cursor`(identity) 단조 증가, `unique(session_id, platform_message_id)` |

모든 새 테이블은 RLS를 켜고 정책이 없다(클라이언트 직접 접근 불가). 함수는 `service_role`만 실행한다.
감사 기록은 `audit_logs`에 등록·승인·거절·해제·스위치 변경을 남긴다(코드·토큰 원문 없음).

### 세대(generation)와 회차
- 켜기(꺼짐→켜짐), 폰 승인·해제, 다른 회차 연결 때 `generation`이 오른다.
- 도우미는 댓글을 넣는 순간의 `sessionId`·`generation`을 붙여 디스크에 보관하고, 재시도에도 바꾸지 않는다.
- 서버는 현재 세대·활성 회차가 아니면 `STALE_GENERATION`·`SESSION_INACTIVE`·`HELPER_DISABLED`로 거절하고, 도우미는 그 항목을 "버림"으로 집계한다. → 꺼진 동안·이전 회차 댓글은 나중에 몰려 들어오지 않는다.
- 활성 회차 = 연결된 폰의 `touch_sales_runs`가 running·lease 유효·같은 producer·같은 session이고 `live_sessions.status='ACTIVE'`.

### 중복·순서
- 같은 회차의 같은 플랫폼 메시지 ID는 feed에 1건(수집기 ID가 바뀌어도). live_comments도 회차+메시지 ID로 먼저 찾아 재사용한다(기존 유일 제약은 건드리지 않음).
- push는 회차별 advisory lock으로 직렬화해서 cursor가 커밋 순서와 같다(늦게 커밋된 작은 cursor 누락 없음).
- 판매확정(`voicecap_commit_touch_sale`)은 같은 live_comments 행을 그대로 쓴다(시험으로 확인). 닉네임·uniqueId·실제 사용자 ID는 feed에 따로 보존한다.

### 2-1. 폰 판매 시작/종료가 켜짐/꺼짐을 바꾼다 (`202611030004_helper_phone_controls_delivery.sql`, 도우미 1.4.1)

- 연결된 폰에서 판매를 시작하면(`helper-attach` + `start:true`) 도우미 댓글 연결이 켜지고, 판매를 종료하면(`helper-detach`, 같은 producer일 때만) 꺼진다.
- 재연결·자동 재부착(`start` 없음)은 켜지 않는다. PC에서 끈 것을 되돌리지 않기 위해서다.
- `helper_delivery.enabled_version`이 켜짐/꺼짐이 바뀔 때마다 오르고 `enabled_by`(PHONE/HELPER)를 남긴다. 나중에 바뀐 쪽이 이긴다.
- 도우미 1.4.1은 heartbeat(10초)에서 `enabledVersion`이 바뀌면 서버 값을 따르고, PC에서 바꿨지만 아직 못 올린 값이 있으면 그것을 먼저 올린다. 1.4.0은 PC 값을 계속 서버에 올려 폰 종료를 되돌리므로 1.4.1로 바꿔야 한다.

## 3. API (`sales-api`, 모두 POST `{ action, ... }`)

| action | 인증 주체 | 입력 | 응답 data | 주요 오류 (재시도) |
| --- | --- | --- | --- | --- |
| `helper-register-begin` | 없음(비밀값) | `secret`(hrs_…), `helperName`, `appVersion` | `registrationId`, `code`(ABCD-EFGH), `expiresAt` | RATE_LIMITED(예) |
| `helper-register-poll` | 없음(비밀값) | `registrationId`, `secret` | `status` PENDING 또는 REGISTERED + `deviceToken`(1회만), `deviceId`, `workspaceName` | REGISTRATION_EXPIRED, REGISTRATION_NOT_FOUND |
| `helper-register-approve` | 로그인 OWNER·MANAGER·ADMIN | `code` | `helperName` | CODE_INVALID, RATE_LIMITED, CAPABILITY_DENIED |
| `helper-heartbeat` | 도우미 기기 | `state`(수집 상태) | `enabled`, `stateVersion`, `generation`, `sessionId`, `tiktokId`, `link`, `pendingRequests` | HELPER_NOT_FOUND |
| `helper-set-enabled` | 도우미 기기 | `enabled` | `enabled`, `generation` | |
| `helper-pair-issue` / `helper-pair-cancel` | 도우미 기기 | | `code`(6자리), `expiresAt` | RATE_LIMITED |
| `helper-pair-decide` | 도우미 기기 | `linkId`, `approve` | `status` | REQUEST_EXPIRED, REQUEST_CLOSED, PHONE_ALREADY_LINKED |
| `helper-unlink` | 도우미 기기 | `linkId` | `status` | |
| `helper-unregister` | 도우미 기기 | | | |
| `helper-push` | 도우미 기기 | `batchId`, `sessionId`, `generation`, `comments[1..200]` | `acked`(메시지 ID 목록), `inserted`, `duplicates` | STALE_GENERATION, SESSION_INACTIVE, HELPER_DISABLED(아니오, 버림) / 네트워크·5xx(예) |
| `helper-comment-key` | 도우미 기기 | | `apiKey`(메모리에만) | COMMENT_KEY_MISSING |
| `helper-pair-claim` | 로그인 판매자(폰) | `code`, `installId`, `phoneName` | `linkToken`(vcpl_…), `linkId`, `status=PENDING` | CODE_INVALID, RATE_LIMITED |
| `helper-phone-status` | 로그인 + `linkToken` | | `linkStatus`, `helperName`, `enabled`, `helperAlive`, `collector` | LINK_NOT_ACTIVE |
| `helper-attach` / `helper-detach` | 로그인 + `linkToken` | `sessionId`, `producerId`, `start`(판매 시작의 첫 연결이면 true) | `generation`, `enabled`, `enabledVersion` | RUN_NOT_ACTIVE(예), LINK_NOT_ACTIVE |
| `helper-pull` | 로그인 + `linkToken` | `sessionId`, `after`(null=최근 `tail`건부터), `limit`≤1000 | `comments[]`(cursor 순), `cursor`, `hasMore`, `enabled`, `helperAlive`, `sessionActive`, `collector` | LINK_NOT_ACTIVE |
| `helper-phone-unlink` | 로그인 + `linkToken` | | `status` | |

- 작업공간·도우미·회차는 토큰과 DB 상태로 정한다. 본문의 workspaceId·회차가 서버 상태와 다르면 댓글 본문을 주지 않는다.
- 도우미 기기 토큰은 위 도우미 액션만 쓸 수 있다(`index.ts`의 가드). 판매 수정·SMS·관리자 기능 불가.
- 폰 조회는 로그인 사용자 = 연결을 만든 사용자 + 작업공간 회원 + ACTIVE 연결 + 켜짐 + 활성 회차를 모두 요구한다.
- HTTP 성공이어도 본문 `ok:true`와 `acked`를 확인해야 성공이다(도우미 구현).

## 4. 도우미 (`desktop/comment-helper`, 1.4.0)

- `androidLink/linkManager.cjs`: 등록, 10초 생존 확인(승인 대기 중 2초), 스위치, 폰 승인·해제, 수집 요구, 전송(지수 지연 1~30초).
- `androidLink/outbox.cjs`: `userData/android-outbox.json`. 같은 배치 재시도는 같은 batchId·메시지 ID. 확인된 항목만 삭제. 한도 2만 건, 쓰기 실패·초과는 화면에 오류로 표시.
- 기기 토큰: `userData/android-link.json`에 Electron `safeStorage`(Windows DPAPI)로 암호화해 저장. 암호화를 못 쓰면 저장하지 않고 오류를 보인다.
- 댓글 서버(`server/index.js`): PC 웹 수요와 안드로이드 수요를 따로 관리. 브라우저가 0개여도 안드로이드 수요가 있으면 수집 유지. PC 웹이 다른 틱톡 계정을 요청하면 덮어쓰지 않고 이유를 알린다.
- 등록 화면 자동 입력: `GET http://127.0.0.1:2137/helper/registration`은 허용 Origin에서만 확인코드를 준다(Origin 없는 요청 거절).
- 화면: 설정 창의 "안드로이드 댓글 연결" 카드, 트레이 메뉴의 상태 줄과 켜기/끄기.
- 꺼짐 반영: 끄면 즉시 수집 요구 해제·대기열 비움, 서버 반영이 실패하면 "중지 반영 중"으로 1초마다 재시도. 서버 쪽은 생존 기한(30초)이 지나면 폰에 "PC 도우미 연결 끊김".

## 5. 폰 (`/sell`, 판매 앱 1.0.7)

- `HelperLinkPanel`: 인증번호 입력 → `helper-pair-claim` → PC 승인 대기(2초 확인) → 연결됨. 해제 버튼.
- 토큰: 판매 앱 1.0.7의 `HelperLinkVault`(Android Keystore AES-GCM). 브라우저·옛 앱은 탭 메모리에만(새로고침하면 다시 연결).
- `HelperCommentStream`: 판매 시작 후 `helper-attach`, 1.5초마다 `helper-pull`(hasMore면 바로 다음 페이지), 멈춤·회차 변경 뒤 늦은 응답 버림, 판매 멈춤 때 `helper-detach`(폰 승인 유지).
- 상태 줄: `PC 댓글 ● 받는 중 / 방송 시작 대기 / PC 도우미 연결 끊김 / 댓글 연결이 꺼져 있습니다` (댓글 없음과 끊김 구분).

## 6. 배포 순서와 원복

1. DB: `202611030002_helper_android_link.sql` 적용(추가 전용, 재실행 안전).
2. `sales-api` 배포(새 액션만 추가, 기존 액션 동작 동일. `touch-run` 설정에 `commentSource` 필드만 추가).
3. 도우미 1.4.0 빌드·GitHub 릴리스 업로드(`comment-helper-v1.4.0`). 웹의 다운로드 링크가 이 버전을 가리키므로 **릴리스를 먼저 올리고 웹을 합친다**.
4. 웹 배포(`/helper/register`, 폰 판매 설정의 댓글 받기 선택).
5. 판매 앱 1.0.7 빌드(토큰을 Keystore에 보관). 옛 앱도 웹 화면으로 쓸 수 있지만 토큰을 기억하지 못한다.

원복: 웹·도우미를 이전 버전으로 되돌리면 새 경로는 쓰이지 않는다. DB 원복 SQL은 마이그레이션 파일 끝 주석에 있다(기존 테이블은 건드리지 않음).

## 7. 판매자 사용법 (짧게)

1. **PC 등록(처음 한 번)**: 도우미 창 → 안드로이드 댓글 연결 → `판매자 계정 연결` → 열린 브라우저에서 로그인 → 확인코드가 도우미 화면과 같은지 보고 `이 PC 등록`.
2. **폰 연결(처음 한 번)**: 도우미에서 `폰 연결 인증번호 발급` → 폰 판매 앱 `폰으로 판매 시작` → 댓글 받기 `PC 댓글도우미` → 번호 입력 → `PC와 연결` → 도우미에서 `승인`.
3. **판매**: 도우미 스위치 켜기 → 폰에서 판매 시작(새 회차 또는 이어서). PC 홈페이지는 닫아도 된다.
4. **끄기/해제**: 도우미 스위치 끄기 = 전달만 멈춤. `폰 연결 해제` = 그 폰의 권한 폐기(다시 승인 필요).

## 8. 검증 결과

자동 시험(클라우드, 2026-11-03): `npm test` 1,544개 통과, 도우미 `npm test` 10개 통과, `tsc`·`vite build` 통과, 판매 앱 Java 컴파일(javac + android-all) 통과.

| 인수 기준 | 상태 | 근거 |
| --- | --- | --- |
| A1 등록·연결·지정 폰만 수신 | 자동 시험 통과 | `test/helper-android-link-migration.test.mjs`, `-api`, `-e2e` |
| A2 승인 전·거절 후 | 자동 시험 통과 | migration A2 |
| A3 만료·재사용·재발급·무차별 | 자동 시험 통과 | migration A3 |
| A4 다른 작업공간·회차 위조 | 자동 시험 통과 | migration A2/A4, api |
| A5 두 폰 동시 | 자동 시험 통과(순차 경쟁 + DB 유일 인덱스) | migration A5 |
| A6 켜기/끄기, 꺼진 동안 댓글 | 자동 시험 통과(3초 반영은 폰 1.5초 조회 기준, 실측 안 함) | migration A6, e2e 8 |
| A7 해제 후 예전 토큰 | 자동 시험 통과 | migration A2, api |
| A8 브라우저 0개에서 수집 유지 | 로컬 서버 단독 실행으로 확인(utilityProcess 흉내) | 수동 스모크 |
| A9 재시작·재부팅 | 저장값·디스크 대기열 복구 자동 시험 통과, 실제 재부팅 미검증 | e2e 7 |
| A10 와이파이/LTE 전환 | **미검증**(실기기 필요) | |
| A11 전송 경로 차단 | 자동 시험 통과(합성) | e2e 6 |
| A12 저장 후 응답 끊김 | 자동 시험 통과 | e2e 5, api |
| A13 지연 중 새 회차 | 자동 시험 통과 | migration A13, e2e 9 |
| A14 이어서 판매 | 같은 세대 유지 자동 시험 통과 | migration A13/A14 |
| A15 5,000건·같은 시각·페이지 | 자동 시험 통과 | migration A15 |
| A16 대기열 실패·상한 | 자동 시험 통과 | e2e outbox 시험 |
| A17 지연 95백분위 | **미측정** | |
| A18 장시간(60분 자동, 30분 실방송) | **미검증** | |
| A19 수집 정지와 연결 정상 구분 | 상태 구분 구현·시험(helperStatus) | stream 시험 |
| A20 서로 다른 네트워크 | **미검증**(실기기) | |
| A21 비밀 원문 | 감사 기록·DB에 원문 없음 자동 시험 | api 시험 |
| A22 설치 프로그램 | **미검증**(Windows 빌드 필요) | |

남은 일: 실제 PC 도우미 설치본과 실기기 폰으로 A8~A10, A17, A18, A20, A22 확인. QR 연결은 이번 범위에서 빼고 6자리 번호 입력만 제공한다(현재 앱에 QR 스캔이 없음).
