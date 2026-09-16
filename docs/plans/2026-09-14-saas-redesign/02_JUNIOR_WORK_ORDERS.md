# VoiceCAP 초보 개발자용 작업지시서

작성일: 2026-09-14 · 기준: [상세 재설계서](C:/dev/voice-pin-anti/docs/plans/2026-09-14-saas-redesign/01_REDESIGN.md)

이 문서는 앞으로 구현할 작업을 지시한다. 아래 프로젝트·클래스·시험 이름이 모두 이미 존재한다는 뜻이 아니다. 현재는 설계 문서만 작성된 상태다. 운영 DB 변경, 실제 고객 문자 발송, 앱 배포를 문서 작성 완료와 혼동하지 않는다.

## 1. 개발자가 먼저 이해할 것

### 1.1 만들 제품

판매자 A는 같은 계정으로 PC 두 대와 업무폰에 연결한다. PC 1은 방송을 듣고 판매를 기록한다. PC 2는 그 판매와 전체 멘트·댓글을 보면서 수정·정산·문자 업무를 한다. 업무폰은 PC가 요청한 문자를 실제로 보내고, 업무폰 자체에서도 고객 문자를 읽고 답장한다. 판매자 B의 자료는 A에게 절대 보이지 않아야 한다.

서버가 공유 업무의 최종 상태를 결정한다. PC SQLite와 Android Room은 ‘서버에 아직 못 보낸 것’과 ‘다시 실행하면 위험한 작업의 진행 상태’를 보관한다. SQLite 파일을 Supabase에 통째로 업로드하는 것이 동기화가 아니다.

### 1.2 용어 사전

| 용어 | 초보자용 뜻 | 이 프로젝트의 예 |
| --- | --- | --- |
| workspace / tenant | 판매자별로 분리한 업무 공간 | 판매자 A의 방송·주문·문자 |
| API | 앱이 서버에 요청하는 약속 | ‘이 고객에게 이 문자를 보내 달라’ |
| DTO / 계약 | 요청·응답에 들어갈 필드와 형식 | messageId, body, targetDeviceId |
| migration | 기존 자료를 유지하면서 DB 구조를 바꾸는 기록 | 기존 문자 표에 새 식별 정보 추가 |
| transaction | 여러 DB 변경을 전부 성공하거나 전부 취소 | 판매와 출력 대기 기록을 함께 생성 |
| idempotency / 중복 방지 | 같은 요청을 다시 받아도 효과는 한 번 | 응답을 못 받아 같은 주문 요청 재전송 |
| revision | 한 자료가 몇 번 변경됐는지 나타내는 버전 | A가 수정한 판매를 B의 옛 화면이 덮어쓰지 않음 |
| outbox | 아직 서버 확인을 못 받은 로컬 발신함 | 인터넷 끊긴 동안의 전체 전사 |
| journal | 외부 실행 직전·직후를 남기는 장부 | 실제 SMS 호출을 시작했는지 기록 |
| lease / epoch | 기간이 있는 독점 권한 / 그 권한의 세대 | 현재 방송 PC만 실시간 판매 생성 |
| cursor | 어디까지 동기화했는지 표시하는 서버 발급 책갈피 | 늦게 들어온 과거 댓글도 다음 조회에서 받음 |
| ACK | 해당 항목을 서버가 저장했다고 확인한 결과 | HTTP 성공과 항목 저장 성공을 구분 |
| RLS | DB에서 판매자별 접근을 제한하는 규칙 | A 토큰으로 B 판매 조회 금지 |
| mock / fake | 개발용 가짜 외부 기능 | 돈이 들지 않는 가짜 SMS 송신기 |
| 단위 시험 | 작은 규칙 하나 시험 | 같은 메시지 콜백을 두 번 처리 |
| 통합 시험 | 실제 DB·API를 함께 시험 | 동시 판매 요청의 원자성 |
| 실기기 시험 | 실제 OS·통신사·장치 시험 | 실제 한글 장문 문자 왕복 |

### 1.3 절대 생략하지 않을 규칙

1. 전체 확정 전사는 판매 필터보다 먼저 저장한다. 인사나 상품 설명도 저장한다.
2. 댓글 시간을 지어내지 않는다. 플랫폼 시간이 없으면 null과 수집 시각을 사용한다.
3. Soniox만 이번 필수 STT로 구현한다. Whisper·Qwen 모델을 다운로드하거나 실행하지 않는다.
4. 기존 Android applicationId·서명 체계·연결 설정을 보존한다. 기존 승인 앱의 업데이트다.
5. 네트워크가 실패해도 outbox를 삭제하지 않는다. 재시도마다 새 ID를 만들지 않는다.
6. `SmsManager` 호출 직후를 SENT로 표시하지 않는다. 전송 결과 콜백을 기다린다.
7. UNKNOWN인 문자·출력을 자동 재실행하지 않는다. 실제로 실행됐을 수 있다.
8. 토큰·service-role·Soniox 장기 키를 소스, 앱, 화면, 시험 보고서에 넣지 않는다.
9. 고객 데이터가 있는 DB를 초기화하거나 앱을 삭제해서 시험을 통과시키지 않는다.
10. 한 작업의 완료 조건을 통과한 후 다음 작업으로 넘어간다. ‘빌드 성공’은 ‘제품 완성’이 아니다.

## 2. 준비와 작업 운영

### 2.1 작업 환경

- Windows 개발 PC, .NET 10을 지원하는 IDE와 SDK, Android Studio, 고정한 JDK/Android SDK.
- 저장소에서 정한 Node·패키지 잠금 파일 환경. 기존 앱 회귀 시험과 댓글 어댑터에 필요하다.
- 운영과 분리한 Supabase 시험 프로젝트와 API 시험 서버. 브라우저/앱 설정에 운영 주소를 복사하지 않는다.
- 시험용 판매자 A/B, PC 두 대 또는 독립 설치 환경 두 개, 기존 Play 앱이 설치된 Android 업무폰.
- 실제 왕복 문자용으로 사용자가 동의한 시험 번호, 시험용 프린터. 에뮬레이터는 실제 통신사 시험을 대신하지 못한다.

키는 담당자가 개발 비밀 저장소 또는 로컬 비공개 설정으로 제공한다. 문서·커밋에 실제 값을 적지 않는다. Play 최고 versionCode와 서명 설정은 확인 결과만 기록하고 비밀 키 파일은 저장소 밖에 둔다.

### 2.2 처음 실행할 읽기·기준 확인 명령

PowerShell에서 다음을 한 줄씩 실행한다. 실패하면 출력을 확인하고 원인을 기록한다. 이 명령만으로 새 제품이 생성되는 것은 아니다.

```powershell
Set-Location 'C:\dev\voice-pin-anti'
git status --short
git branch --show-current
dotnet --info
node --version
npm --version
```

현재 변경 파일을 먼저 확인한다. 다른 사람의 수정은 지우지 않는다. 작업 브랜치는 팀 기준에 따라 `codex/saas-v2-foundation` 같은 이름으로 만들되, 이미 있는 브랜치를 임의로 덮어쓰지 않는다.

기존 의존성이 준비된 개발 환경에서 기준 시험을 실행한다. 의존성이 없으면 저장소 잠금 파일에 맞춰 설치한 뒤 실행한다.

```powershell
Set-Location 'C:\dev\voice-pin-anti'
npm test
npm run test:contracts
npm run test:api
npm run test:sales
npm run build
```

```powershell
Set-Location 'C:\dev\voice-pin-anti\android\voicecapSMS'
.\gradlew.bat --version
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

현재 소스의 compileSdk 35/targetSdk 36 조합과 실제 도구 호환성을 T00에서 정리한다. 처음부터 전부 PASS라고 보고하지 말고, 기존 실패와 새 변경으로 생긴 실패를 구분한다.

### 2.3 기존 코드를 읽을 순서

| 실제 파일 | 읽을 이유 | 그대로 복사하면 안 되는 부분 |
| --- | --- | --- |
| [Android build.gradle](C:/dev/voice-pin-anti/android/voicecapSMS/app/build.gradle) | 앱 식별·버전·서명 환경 변수 | 버전을 코드 값만 보고 결정 |
| [BridgePreferences](C:/dev/voice-pin-anti/android/voicecapSMS/app/src/main/java/com/voicecap/sms/BridgePreferences.java) | 기존 연결·동의 설정 | 업데이트 때 설정 전체 초기화 |
| [SmsSyncManager](C:/dev/voice-pin-anti/android/voicecapSMS/app/src/main/java/com/voicecap/sms/SmsSyncManager.java) | 기존 수신·업로드·발신 | 최근 N개 스캔, 콜백 없는 SENT |
| [SmsReceiver](C:/dev/voice-pin-anti/android/voicecapSMS/app/src/main/java/com/voicecap/sms/SmsReceiver.java) | 시스템 SMS 진입점 | 작업 예약만 하고 원문을 안 남김 |
| [MmsReceiver](C:/dev/voice-pin-anti/android/voicecapSMS/app/src/main/java/com/voicecap/sms/MmsReceiver.java) | MMS 진입점 | MMS 처리를 일반 SMS처럼 단순화 |
| [BridgeClient](C:/dev/voice-pin-anti/android/voicecapSMS/app/src/main/java/com/voicecap/sms/BridgeClient.java) | 구형 서버 계약 | 구형 경로에 새 API 주소만 대입 |
| [Soniox 구현이 포함된 서비스](C:/dev/voice-pin-anti/src/services/deepgramService.ts) | 공급자 응답·확정 토큰 처리 | 파일 이름만 보고 공급자 단정, 1,200자 절단 |
| [LiveContext](C:/dev/voice-pin-anti/src/context/LiveContext.tsx) | 방송 화면의 전체 전사 사용처 | 메모리 기록을 영속 저장으로 간주 |
| [cloudCommentPublisher](C:/dev/voice-pin-anti/server/cloudCommentPublisher.js) | 댓글 업로드 흐름 | 재시도 초과 시 폐기, 메모리 큐만 사용 |
| [remoteWorkspaceService](C:/dev/voice-pin-anti/src/services/remoteWorkspaceService.ts) | 현재 클라우드 저장 범위 | 여러 PC의 전체 배열 upsert |
| [공유 권한 처리](C:/dev/voice-pin-anti/supabase/functions/_shared/productSales.ts) | 현재 권한 경계 | user_metadata의 관리자 값 신뢰 |

### 2.4 한 작업을 끝내는 방법

매 작업에서 ‘입력 예제 → 실패 시험 → 구현 → 자동 시험 → 필요한 수동 시험 → 변경 파일 설명’을 남긴다. 큰 작업은 번호 뒤에 a/b/c를 붙여 작은 커밋으로 나눈다. 인증·DB 동시성·문자 실제 실행·출시 이행은 경험 있는 검토자의 코드 확인을 받는다. 검토 요청에는 질문만 보내지 말고 시험 결과와 관련 코드 위치를 함께 보낸다.

작업 기록 파일은 앞으로 `C:/dev/voice-pin-anti/docs/implementation/saas-v2/Txx-result.md`에 만든다. 실제 고객 원문 대신 합성 데이터를 사용한다.

```text
작업 ID / 커밋:
변경한 파일:
구현한 동작:
실행한 시험과 결과:
실행하지 못한 시험과 이유:
화면·DB·로그 증거 위치:
남은 위험 / 검토 요청:
다음 작업 착수 가능 여부:
```

## 3. 전체 진행 순서

| 단계 | 작업 | 통과 기준 |
| --- | --- | --- |
| 기반 | T00–T04 | 도구·계약·작업공간 보안·원자적 저장·동기화 |
| 원문 | T05–T06 | 전체 전사·댓글 시각을 실제 DB에 보관 |
| 업무폰 | T07–T13 | Room, 문자함, 직접 답장, PC 요청, 기존 앱 업데이트 |
| Windows | T14–T18 | 로컬 영속화, Soniox, 판매, 출력, 공동 관리 |
| 전체 업무·출시 | T19–T21 | 정산·배송·운영·장애·배포 시험 |

T07의 로컬 DB 개발은 서버 기반과 일부 병행 가능하다. 다만 실제 SMS와 판매를 연결하는 통합 시험은 관련 서버 작업이 끝난 후 한다. 초보 개발자 한 명이라면 표 순서대로 진행하는 편이 안전하다.

## 4. 기반 작업

### T00. 환경 고정·기존 앱 업데이트 기준 확보

선행: 없음. 산출물: 환경 버전 표, 기준 시험 결과, 앱 업데이트 체크시트.

1. 2절 명령으로 현재 브랜치·시험·도구 버전을 기록한다.
2. Android applicationId `shop.voicecap.smsbridge`, namespace `com.voicecap.sms`를 기록한다. 소스 versionCode는 7, versionName은 1.3.3이지만 Play 최고값은 별도 확인한다.
3. 기존 Play 설치 폰을 보존한다. 설정·대화·시험 연락처·기기 연결 상태를 기록한다. 삭제 후 재설치로 업데이트 시험을 대체하지 않는다.
4. compileSdk를 targetSdk 이상으로 정비한다. AGP·Gradle·JDK·Kotlin·Room 호환표를 작성하고 잠금/버전 설정을 커밋한다. AGP의 Kotlin 지원 방식을 확인하지 않고 플러그인을 중복 추가하지 않는다.
5. 시험 API/Supabase 주소와 운영 주소를 구분한다. 로그에 현재 환경 이름을 표시하되 비밀은 출력하지 않는다.

완료: 기준 실패가 설명되고 시험용 DB·계정 A/B를 사용할 수 있다. Play 승인 자체를 새 과제로 요구하지 않는다. 시험 항목: UP-01, UP-02 준비.

### T01. 새 솔루션·API 계약·가짜 입력 만들기

선행: T00. 위치: 재설계서 3.3의 새 프로젝트 경로, `contracts/saas/v2`.

1. IDE에서 .NET 10 솔루션 `VoiceCap`을 만든다. Web API, Worker, Class Library(Domain/Infrastructure/Contracts), WPF Desktop, 시험 프로젝트를 각 지정 폴더에 추가한다.
2. Domain은 화면·HTTP·DB를 참조하지 않게 한다. API/Worker는 업무 서비스를 호출하고 Desktop은 서버의 DB 비밀을 참조하지 않는다. 공통 DTO는 Contracts로 분리한다.
3. OpenAPI에 재설계서 11절의 경로, 인증 방식, 필드, 오류 코드를 작성한다. 성공뿐 아니라 401/403/409/410/422/429/503 예제를 만든다.
4. UTC 시간, UUID, 문자열 sequence, nullable 플랫폼 시각, 문자 origin/상태를 JSON 예제로 고정한다.
5. `FakeTranscriptionProvider`, `FakeSmsTransport`, `FakePrintSpooler`를 만든다. 가짜 SMS/출력은 외부 실행 없이 호출 수를 시험에서 셀 수 있어야 한다.
6. 합성 전사 20개(판매 후보 5개·비판매 15개), 긴 전사, 늦게 도착한 댓글, 중복 이벤트, 폰 직접 답장 예제를 만든다.

완료: 계약 예제가 검사되고 새 솔루션이 빌드된다. 가짜 발송이 실제 번호로 나가지 않는다. 이후 기본 명령은 다음이다. 이 명령은 솔루션을 만든 뒤 사용한다.

```powershell
Set-Location 'C:\dev\voice-pin-anti'
dotnet build '.\platform\VoiceCap.slnx'
dotnet test '.\platform\VoiceCap.slnx'
```

### T02. 계정·작업공간·기기 권한 경계 만들기

선행: T01. 위치: 새 API 인증 모듈, 기존 Supabase 권한 어댑터.

1. 서버는 JWT 서명·발급자·대상·만료를 검증하고 실제 membership을 조회한다. 문자열을 디코딩한 것만으로 인증 성공시키지 않는다.
2. `user_metadata.role`로 운영자 권한을 주는 경로를 제거하는 변경안을 만들고 회귀 시험한다. 서버 관리 역할과 작업공간 역할을 구분한다.
3. 기기 등록, 해제, 기능 권한을 구현한다. 요청 본문의 workspace/device와 인증된 기기의 관계를 검사한다.
4. 같은 계정 PC 두 대의 토큰을 별개로 유지한다. ‘이 기기 로그아웃’과 ‘전체 로그아웃’을 다른 명령으로 만든다.
5. RLS, API, private Storage, Realtime 채널에서 A/B 교차 접근 시험을 작성한다. 서버 service-role 경로도 예외가 아니다.

완료: A가 B의 판매 ID·파일 키·cursor를 넣어도 자료를 볼 수 없다. PC 1만 로그아웃해도 PC 2가 유지된다. 시험: SEC-01–SEC-04. 이 작업은 보안 검토 대상이다.

### T03. 추가 DB migration과 인덱스 만들기

선행: T02. 위치: `C:/dev/voice-pin-anti/supabase/migrations`에 새 파일.

1. 기존 migration을 수정하지 말고 새 migration을 추가한다. 현재 `sales.id`가 text인 점을 지킨다.
2. 전사 7종 표, 캡처 stream/lease/gap, 댓글 시간 필드, sync/operation, 신규 SMS 표, media 메타데이터를 재설계서대로 추가한다.
3. 작업공간·부모 ID 복합 외래키와 고유 제약을 만든다. sequence·revision·금액 타입을 계약과 맞춘다.
4. 대표 인덱스를 만든다: 전사/댓글 `(workspace_id, session_id, 시각, id)`, sync `(workspace_id, sequence)`, 대화 메시지 `(workspace_id, conversation_id, 시각, id)`, 대기 작업 `(workspace_id, target_device_id, state, next_attempt_at)`.
5. 기존 댓글 시간은 출처가 불확실하면 UNKNOWN/legacy로 이행한다. 기존 SENT에는 검증되지 않은 이전 상태임을 별도 표시한다. 과거 시각이나 성공을 새로 지어내지 않는다.
6. 빈 시험 DB 적용과 기존 자료를 넣은 시험 DB 적용을 각각 실행한다. 이행 전후 행 수·ID 연결·원문 해시를 비교한다.

완료: 자료가 없어도, 이전 자료가 있어도 migration이 성공한다. 같은 workspace의 중복은 막고 서로 다른 workspace의 정상 ID는 허용한다. 운영에 적용하기 전 복구 방안을 별도 검토한다. 시험: DATA-01.

### T04. 트랜잭션·중복 방지·변경분 동기화 공통 구현

선행: T03. 위치: Infrastructure의 DB 처리, API의 operations/sync 모듈.

1. 하나의 DB 연결·트랜잭션에서 작업공간 sync 행 잠금 → 기존 operation 확인 → 업무 변경 → sync event → 응답 저장 → commit을 구현한다.
2. 같은 operation ID/내용은 기존 결과, 같은 ID/다른 내용은 409를 반환한다. payload hash 비교 규칙을 계약으로 고정한다.
3. 판매·댓글·전사·문자·worker 등 모든 공유 자료 쓰기가 같은 sync 순서 규칙을 통과하게 한다. 우회 직접 upsert를 남기지 않는다.
4. expected_revision 조건 갱신과 최신 서버값을 담은 충돌 응답을 구현한다.
5. `GET /sync/changes`는 페이지 크기·다음 cursor·hasMore를 반환한다. 실제 자료 적용 전 cursor를 앞당기지 않는다.
6. 오래된 cursor는 410을 반환한다. snapshot을 준비하는 동안의 watermark를 고정하고 snapshot 이후 변경도 다시 받을 수 있게 한다.
7. 두 DB 연결로 동시에 요청하고, 처리 도중 오류와 응답 유실을 주입한다. 단순 메모리 fake DB 시험만으로 끝내지 않는다.

완료: 부분 판매·고아 출력·누락된 변경이 없고 늦게 commit된 변경도 전달된다. 시험: SYNC-01–SYNC-05. DB 동시성 검토가 필요한 작업이다.

## 5. 전체 전사와 댓글

### T05. 전체 전사 저장·조립·검색 API

선행: T04. 위치: API Transcripts 모듈, Worker의 utterance assembler.

1. final chunk를 받는 배치 API부터 만든다. 사용자의 판매 의도나 내용 길이로 저장 여부를 결정하지 않는다.
2. `stream_id + chunk_seq`와 이벤트 ID로 중복을 구분한다. 동일한 문장을 두 번 말한 예제는 두 번 저장한다.
3. 확정 chunk 저장 후 조립 worker가 발화를 만든다. 중간 상태는 IN_PROGRESS, 종료 확인은 COMPLETE, 연결 종료로 미완결은 CLOSED_INCOMPLETE다.
4. 수정 가능한 partial을 확정 원문처럼 쌓지 않는다. 확정 chunk는 endpoint 신호 전에 저장한다.
5. 회차별 페이지 조회, 시각 범위, 검색, 판매 근거 연결, 원문/정정문 조회, 전체 TXT/CSV export를 구현한다.
6. 정정 API는 revision을 검사하고 별도 correction을 만든다. 원본 raw_text를 수정하지 않는다.
7. 합성 전사 20개 전체가 PC 2 조회에서 보이는지 확인한다. 판매 후보 5개만 남으면 실패다.

완료: 긴 문장·새로고침·재전송·중간 끊김에도 이미 확정된 원문이 남는다. 시험: TR-01–TR-06. 실제 Soniox 연결은 T15에서 한다.

### T06. 댓글 시간·클라우드 수집기·영속 spool

선행: T04. 위치: `server/comment-collector-v2`, API Comments 모듈.

1. 기존 커넥터를 별도 어댑터로 옮기고 workspace/session마다 연결을 구분한다. 전역 단일 방송 변수를 사용하지 않는다.
2. 실제 공급자 payload에서 메시지 ID와 시간 필드·단위를 확인한다. 존재하지 않는 필드를 추측해 `platform_created_at`에 넣지 않는다.
3. 원문, 플랫폼 시간 또는 null, 수집 UTC, 서버 적재 UTC, time_source, clock_quality를 저장한다.
4. 전송 전 영속 spool에 source_event_id와 payload를 기록한다. API 오류 후 worker를 재시작해도 대기가 남게 한다. 항목별 ACK만 제거한다.
5. 댓글 수집 lease를 구현한다. 두 worker가 인수 경쟁해도 하나의 회차 연결만 활성화하고 재수집 중복은 플랫폼 ID로 막는다.
6. 공개 시험 방송을 배포 예정 서버 환경에서 연결한다. 개발 PC에서만 연결된다고 클라우드 수집 가능으로 판정하지 않는다.
7. 늦은 댓글은 표시 시각은 과거이되 sync에는 새 변경으로 나타나게 한다. 플랫폼 단절로 못 받은 범위는 수집 공백으로 표시한다.

완료: 관리 PC를 추가해도 수집 연결이 늘지 않는다. 시험: CM-01–CM-05. 공급자 제약이 확인되면 근거와 대안을 보고하고 배치 결정을 재검토한다.

## 6. Android 업무폰

### T07. Room과 기존 설정 이행

선행: T00, T01. 서버 연동 시험은 T03 이후. 위치: 기존 app 모듈 안 새 `data/local`, `data/migration`, `security` 패키지.

1. 검증한 도구 조합으로 Kotlin·Room을 추가한다. 기존 Java Activity와 공존시키고 applicationId는 그대로 둔다.
2. 재설계서 10.2의 local 테이블과 DAO를 만든다. 메시지+발송 작업+outbox가 필요한 경우 같은 Room transaction으로 저장한다.
3. 기존 `voicecap_sms_bridge` 설정을 읽는 일회성 migrator를 만든다. device_id/token/workspace/name, 동의, 업무 연락처, uploaded 표식을 보존한다.
4. 기기 ID를 업데이트 때 재발급하지 않는다. installation ID가 없는 이전 설치에는 한 번만 만들고 이후 유지한다.
5. 자격증명은 Android Keystore로 보호한 저장소에 이행한다. 이행 중 중단해도 기존 값으로 복구할 수 있어야 한다.
6. Room schema를 버전 관리하고 명시적인 migration 시험을 만든다. `fallbackToDestructiveMigration`을 사용하지 않는다.

완료: 앱 종료·재시작과 schema 업데이트 뒤 대기 작업·연결·동의가 남는다. 시험: AND-01, UP-02, UP-03. 새 DB를 만드는 것만으로 기존 자료 이행이 완료되지 않는다.

### T08. SMS/MMS 수신 원문 보존과 누락 복구

선행: T07. 위치: 기존 SmsReceiver/MmsReceiver와 새 수신 repository/worker.

1. SMS 수신 때 multipart PDU를 올바르게 조립하고 짧은 로컬 처리로 receipt를 영속 저장한다. Receiver에서 장시간 HTTP를 기다리지 않는다.
2. 기본 SMS 앱의 Telephony Provider 기록 책임을 구현한다. Provider와 Room은 같은 transaction을 쓸 수 없으므로 처리 단계 journal과 재시도 가능한 매핑을 둔다.
3. MMS는 통신사 다운로드·Provider 메시지·본문/첨부 처리 흐름을 별도로 구현하고 실기기 검증한다. broadcast를 받았다는 사실만으로 본문 수신 완료로 표시하지 않는다.
4. 실제 수신 시간, 상대 번호, 방향, SIM/업무 회선, Provider URI를 저장한다. 시스템 ID에 device/installation/type 범위를 더해 클라우드 ID 충돌을 막는다.
5. Receiver 이벤트를 놓친 경우를 위한 Provider 커서·페이지 조회를 만든다. 최근 SMS 100개/MMS 30개로 영구 제한하지 않는다. 스캔 중 새 문자가 와도 빠지지 않도록 중첩 조회와 ID 중복 방지를 조합한다.
6. 모든 기기 문자를 무조건 클라우드로 올리지 않는다. 업무 대화 판정·사용자 동의에 따라 업로드한다. 업무 고객의 자유 형식 답장을 주문 양식이 아니라는 이유로 제외하지 않는다.

완료: 네트워크 없이 받은 문자도 재시작 후 보이며 나중에 한 번만 동기화된다. 시험: AND-02–AND-05.

### T09. 업무폰 문자함·대화·직접 답장 UI

선행: T07, T08. 위치: 기존 MainActivity 연결과 새 conversations 화면/ViewModel.

1. ‘업무 문자 / 판매관리 / 기기 상태’ 탭을 만든다. 문자 목록은 Room 관찰 결과로 그린다.
2. 대화 목록에 상대 번호·고객명·최근 본문·시각·미읽음·전송 대기/실패를 표시한다. 검색과 페이지 로딩을 구현한다.
3. 대화 상세에 수신/발신, 폰 직접 발신/PC 요청, 회선, 실제 상태, 첨부 보기, 판매 연결을 표시한다.
4. 입력창·새 문자·답장을 구현한다. 보내기 동작에서 client_message_id를 한 번 만들고 Room에 저장한다. 화면 회전이나 두 번 클릭으로 같은 작업을 새로 만들지 않는다.
5. 전송 본문은 작업 생성 시 고정한다. 입력창을 수정해도 이미 대기 중인 문자 본문이 바뀌지 않게 한다.
6. 기본 문자 앱의 `RespondViaMessageService` 등 노출된 응답 진입점도 같은 작성/송신 경로를 사용한다. 현재처럼 종료만 하는 빈 동작을 남기지 않는다.

완료: 가짜 송신기로 새 문자·답장을 작성하고 재실행해도 대화와 대기가 남는다. 시험: AND-06. 실제 SMS 실행은 T11 완료 후 연결한다.

### T10. 클라우드 문자 작업과 두 발신 원천 구현

선행: T04, T07. 위치: API Messages 모듈, SMS DB 함수/트랜잭션.

1. PC `POST /messages/send`는 지정 업무 회선·Android·본문으로 CLOUD_OWNED job을 생성한다. 작업 생성과 메시지/outbox 기록을 원자적으로 저장한다.
2. PHONE 발신 이벤트는 DEVICE_OWNED 이력으로 편입한다. 이 API가 QUEUED 서버 발송 job을 만들거나 다른 폰으로 배정하면 안 된다.
3. `jobs/claim`은 원자적으로 하나의 Android에 배정한다. `jobs/{id}/begin`은 대상 기기·attempt·상태를 검사한다.
4. CLAIMED 상태에서 실행 시작 전 만료와, SUBMITTING 이후 불확실 상태를 구분한다. 만료만 보고 실제 제출 가능성이 있는 작업을 다시 배정하지 않는다.
5. 상태 이벤트에는 event_id, attempt_id, part_index, occurred_at, 기기 식별을 넣는다. 중복·순서 역전에도 최종 상태가 퇴행하지 않게 한다.
6. 대화별 조회 API와 PC/폰 공통 읽기 권한을 구현한다. 다른 판매자 번호나 다른 기기의 작업 결과를 대신 보고할 수 없게 한다.

완료: 폰 직접 발신 업로드는 클라우드 이력만 만들며 재발송 0회다. 시험: SMS-01, SMS-02, SMS-06. 구형 customer_messages 경로는 이행 어댑터로 관리한다.

### T11. 단일 SMS 송신 엔진·콜백·불확실 상태

선행: T09, T10. 위치: 새 `sms/SmsSender`, `SmsStatusReceiver`, send repository. 기존 직접 송신은 이 경로로 통합.

1. PC 요청과 폰 직접 답장이 같은 송신 엔진을 호출하게 한다. `SmsManager`를 호출하는 실행 지점을 하나로 제한한다.
2. 실행 전 Room CAS/transaction으로 job을 인수하고 attempt를 저장한다. CLOUD_OWNED는 서버 begin 승인도 필요하다. DEVICE_OWNED는 사용자가 폰에서 명시적으로 요청한 로컬 작업만 실행한다.
3. 대상 SIM이 현재 유효한지 검사한다. subscription ID를 영구 업무 회선 ID로 사용하지 않는다. SIM이 달라졌으면 사용자가 확인하게 한다.
4. 긴 한글은 플랫폼 분할 기능을 사용한다. 각 부분마다 고유 attempt/part가 담긴 sent/delivery PendingIntent를 만든다.
5. 호출 전 SUBMITTING journal을 commit한다. API 호출이 반환되면 SUBMITTED로 기록하되 이미 도착한 SENT/DELIVERED 콜백을 덮어쓰지 않는다.
6. 모든 부분의 sent 성공을 확인한 뒤 SENT로 집계한다. delivery 보고를 지원하고 실제 수신한 경우에만 DELIVERED로 표시한다. 부분 실패와 통신사 미지원은 구분한다.
7. 실행 중 앱이 종료돼 실제 제출 여부를 모르면 UNKNOWN으로 유지한다. 자동 재시도하지 말고 수신자 확인·사용자 명시 재발송을 제공한다. 재발송은 새 attempt와 경고 기록을 남긴다.
8. 먼저 fake로 호출 수·콜백을 시험한 뒤 동의한 시험 번호에 실제 한글 단문·장문을 보낸다.

완료: `SmsManager` 호출 반환만으로 성공 표시하지 않는다. 프로세스 중단 후 중복 송신을 하지 않는다. 시험: SMS-03–SMS-08. 이 작업은 코드 검토와 실기기 시험이 필수다.

### T12. Android 동기화·FCM·백그라운드 복구

선행: T08, T10, T11. 위치: 새 V2ApiClient, SyncWorker, FCM 수신기, device status 화면.

1. 구형 BridgeClient와 별개로 v2 client를 만든다. 새 설정은 `VOICECAP_V2_API_BASE_URL`처럼 구분하고 구형 `/functions/v1` 경로에 새 base URL만 끼워 넣지 않는다.
2. Room outbox는 성공/중복 항목만 ACK 처리한다. 인증 실패는 보존·연결 안내, 일시 오류는 지수 backoff와 jitter로 재시도한다.
3. FCM에는 민감한 본문 대신 최소 작업 ID를 넣고 서버에서 권한 확인 후 가져온다. FCM을 놓쳐도 앱 시작·재연결·WorkManager로 DB 대기를 다시 확인한다.
4. unique work와 Room 조건부 인수를 함께 사용한다. unique work 이름만으로 모든 병렬 실행 문제가 해결됐다고 생각하지 않는다.
5. 전화기가 인터넷 없이 이동통신 SMS를 사용할 때 직접 답장해 본다. 나중에 결과가 서버에 한 번 기록되며 다른 기기로 재배정되지 않아야 한다.
6. 상태 화면에 기본 문자 역할, 권한, SIM, 마지막 서버 연결, 대기·실패·UNKNOWN 수를 보여준다. OS 강제 중지·절전 상태에서 즉시 처리를 보장한다고 표시하지 않는다.

완료: 푸시 유실·재부팅·오프라인 뒤 복구하고 PC와 폰 대화가 일치한다. 시험: AND-07, SMS-09, SYNC-03.

### T13. 기존 Play 앱에 덮어쓰는 업데이트 시험

선행: T07–T12. 위치: Android 배포 설정과 migration 시험, 비공개 트랙.

1. 기존 Play 전체 트랙 최고 versionCode보다 큰 값을 정한다. applicationId와 Play App Signing 체계를 유지한다.
2. 업로드 키와 실제 설치 앱 서명 키를 구분한다. 임의 새 키 생성·기존 keystore 덮어쓰기·debug APK로 release 덮어쓰기를 하지 않는다.
3. 기존 설치 앱에 시험 대화·연결·동의·업로드 이력을 만든다. 구형 SENDING/불확실 작업은 서버 기록과 대조해 이행 대상을 확정한다.
4. 새 AAB를 비공개 시험 트랙으로 배포하고 기존 설치본 위에 업데이트한다. 최초 승인 절차를 다시 설계하지 않는다.
5. 연결·업무 대화·기본 역할·미전송 기록·첨부를 확인한다. 과거 SENT를 읽는 과정에서 자동 재발송하지 않는지 검사한다.
6. 회귀가 생기면 새 버전 쓰기 경로를 차단하고 수정 버전을 준비한다. DB가 이미 이행됐는데 구형 APK를 무조건 되돌려 설치하도록 안내하지 않는다.

완료: UP-01–UP-04를 실제 설치본으로 통과한다. 배포·서명 접근이 없는 개발자는 코드를 먼저 완료하고 담당자에게 정해진 시험 절차를 전달한다.

## 7. Windows 방송·관리 앱

### T14. WPF 화면·SQLite·오프라인 큐

선행: T04, T05. 위치: 새 Desktop 프로젝트의 Views/ViewModels/Services/LocalData.

1. 로그인·workspace 선택·방송/관리 역할·동기화 상태를 가진 기본 창을 만든다. UI 실행에 localhost 서버를 띄우지 않는다.
2. SQLite 저장 위치는 사용자 앱 데이터 아래 workspace별로 분리한다. DB schema migration, 자격증명 보안 저장, 파일 접근 제한을 구현한다.
3. outbox, 캐시, checkpoint, print journal, pending media를 만든다. 화면 상태와 대기 기록을 같은 로컬 transaction으로 저장한다.
4. API 호출은 UI 스레드 밖에서 하고 목록을 가상화·페이지화한다. 방송 전체 전사를 한 배열에 무한 누적하지 않는다.
5. 서버 확정 전 판매는 ‘동기화 대기’로 보인다. 다른 PC에도 이미 반영된 것처럼 표시하지 않는다.
6. 합성 전사를 입력하고 네트워크 차단 → 종료 → 재실행 → 복구를 시험한다. 계정 변경 후 이전 outbox를 새 계정에 보내지 않는다.

완료: Windows 재시작으로 대기 원문이 사라지지 않고 다른 PC에 한 번 도달한다. 시험: WIN-01, SYNC-01, SEC-04.

### T15. Soniox·오디오 캡처·방송 권한 연결

선행: T14, T05, T06. 위치: Desktop Capture/Transcription, API capture lease/credential.

1. 입력 장치 선택과 오디오 레벨부터 만든다. 마이크·시스템 오디오 모드를 명시하고 같은 소리가 두 경로로 중복 유입되지 않게 한다.
2. `ITranscriptionProvider`를 만들고 fake와 Soniox만 구현한다. 언어·연결·partial/final·오프셋·종료/오류 계약을 분리한다.
3. 방송 시작 시 서버 lease를 얻는다. 갱신 실패/만료 뒤 새로운 실시간 판매는 보류하고 상태를 표시한다. 관리 PC에는 캡처를 자동 시작하지 않는다.
4. API가 발급한 Soniox 단기 키를 사용한다. 장기 키는 Windows 설정/바이너리에 넣지 않는다. 연결 ID와 capture 시간축을 구분한다.
5. 확정 토큰을 즉시 SQLite에 기록하고 업로드한다. endpoint 전에 끊겨도 남아야 한다. 공급자가 confidence를 주지 않으면 null이다.
6. 암호화 임시 오디오와 처리 완료 watermark를 만든다. 이미 저장된 텍스트 한 행만 보고 뒤쪽 미처리 오디오까지 삭제하지 않는다.
7. 연결 복구 자료는 원문으로 저장하되 자동 판매를 재실행하지 않는다. 디스크 상한·입력 장치 제거·절전 복귀·PC 시계 변경을 시험한다.

완료: 실제 Soniox 방송과 전체 원문 조회가 연결된다. Whisper 프로세스·모델·자동 fallback이 없다. 시험: TR-01–TR-07, WIN-02, HOST-01–HOST-03.

### T16. 판매 후보·확정·정정·보류

선행: T04, T05, T15. 위치: Domain sales 규칙, API sales commands, Worker parser, Desktop 판매 화면.

1. 저장된 발화에 규칙을 적용해 후보를 만든다. 원문 ID·intent index·rule version을 기록해 worker 재시도에 후보가 중복되지 않게 한다.
2. 구매자·상품·수량·금액·회차 댓글 근거를 보여준다. 모호하면 자동 확정하지 않고 보류로 남긴다.
3. 판매 등록 command는 현재 권한/epoch와 상품 revision을 검사한다. 등록된 확정·보류 판매 모두 판매·근거·최초 출력 job을 하나의 DB transaction으로 저장한다. 등록 전 검토 후보/partial 전사는 출력하지 않는다. 최초 전표는 workspace+sale+INITIAL 고유 키로 보류→확정 때 자동 재생성하지 않는다.
4. 관리 PC 수정은 대상 ID·expected_revision·변경 필드만 보낸다. 다른 PC에서 이미 바꿨으면 비교 화면을 보여준다.
5. 정정/취소는 원래 판매·문자·입금 근거를 지우지 않고 이력을 남긴다. 복구 전사만으로 과거 판매를 다시 만들지 않는다.

완료: 같은 확정 요청 10회도 판매·자동 출력 작업이 각각 하나이며 수정 충돌이 드러난다. 시험: SALE-01–SALE-04.

### T17. 지정 프린터·실행 journal·재출력

선행: T16, T14. 위치: Desktop Printing, 서버 print-job 명령.

1. 출력 담당 기기와 실제 프린터를 지정한다. 관리 PC 접속만으로 인쇄하지 않는다.
2. atomic claim → 서버 begin → 로컬 SUBMITTING commit → Windows spool 제출 → 결과 보고 순서로 구현한다.
3. 제출 결과와 OS job ID가 있으면 기록한다. SUBMITTED는 인쇄 시스템 접수로 표현하며 종이가 나왔다는 성공으로 단정하지 않는다.
4. 제출 직전·직후 프로세스를 중단해 UNKNOWN 복구를 시험한다. 확인되지 않은 작업을 자동 재출력하지 않는다.
5. 사용자가 재출력을 누르면 원작업 링크·이유를 가진 새 작업을 만든다. 실패·확인 필요·대기 목록에서 조치할 수 있게 한다.
6. HELD 최초 전표의 보류 사유/미확인 값을 표시하고 확정 전환·재시도 시 최초 전표 1개를 유지한다. 정정 전표는 명시 작업이다. 추가 시험 KV16~KV17은 아래 최신 문서를 따른다.

완료: fake 시험뿐 아니라 실제 프린터 전표 시험을 통과한다. 시험: PRINT-01–PRINT-03.

### T18. 관리 PC의 전체 자료·문자·사진 화면

선행: T05, T06, T12, T16. 위치: Desktop 관리 화면, media API.

1. 회차별 전체 멘트·댓글·판매를 조회하고 서로의 근거로 이동할 수 있게 한다. 댓글 원본 시각이 없으면 수집 시각이라고 표시한다.
2. Android와 같은 대화를 조회하고 PC에서 발송을 요청한다. ‘작업 접수’와 ‘실제 SENT/DELIVERED’를 다른 상태로 표시한다.
3. 프린터·업무폰·방송 PC의 마지막 연결과 대기 건수를 표시한다. 오프라인 폰에 요청하면 즉시 발송됐다고 안내하지 않는다.
4. Windows 창/영역 캡처와 Android 상품사진을 private Storage 업로드에 연결한다. 업로드 실패 파일은 로컬 대기에 보존한다.
5. Realtime은 갱신 알림으로만 쓰고 sync cursor로 실제 변경을 가져온다. 이벤트를 일부러 끊어도 다시 접속하면 복구돼야 한다.

완료: PC 1에서 방송하고 PC 2/폰에서 관리하는 전체 흐름이 동작한다. 시험: MULTI-01, MEDIA-01, SMS-01.

## 8. 나머지 업무와 출시

### T19. 정산·입금·배송·AI 기능을 명령 단위로 이행

선행: T16, T18. 위치: Domain/API commerce, Worker AI, PC/Android 판매관리.

1. 정산서 생성·발송, 입금 확인, 배송 상태, 반품/취소를 기존 화면·자료 목록과 대조해 빠짐없이 나열한다.
2. 전체 배열 저장을 대상별 command로 교체한다. 정산서가 생성된 판매 가격 변경은 재확인 대상으로 만들고 원래 금액·문자를 보존한다.
3. 수신 문자에서 고객/주소/입금 후보를 추출하되 금액이나 이름 하나만 일치한다고 확정하지 않는다.
4. AI 입력에는 필요한 업무 근거만 전달한다. 외부 응답 전까지 DB 잠금을 잡지 않는다. 작업 ID·모델·규칙 버전·적용 결과·비용을 기록한다.
5. AI 장애면 수동 검토가 가능해야 한다. 전사·댓글 저장은 AI 성공 여부와 독립적이어야 한다.
6. [최신 라이브·키핑 설계](C:/dev/voicecap-win/docs/ui-2026-09-14/04_KEEPING_AND_LIVE_V2.md)의 K00~K08을 추가 수행한다. 결제 상품 보관/부분 합배송/배송비/두 PC 원자 배정/Android 요청 근거 연동을 구현하고 KV01~KV18을 실제 시험한다. 고객 통계 정의와 기존 데이터 차이를 먼저 확인한다.

완료: 과거 주요 업무가 새 화면/명령으로 대응되고 자료를 덮어쓰지 않는다. 시험: BIZ-01–BIZ-03.

### T20. SaaS 이용권·사용량·관측·백업

선행: T04, T18, T19. 위치: API billing/admin, Worker usage, 운영 문서/모니터링.

1. 운영자 권한을 판매자 권한과 분리하고 고객 지원 조회·권한 변경에 감사 기록을 남긴다.
2. 실제 결제 공급자를 정한 뒤 sandbox에서 서명 검증·webhook 중복 방지·환불·해지·실패를 구현한다. 클라이언트 결제 완료 호출만으로 플랜을 올리지 않는다.
3. Soniox 사용량·동시 방송·저장 용량·업무 회선·기기 상태를 workspace별로 집계한다. 기존 자료 업로드와 새 유료 사용의 제한을 구분한다.
4. ACK 지연·누락 구간·대기 문자·부분 실패·UNKNOWN·출력 지연·기기 heartbeat를 표시한다. 원문과 토큰은 운영 로그에서 제외한다.
5. DB 백업과 Storage 파일 복원을 각각 시험한다. 보관/아카이브/삭제 정책과 고객 export 절차를 기록한다.
6. Windows 서명 패키지·점진 업데이트·방송 중 업데이트 연기·로컬 DB migration 실패 복구를 구현한다.

완료: 돈이 실제로 처리되는 경로와 단순 UI 데모를 구분해 시험한다. 시험: OPS-01–OPS-04. 결제·외부 배포 설정은 담당자와 합의한 시험 환경에서만 진행한다.

### T21. 통합 장애 시험·구버전 이행·제한 출시

선행: T13, T17–T20. 위치: 인수시험 결과, 배포 절차, 운영 대응 문서.

1. [인수시험 문서](C:/dev/voice-pin-anti/docs/plans/2026-09-14-saas-redesign/03_ACCEPTANCE_TESTS.md)의 필수 항목을 실제 결과로 채운다.
2. workspace별 workflow_version 전환을 구현한다. 구버전/신버전이 같은 판매·문자·출력을 각각 만드는 경로를 서버에서도 차단한다.
3. 구형 대기 작업과 SUBMITTING/UNKNOWN을 분류하고 새 ID mapping을 만든다. 과거 메시지 import는 발송 작업 생성이 아니다.
4. 작은 시험 판매자 집단에서 방송 1회 전체를 수행한다. 두 PC, Android 직접 답장, PC 문자 요청, 실제 출력, 앱 재시작을 포함한다.
5. 댓글·전사 최대량과 여러 workspace를 부하 시험한다. 성공률뿐 아니라 원문 대조·중복 외부 실행·sync 지연을 확인한다.
6. 배포 중단 기준과 대응 책임자를 기록한다. 위험 시 신규 자동 실행을 정지해도 원문 수집·대기 자료 보존 경로는 가능한 범위에서 유지한다.

완료: 출시 필수 시험에 미시험/실패가 남으면 정식 완료로 표시하지 않는다. 구체적 제한을 명시한 비공개 시험과 전체 상용 출시는 구분한다. 시험: ROLL-01, LOAD-01 및 전체 필수 항목.

## 9. 초보 개발자가 막혔을 때의 점검 순서

### 화면에 자료가 안 보일 때

입력 이벤트가 왔는가 → 로컬 DB에 있는가 → outbox가 있는가 → API 항목별 결과는 무엇인가 → 서버 행이 있는가 → sync event가 있는가 → 다른 기기 cursor가 어디까지인가 → 화면 필터가 숨기는가 순서로 확인한다. 화면 새로고침 반복으로 저장 실패를 해결하려고 하지 않는다.

### 문자가 안 갈 때

본문/대상 → job origin/owner → 대상 기기·SIM → Room claim → 서버 begin(PC 요청) → SUBMITTING journal → OS 제출 → sent 콜백 → cloud ACK를 확인한다. UNKNOWN을 QUEUED로 바꾸는 것으로 문제를 숨기지 않는다.

### 같은 판매가 두 번 생길 때

발화 chunk가 실제 다른 사건인지, assembler가 중복 조립했는지, parser intent ID가 바뀌는지, 재시도에서 operation ID를 새로 발급하는지, 구형 경로가 같이 실행되는지 확인한다. 본문이 같다는 이유로 모든 중복 후보를 삭제하지 않는다.

### 다음 담당자에게 넘길 때

최소한 작업 ID, 재현 순서, 기대/실제 결과, 익명화된 요청 ID·event ID, 관련 파일, 실행한 시험, 안전하게 재현할 시험 데이터가 필요하다. ‘안 됩니다’만 적지 않는다. 비밀 토큰·실고객 전화번호·원문을 공개 이슈에 붙이지 않는다.

## 10. 구현 제외 목록

- Whisper 재도입·튜닝·자동 fallback.
- Qwen 특정 모델 선정·다운로드·GPU 런타임 배포. 공급자 인터페이스까지만 만든다.
- Android 신규 applicationId로 별도 앱 등록. 기존 Play 앱을 업데이트한다.
- 원문을 판매로 판단한 행에만 붙여 저장하는 축소 구현.
- 전체 오디오/영상 무기한 클라우드 보관을 기본 제공하는 기능.
- 신규 MMS 첨부 발신. SMS·긴 한글 문자와 MMS 수신/열람은 제외가 아니라 필수다.
- 인터넷/OS 상태와 무관한 즉시 SMS 전달 보장, 통신사/프린터와 분산 DB 간 완전한 exactly-once 보장.

‘중복 방지’는 중복 요청을 안전하게 처리한다는 뜻이다. 외부 장치가 실행했는지 확인할 수 없는 순간에는 UNKNOWN을 남기고 사람이 확인하는 것이 이 제품의 정확한 동작이다.
