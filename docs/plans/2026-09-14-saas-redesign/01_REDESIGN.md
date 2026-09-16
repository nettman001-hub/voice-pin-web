# VoiceCAP 다중 PC·Android SaaS 상세 재설계서

버전: 설계 1.0 · 작성일: 2026-09-14 · 상태: 구현 기준 문서

## 1. 목표와 확정 범위

판매자 한 명이 동일 계정으로 여러 PC에 로그인하고, 지정 방송 PC에서 캡처·실시간 음성인식·판매 입력을 진행한다. 다른 PC와 Android는 같은 판매, 전체 전사, 댓글, 고객 문자, 정산·배송 자료를 공유한다. 판매자별 작업공간을 분리해 다수 고객에게 구독형으로 제공한다.

### 1.1 필수 요구사항

| ID | 요구사항 | 완료의 의미 |
| --- | --- | --- |
| R01 | 전체 판매 멘트 클라우드 보관 | 인사·상품 설명·판매·수정·후속 발화 등 STT가 확정한 전체 텍스트를 다른 PC에서 회차별 조회 가능 |
| R02 | 댓글 시각 보관 | 원문과 함께 실제 플랫폼 시각(있을 때), 수집 시각, 서버 적재 시각을 보관하고 출처 표시 |
| R03 | Soniox 우선 | 새 앱에서 Soniox로 전사, Whisper 설치·실행·자동 fallback 제외 |
| R04 | Qwen 후속 확장 | 특정 모델·런타임을 이번에 선정·설치하지 않고 공급자 인터페이스만 분리 |
| R05 | 동일 계정·여러 PC | 기기별 독립 로그인, 한 기기 로그아웃·해제 시 나머지 기기 유지 |
| R06 | 방송 담당 한 대 | 서버가 수집 권한과 세대를 관리해 동시 활성 수집·중복 판매 방지 |
| R07 | 업무폰 자체 문자함 | 업무폰에서 대화 조회·검색·새 문자·답장·발송 결과 확인 |
| R08 | Android 영속 처리 | 수신·직접 답장·PC 발송 요청 모두 재시작·단절·업데이트 후 복구 |
| R09 | 기존 Android 업데이트 | 기존 Play 앱 식별·서명 체계·연결 정보를 보존해 비공개 트랙 버전업 |
| R10 | 안전한 공동 작업 | 서버 트랜잭션·수정 버전 검사·작업 중복 방지·변경분 동기화 |
| R11 | 업무 전체 유지 | 판매 검토·보류·정정·정산·입금·배송·캡처·상품사진·문자 연결 |
| R12 | SaaS 운영 | 실제 결제·이용권·원가·장치 상태·백업·업데이트·고객별 권한 관리 |

‘전체 멘트’는 이번 설계에서 **전체 확정 전사 텍스트**를 뜻한다. 전체 방송 오디오·영상의 영구 보관은 별도 저장 옵션이다. 음성인식이 실패한 구간을 인식한 것처럼 꾸미지 않고 누락 구간을 표시한다. 판매 판정에 실패한 문장도 원문 저장 대상이다.

현재 운영 코드에 있는 Deepgram 경로는 호환 대상으로 보존하되 새 앱 1차 인수시험의 필수 공급자는 Soniox 하나로 고정한다. 새로운 클라우드 fallback을 조용히 실행해 추가 과금하지 않는다.

## 2. 현재 기반과 변경해야 할 경계

현재 Supabase에는 `workspaces`, `workspace_members`, `live_sessions`, `products`, `buyers`, `live_comments`, `sales`, `print_jobs`, 고객 문자·정산·입금·배송 테이블이 있다. Android는 Java 네이티브 앱이며 연결 코드와 장치 토큰을 사용한다. 이전 상세 분석의 파일별 근거는 [기존 분석](C:/dev/voice-pin-anti/docs/proposals/2026-09-14-multidevice-saas.md)에 있다.

| 현재 구현 | 재설계 결정 |
| --- | --- |
| 전체 전사 React 메모리 누적, 화면 300개 제한 | 전사 수신 즉시 로컬 영속화 → 전체 클라우드 적재 → 화면만 페이지화 |
| Soniox 확정 토큰 누적 버퍼가 1,200자를 넘으면 앞부분 절단 | 저장 경로에 길이 절단 금지. 확정 조각을 순서대로 보관하고 문장으로 조립 |
| 댓글 수집 시 받은 시각 하나 중심 | 발생·수집·적재 시각 및 출처 분리 |
| 판매 직접 upsert와 별도 로컬 출력 | 공통 API에서 판매·근거·출력 작업을 원자적으로 생성 |
| 화면 전체 정산·문자 배열 upsert | 변경한 대상과 필드만 명령으로 전송, revision 검사 |
| 프린터 claim 조회·갱신 분리 | DB 잠금/조건부 갱신으로 독점 인수 |
| 문자 송신 호출 뒤 즉시 SENT | Android 전송 콜백·부분별 결과·불확실 상태 관리 |
| SMS/MMS 수신 뒤 최근 Inbox만 조회 | 원문 수신 영속화와 누락 복구용 커서 조회 |
| Android 설정·업로드 여부 SharedPreferences | 설정 이행 + Room 작업 기록 + Android Keystore 기반 자격증명 보호 |
| 로컬 STT 포함 이전 계획 | 이번 Windows 제품에서 Whisper 제외, Qwen 후속 과제 |

## 3. 제품 구성과 기술 결정

### 3.1 기기 역할

| 역할 | 담당 | 서버에서 관리하는 권한 |
| --- | --- | --- |
| 방송 PC | 오디오·화면 캡처, Soniox, 실시간 후보·판매 입력 | 회차 수집 lease, CAPTURE, SALES_CREATE |
| 관리 PC | 전체 멘트·댓글 조회, 판매 수정·검토·정산·배송·문자 작성 | SALES_READ/EDIT, MESSAGES_READ/COMPOSE 등 |
| 출력 PC | 지정 프린터 전표 | PRINT_EXECUTE와 대상 기기 검증 |
| Android 업무폰 | 번호별 문자함·직접 답장·PC 요청 송신·MMS 수신·촬영 | SMS_EXECUTE, MESSAGES_READ 및 기기/회선 소유권 |

같은 Windows 설치 앱에서 역할을 선택한다. 방송 엔진은 방송 역할에서만 활성화한다. 출력 담당은 방송 PC와 겸할 수 있다. 여러 PC 설치를 여러 유료 계정으로 분리하지 않는다. 향후 직원별 계정·세부 권한을 추가할 수 있도록 사용자와 사업 작업공간을 구분한다.

### 3.2 기술 구성

| 구성 | 기술·실행 형태 |
| --- | --- |
| Windows | C#/.NET 10 LTS/WPF, MVVM, SQLite, WASAPI, Windows 프린터 API |
| Android | 기존 app 모듈에서 Kotlin 점진 도입, 네이티브 UI, Room, WorkManager |
| 업무 API | ASP.NET Core, 기능별 모듈을 둔 단일 코드베이스 |
| 업무 worker | 같은 .NET 코드베이스, API와 별도 프로세스로 실행 |
| 클라우드 | Supabase Auth/PostgreSQL/private Storage/Realtime |
| 댓글 수집 worker | 클라우드에서 실행하는 Node 어댑터, 기존 커넥터의 프로토콜 처리 활용 |
| 모바일 알림 | FCM. 작업의 원본은 DB에 보관 |
| 운영자 웹 | TypeScript/React, 동일 업무 API |

이 선택의 기준은 기존 웹앱 재사용률이 아니라 Windows 장시간 방송·오디오 장치·프린터 제어와 장애 복구다. WPF는 Windows 전용이지만 이 제품의 우선 시장과 맞고, 화면과 서버에서 C# 계약·검증 코드를 공유할 수 있다. Electron도 구현 가능하지만 Chromium·Node·로컬 HTTP 서버까지 함께 배포할 필요를 이번 제품에서는 만들지 않는다. Tauri는 Rust 연동 학습, WinUI는 별도 패키징·UI 학습까지 고려할 때 현재 초보 개발자의 첫 구현 기준으로 선택하지 않는다. 이는 모든 앱에 대한 우열이 아니라 이 프로젝트의 선택이다.

대가는 Windows 화면 재작성과 C# 학습이다. 향후 macOS가 필수가 되면 WPF 선택을 다시 평가해야 한다. Android는 이미 승인된 앱이므로 앱 전체를 다른 프레임워크로 갈아엎지 않고 기존 Java와 Kotlin을 함께 사용한다. 백엔드는 처음부터 다수 마이크로서비스로 쪼개지 않는다. 장시간 연결을 가진 댓글 수집과 재시도 worker만 실행 단위를 분리한다.

댓글은 방송 PC의 ‘댓글 연결’ 동작이 서버에 수집 시작을 요청하고, 서버 worker가 해당 회차의 플랫폼 연결을 관리한다. 외부 댓글 공급자 장기 자격증명은 서버에 둔다. 관리 PC 수가 늘어나도 같은 회차 댓글을 여러 번 연결하지 않는다. 배포할 서버 환경에서 실제 방송 댓글 연결을 먼저 검증하며, 공급자 제약으로 실패하면 이 배치 결정을 재검토한다. Node API 전체와 Socket.IO 화면 서버를 PC에 이식하는 작업은 이번 기본 설계에 없다.

수집 worker는 방송 회차 ID별로 연결·버퍼를 분리한다. 단절 중 댓글을 계속 수집할 수 있으면 저장을 유지하고, 회차 종료·플랫폼 방송 종료 때 연결을 정리한다. 오디오 수집 PC 교체는 동일 회차의 댓글 연결을 새로 만들 이유가 아니다.

댓글 수집기는 DB/API 장애에 대비한 영속 spool을 가진다. 수집 직후 source_event_id와 원문·시각을 영속 볼륨의 큐에 넣고 서버 ACK 후 제거한다. 컨테이너 재시작으로 사라지는 메모리 큐는 사용할 수 없다. 수집기 인수에는 별도의 서버 lease를 사용한다. 플랫폼에서 놓친 댓글을 재조회할 수 없다면 해당 단절 구간을 표시하며 완전 수집을 보장했다고 기록하지 않는다. 수집 전용 인증에는 할당된 workspace·session만 허용한다.

새 API는 `/api/v2`로 버전을 구분한다. 기존 `/functions/v1`은 기존 클라이언트 호환용이다. 1차에는 기존 Edge Function에 새 DB 트랜잭션을 호출하는 어댑터를 둘 수 있지만, 같은 작업공간에 거래·문자·출력을 만드는 두 개의 독립 경로를 켜지 않는다.

화면을 띄우기 위한 `127.0.0.1:2137` 서버는 새 Windows 앱에 없다. 이번에는 로컬 STT 프로세스도 없다. Qwen 추가 시에만 필요한 실행 프로세스·IPC를 검토한다.

### 3.3 새 코드 위치(앞으로 생성할 대상)

| 위치 | 목적 |
| --- | --- |
| `C:/dev/voice-pin-anti/platform/VoiceCap.slnx` | Windows·API·worker·공통 계약·시험 솔루션 |
| `C:/dev/voice-pin-anti/platform/src/VoiceCap.Api` | HTTP API와 인증·권한 |
| `C:/dev/voice-pin-anti/platform/src/VoiceCap.Worker` | 재시도·판매 처리·AI·알림 |
| `C:/dev/voice-pin-anti/platform/src/VoiceCap.Domain` | 화면/DB에 의존하지 않는 거래 규칙 |
| `C:/dev/voice-pin-anti/platform/src/VoiceCap.Infrastructure` | PostgreSQL·Storage·Soniox 연동 |
| `C:/dev/voice-pin-anti/platform/src/VoiceCap.Contracts` | DTO·오류 코드·이벤트 형식 |
| `C:/dev/voice-pin-anti/platform/src/VoiceCap.Desktop` | WPF 화면과 기기 기능 |
| `C:/dev/voice-pin-anti/platform/tests` | 실제 DB 통합·업무 규칙·클라이언트 시험 |
| `C:/dev/voice-pin-anti/server/comment-collector-v2` | 다중 회차 댓글 어댑터 |
| `C:/dev/voice-pin-anti/contracts/saas/v2` | OpenAPI·JSON 예제·계약 검사 |
| `C:/dev/voice-pin-anti/android/voicecapSMS/app` | 기존 승인 앱의 계속 사용하는 모듈 |

이 위치는 설계상 이름이다. 이 문서 작성 시 애플리케이션 프로젝트를 생성한 것은 아니다.

## 4. 계정·작업공간·기기 식별

- `workspace_id`: 판매자 사업 공간. 모든 공유 업무 행·파일 경로·실시간 채널의 경계.
- `user_id`: 로그인한 사용자. 같은 계정이면 여러 PC에서도 동일하다.
- `device_id`: 서버에 등록한 설치 기기. 사용자가 입력한 값만으로 신뢰하지 않는다.
- `installation_id`: 앱 설치 세대. 재설치·기기 복원 시 과거 로컬 메시지 ID 충돌 방지.
- `session_id`: 방송 회차. 로그인 세션과 다른 개념이다.
- `capture_stream_id`: 중단·재개를 포함해 오디오 시간축을 식별하는 ID.
- `provider_stream_id`: Soniox 연결 한 번을 식별하는 ID. 재연결할 때 바뀐다.

각 기기는 독립 로그인 세션을 만들며 Windows 보안 저장소/Android Keystore 연계 저장소에 자격증명을 보관한다. 로그아웃 기본 범위는 해당 세션이다. 작업공간 membership·관리자 역할은 서버가 관리하는 정보로만 판정한다. 사용자 수정 가능 `user_metadata`와 요청 본문의 workspace/device ID는 권한의 근거가 아니다.

API는 로그인 토큰과 서버 등록 기기를 연결하고, 대상 회차·판매·고객·메시지·파일이 같은 workspace에 속하는지 검사한다. Supabase service-role을 쓰는 코드에서도 이 검사를 생략하지 않는다. DB 외래키는 가능하면 `(workspace_id, entity_id)` 복합 참조로 교차 작업공간 연결을 막는다.

## 5. 전체 멘트 저장 설계

### 5.1 저장 순서

`Soniox 응답 → 확정 토큰 분리 → SQLite 확정 조각 기록 → 업로드 → 클라우드 원문 보존 → 문장 조립 → 판매 규칙/AI` 순서를 지킨다. 판매 여부 판정, 닉네임 검증, 화면 필터보다 원문 저장이 먼저다.

수정 가능한 중간 토큰은 화면 표시용이다. Soniox가 확정한 텍스트 조각은 곧바로 보존하고, 발화 종료 신호를 기다린다는 이유로 영속 저장을 미루지 않는다. 종료 신호 전에 연결이 끊겨도 이미 확정한 조각은 남아야 한다. 문장 조립은 최종 토큰 누적 위치를 추적해 같은 조각을 두 번 붙이지 않는다.

### 5.2 데이터 모델

| 테이블 | 주요 필드 | 제약·목적 |
| --- | --- | --- |
| `stt_streams` | id, workspace_id, session_id, device_id, capture_stream_id, provider, model, lease_epoch, started_at, ended_at | Soniox 연결 이력, 재연결 경계 |
| `transcript_chunks` | id, workspace_id, session_id, stream_id, chunk_seq, audio_start_ms, audio_end_ms, raw_text, source_received_at, ingested_at, payload_hash | UNIQUE(workspace_id, stream_id, chunk_seq), 확정 원문 보존 |
| `transcript_utterances` | id, workspace_id, session_id, stream_id, utterance_seq, raw_text, assembled_text, audio_start_ms, audio_end_ms, completion_state, revision | 문장별 검색·조회, IN_PROGRESS/COMPLETE/CLOSED_INCOMPLETE |
| `transcript_chunk_links` | workspace_id, utterance_id, chunk_id, position | 문장과 원본 조각을 연결 |
| `transcript_corrections` | id, workspace_id, utterance_id, previous_revision, corrected_text, reason, actor_user_id, actor_device_id, created_at | 원문을 덮어쓰지 않고 사용자 정정 보관 |
| `capture_gaps` | id, workspace_id, session_id, capture_stream_id, start_ms, end_ms, reason, recovery_status | 인식 중단·파일 누락 구간을 명시 |
| `sale_transcript_sources` | workspace_id, sale_id, utterance_id, intent_index, rule_version | 판매와 근거 발화 연결 |

기존 `sales.id`는 text이므로 연결 테이블도 이를 따른다. 기존 ID를 무조건 UUID로 변환하지 않는다. 새 이벤트·발화·작업 ID는 UUID를 사용한다. sequence는 64비트 범위를 고려하고 JSON에서 문자열로 직렬화한다.

한 문장이 길어도 앞부분을 버리지 않는다. 행·요청 크기 제한을 넘으면 조각을 나누어 모두 저장한다. 같은 문장을 연달아 실제로 말하면 서로 다른 발화로 남는다. 텍스트 해시만으로 중복 판정하지 않는다. 해시는 같은 이벤트 ID에 다른 내용이 재전송되는 오류를 검사하는 용도다.

`confidence`가 제공되지 않으면 null로 저장한다. 임의로 높은 신뢰도를 채우지 않는다. 후속 Qwen도 동일한 규칙을 따른다.

### 5.3 조회 화면

회차·시각 범위·키워드·판매 연결 여부·원문/정정문 필터를 제공한다. 관리 PC와 Android는 서버 페이지를 읽으며 전사 전체를 한 번에 메모리에 올리지 않는다. 화면에는 발화 시각, 공급자, 내용, 연결 판매, 정정·미완결·복구 표시를 제공한다. CSV/TXT 내보내기는 서버의 전체 범위를 순회해 생성한다.

### 5.4 장애와 Qwen 보류의 영향

Soniox 또는 인터넷이 끊기면 실시간 인식 중단을 즉시 표시한다. Whisper로 자동 전환하지 않는다. 연결 복구 전 이미 확정된 텍스트는 outbox에서 재전송한다. 회차 종료도 미전송 기록을 삭제하지 않는다.

기본 복구용 오디오는 앱 전용 암호화 임시 파일에 구간별로 보관하며, 전사·클라우드 적재를 확인한 범위부터 정리한다. 초기 디스크 예산은 1GiB를 제안한다. 상한 도달 시 경고와 `capture_gaps`를 남기며 미전송 자료를 조용히 덮어쓰지 않는다. 오디오 전체 영구 보관 옵션과 구분한다.

정리 기준은 텍스트 한 행의 ACK가 아니라 오디오 구간의 처리 완료 범위와 해당 확정 조각들의 ACK다. 문장 중간·미처리 구간을 지우지 않는다. 무음으로 판정해 완료한 구간도 별도로 추적한다. 녹음 장치 선택·시스템 오디오/마이크·재연결·샘플레이트 변환을 캡처 계층에 두고, 같은 소리를 마이크와 loopback에서 이중 인식하지 않도록 입력 모드를 명시한다.

오프라인 구간을 나중에 Soniox로 처리할 때에는 복구 전사임을 표시한다. 복구 구간의 문장은 모두 저장하지만 이미 끝난 거래에 자동 판매를 재실행하지 않고 검토 후보로 제공한다. 실시간 전사와 일부 오디오가 겹치는 경우 capture 시간축으로 비교한다.

Qwen은 `ITranscriptionProvider` 구현을 추가하는 후속 작업이다. 구체 모델·라이선스·한국어 품질·실시간 지연·CPU/GPU·배포 크기는 당시 검증한다. 이번 코드에는 Qwen 다운로드·실행 화면이나 특정 모델에 대한 성능 보장을 넣지 않는다.

## 6. 댓글 시각과 시간축

### 6.1 필드 정의

| 필드 | 의미 | 필수 여부 |
| --- | --- | --- |
| `platform_created_at` | 플랫폼이 실제 제공한 메시지 생성 UTC 시각 | 선택. 제공되지 않으면 null |
| `collected_at` | 수집기가 해당 메시지를 받은 UTC 시각 | 필수 |
| `ingested_at` | DB에 처음 저장한 서버 UTC 시각 | 필수, 서버 생성 |
| `platform_time_raw` | 원본 값·단위 확인에 필요한 최소 시간 메타데이터 | 선택 |
| `time_source` | PLATFORM 또는 COLLECTOR | 필수 |
| `clock_quality` | NORMAL, UNKNOWN, SKEWED | 필수 |
| `platform_message_id` | 플랫폼 원본 메시지 ID | 제공될 때 필수 사용 |
| `platform_room_id` | 플랫폼 방송/방 ID | 수집 시작 후 확인 |
| `source_event_id` | 수집기에서 최초 생성해 재전송 때 유지하는 UUID | 필수 |

PostgreSQL은 `timestamptz`, 전송은 ISO 8601 UTC(`...Z`), 기본 표시는 `Asia/Seoul`을 사용한다. 시·분·초만 저장하지 않는다. 플랫폼 시간을 확인할 수 없을 때 수집 시간을 플랫폼 생성 시각으로 채우지 않는다.

기존 `captured_at`은 마이그레이션에서 수집 시각으로 해석하되, 실제 출처가 불명확한 과거 행은 `clock_quality=UNKNOWN`으로 표시한다. 원래 적재 시각을 복원할 근거가 없는 행은 별도 legacy 표시를 두며 이행 시간을 원래 적재 시각으로 주장하지 않는다.

예: 플랫폼 10:00:01.100, 수집 10:00:01.400, 서버 저장 10:02:00.000인 댓글은 늦게 도착한 10시 댓글이다. 10:02에 발생한 것으로 판매 근거에 연결하지 않는다.

### 6.2 정렬·동기화·중복

화면은 신뢰 가능한 발생 시각 우선, 없으면 수집 시각으로 정렬하고 동률은 서버 순서·ID로 안정화한다. 동기화 커서는 표시 시각과 독립적인 서버 변경 순서를 사용한다. 과거 시각의 댓글이 늦게 들어와도 새 데이터로 전달한다.

플랫폼 메시지 ID가 있으면 UNIQUE(workspace_id, platform, platform_room_id, platform_message_id)를 사용해 수집기 교체 시 중복을 막는다. 메시지 ID가 없으면 source_event_id로 재전송 중복만 방지하고, 내용이 같다는 이유로 별도 실제 댓글을 삭제하지 않는다.

오디오 시간은 재설정될 수 있는 PC 시계 대신 샘플 누적 수/monotonic clock으로 진행한다. 서버 시각과의 기준점을 별도로 보관한다. 댓글과 발화의 시간 근접성은 후보 근거이며, 방송 지연 때문에 가까운 댓글 하나를 자동으로 정답 처리하지 않는다. 같은 회차·상품·구매자 근거를 함께 확인한다.

## 7. 공통 저장·동기화 계약

### 7.1 로컬 outbox

PC에는 `outbox_events`, `cached_entities`, `sync_checkpoints`, `print_journal`, `pending_media`를 둔다. Android에는 10절의 Room 테이블을 둔다. outbox 항목은 event_id, workspace_id, device_id, kind, payload, payload_hash, created_at, retry_count, next_attempt_at, state를 가진다.

`PENDING → IN_FLIGHT → ACKED`로 관리한다. 네트워크 오류는 다시 PENDING, 인증·권한 오류는 BLOCKED로 보존하고 재로그인/기기 연결 상태를 안내한다. 작업 도중 재시작한 IN_FLIGHT는 같은 ID로 재조회한다. 일정 횟수 실패했다는 이유로 원문을 폐기하지 않는다. 화면에 대기 건수·가장 오래된 항목 시각을 표시한다.

배치는 초기 최대 100항목·1MiB·500ms를 조정 시작값으로 한다. 한 항목이 실패해도 성공·중복·재시도·영구 거절 결과를 항목별 반환한다. 모든 DB 오류를 중복으로 취급하지 않는다. ACKED 판단은 HTTP 200만이 아니라 항목별 결과를 기준으로 한다.

원문 배치의 중복 키는 항목별 event_id다. 재시도 때 미확인 항목만 새 배치로 묶을 수 있지만 각 event_id와 payload는 유지한다. HTTP requestId는 진단용이며 업무 operation_id와 다르다. 아래의 ‘같은 operation에 같은 응답’ 규칙을 배치 전체의 일시 실패 결과까지 영구 캐시하는 데 사용하지 않는다. 영구 거절 항목은 오류 설명과 함께 보존하고 수정 재제출이 필요한 경우 원본 링크가 있는 새 이벤트를 만든다.

### 7.2 서버의 원자적 명령

판매 확정·수정·문자 작업 생성·출력 생성은 PostgreSQL 트랜잭션에서 처리한다. 외부 Soniox·AI·SMS·프린터 호출은 DB 트랜잭션 안에 넣지 않는다.

초기 구현에서는 workspace별 `workspace_sync_state` 행을 트랜잭션 시작에 `FOR UPDATE`로 잠그고, 그 안에서 작업 중복 조회·필수 엔티티 검증·조건부 revision 갱신·변경 이력 기록·sync 번호 할당·결과 저장을 함께 수행한다. 모든 관련 쓰기가 같은 순서를 지켜야 한다. 이 방식은 판매자별 짧은 DB 쓰기를 직렬화하므로 고빈도 원문은 배치 적재하고 긴 연산은 먼저 밖에서 실행한다. 규모 시험에서 병목을 확인하면 검증된 CDC/동기화 계층으로 바꾼다.

동일 operation_id와 동일 payload 재전송은 기존 결과를 반환한다. 같은 ID에 다른 payload는 409이다. 처리 중 작업을 또 실행하지 않는다. 상품·판매 갱신은 expected_revision이 맞을 때만 적용한다. 충돌 시 서버 최신값과 사용자의 미반영 변경을 함께 보여준다.

### 7.3 sync_events

`sync_events(workspace_id, sequence, entity_type, entity_id, entity_revision, change_kind, committed_at)`를 같은 트랜잭션에 저장한다. 커서에는 workspace·마지막 sequence·보관 세대를 묶어 서버가 발급한다. 다른 workspace 커서는 거절한다. timestamp의 최댓값이나 전역 sequence 선할당만으로 커밋 순서를 가정하지 않는다.

Realtime private 채널은 변경이 있다는 힌트다. 클라이언트는 마지막 확인 커서로 `GET /api/v2/sync/changes`를 호출하고 로컬 변경 적용과 커서 저장을 하나의 로컬 트랜잭션으로 수행한다. 이벤트 누락·재연결에도 같아야 한다. 보관 기한을 넘은 커서는 410과 snapshot 재시작 방법을 반환한다. 서버 snapshot은 고정 watermark와 일관된 조회 범위를 사용한다.

계정 전환 시 로컬 파일·캐시는 workspace별로 분리한다. 이전 workspace outbox를 새 workspace에 전송하지 않는다. 로그아웃이나 연결 해제로 미전송 자료를 조용히 삭제하지 않고 해당 계정의 재로그인 후 복구한다.

## 8. 방송 PC 독점과 Soniox 인증

`capture_leases(workspace_id, session_id, device_id, epoch, expires_at)`를 둔다. 기본 lease 30초/갱신 10초는 초기값이며 서버 시각 기준이다. 시작·인계는 DB 트랜잭션으로 처리하고 새 소유자에게 epoch를 증가시켜 부여한다.

초기 동시 방송 한도는 workspace당 1이다. 회차별 lease만 검사하면 서로 다른 회차를 만들어 우회할 수 있으므로 workspace의 방송 slot/한도 행도 같은 트랜잭션에서 잠근다. 새 회차 시작·기존 회차 인계·만료 회수 모두 이 규칙을 따른다. 향후 다중 동시 방송 상품을 제공할 때에만 한도와 권한을 명시적으로 확장한다.

판매 명령은 현재 lease와 epoch를 검사한다. 이전 epoch에서 지연 도착한 원문은 복구 자료로 저장할 수 있지만 자동 판매 실행은 차단한다. 과거 자료를 수집 권한이 없다는 이유만으로 영구 유실시키지 않는다. 기기 자체가 해제된 경우에는 보유 자료를 로컬 보존하고 연결 복구 절차로 처리한다.

Soniox 접속권한은 자사 API가 이용권·동시 방송·device/lease를 확인한 뒤 발급한다. 장기 키는 서버에 보관한다. 단기 키는 한 번 사용, 접속 유효기간, 최대 스트림 길이, 서버가 정한 추적 ID를 설정한다. 단기 키의 접속 만료가 이미 열린 스트림을 종료하지 않는다는 점을 반영하고, 공급자 측 사용량과 서버 기록을 대조한다. 연결 교체 시 확정 토큰을 보관하고 sample offset을 이어 간다.

## 9. 판매·정산·출력

판매 파서는 영속 저장된 발화를 입력받는다. 후보는 음성 근거·상품·금액·구매자·같은 회차 댓글을 연결한다. 불확실하면 판매 보류 또는 검토 후보를 유지한다. AI는 규칙·권한·비용 제한 뒤에 호출하고 결과와 적용 이력을 남긴다.

판매 명령은 작업 ID, 회차, 상품 revision, 구매자, 수량, 발화·댓글 근거, 수집 epoch를 포함한다. 금액은 서버 상품 단가와 수량으로 검증한다. 금액은 정수 원 단위로 저장한다. 새로운 후보를 만드는 단계와 실제 판매 확정 단계를 분리해 복구 전사가 확정 거래를 반복 생성하지 않게 한다.

판매·정산·입금·배송 수정은 대상별 명령이다. 이미 보낸 정산서와 금액이 달라지면 연결 재확인 필요를 표시하고 기존 문자·입금 근거를 보존한다. 닉네임·전화번호·금액 하나가 같다는 이유로 자동 입금 확정을 하지 않는다.

출력은 `QUEUED → CLAIMED → SUBMITTING → SUBMITTED`와 FAILED/UNKNOWN/CANCELLED 상태를 둔다. 지정 기기만 claim하고 서버 begin 승인·로컬 journal 뒤 spool에 제출한다. SUBMITTED는 Windows 접수이며 실제 종이 배출 보장이 아니다. 제출 여부가 불확실하면 UNKNOWN이며 자동 재인쇄하지 않는다. 사용자 재출력은 새 작업과 이유를 남긴다.

### 9.1 보류 판매도 최초 전표 출력

최신 사용자 요구에 따라 영속 등록된 판매는 CONFIRMED/HELD 모두 최초 전표를 생성한다. 아직 판매로 등록되지 않은 검토 후보/partial 전사는 출력하지 않는다. 보류 전표에는 사유·미확인 값을 명시하며 청구/확정 매출에서 제외한다. 판매 등록과 최초 작업/outbox를 원자 저장하고 `(workspace_id, sale_id, purpose=INITIAL)` 고유성으로 재시도·보류→확정 중복 출력을 막는다. sale revision별로 최초 전표를 다시 만들지 않는다. 최초 출력 스냅샷과 정정 차이를 보여주며 정정/재출력은 명시 작업으로 분리한다.

### 9.2 고객 이력·키핑·합배송 추가

댓글 고객정보는 구매횟수·누적 구매금액·미이행 횟수·키핑 여부이며 단골/첫구매를 표시하지 않는다. 식별 전/조회 실패는 0과 구분한다. 플랫폼 사용자 ID와 workspace 고객 ID로 연결하며 닉네임만으로 매칭하지 않는다.

키핑은 확인된 결제 상품을 미출고 보관하는 업무다. 나중 회차의 추가 결제 상품과 선택 합배송하며 무료배송 기준은 판매자 정책이다. 키핑 변경은 새 판매/매출이 아니고 무료배송 달성만으로 자동 출고하지 않는다. 결제 배분·상품/수량·보관 위치·원주문·합배송 배정/이력을 보존한다. PostgreSQL 원자 예약과 operationId/revision으로 두 PC 중복 출고를 막고 SQLite는 캐시/미전송 요청을 담당한다. 오프라인에서 공유 출고를 확정하지 않는다.

상태·제안 테이블·정산/환불/배송비·Android 문자 연계·K 작업 및 KV 시험의 상세는 [최신 라이브·키핑 설계](C:/dev/voicecap-win/docs/ui-2026-09-14/04_KEEPING_AND_LIVE_V2.md)를 따른다. 기존 ‘보류 출력 제외’ 제안과 상충하면 이 최신 규칙이 우선한다.

## 10. Android 문자함·직접 답장·영속 실행

### 10.1 사용자 화면

메인 탭은 업무 문자 / 판매관리 / 기기 상태로 구성한다. 업무 문자에는 대화 목록, 미읽음, 검색, 첨부 표시, 회차·판매 연결이 나온다. 대화 상세에는 수신·발신 말풍선, 실제 시각, 발송 기기/회선, 발송 상태, 입력창, 보내기, 첨부 보기, 재시도/확인 필요 안내를 둔다.

업무폰에서 직접 새 문자를 쓰거나 답장할 수 있다. 기본 SMS 앱 역할을 사용하는 현재 배포 방식은 유지하며, 필요한 일반 문자 읽기·발신 기능도 실제 동작하게 한다. 비업무 문자는 기기에서 확인할 수 있어도 클라우드 업무 데이터에 자동 포함하지 않는다. 업무 등록·기존 고객 연결과 사용자가 확인한 동기화 범위를 적용한다. 정형 주문 양식이 아닌 고객 문의도 등록된 업무 대화에서는 보존한다.

일반 SMS·긴 한글 문자 송수신과 MMS 수신·첨부 열람은 필수다. 새로운 MMS 첨부 발신 UI는 별도 확장 범위로 두며 실제 지원 전에는 제공하지 않는다.

### 10.2 로컬·클라우드 데이터

| Android Room | 목적 |
| --- | --- |
| `local_conversations` | 정규화 전화번호·업무 회선·업무 여부·미읽음 |
| `local_messages` | 원문·방향·송수신 시각·provider URI·origin·cloud_message_id |
| `local_send_jobs` | client_message_id, origin, execution_owner, 대상 SIM, 전송할 고정 본문, 상태 |
| `local_send_attempts` | attempt_id, part_index, 호출 전 기록, 전송/배달 콜백, 결과 |
| `local_sync_outbox` | 아직 클라우드 ACK를 받지 못한 메시지·상태 이벤트 |
| `local_media` | MMS/이미지 임시파일·해시·업로드 상태 |
| `local_sync_checkpoints` | 서버 변경 커서·기기 Provider 스캔 위치 |
| `local_migrations` | 기존 설정·업로드 표식 이행 완료 여부 |

클라우드에는 `sms_conversations`, `sms_messages`, `sms_jobs`, `sms_attempts`, `sms_status_events`, `sms_device_bindings`를 둔다. 기존 customer_messages를 직접 확장해 구버전 상태 enum을 깨뜨리지 않는다. 이행 시 legacy ID mapping을 만들고 새 canonical 데이터에 한 번만 편입한다.

대화 범위는 workspace + 업무 회선 ID + 정규화 상대 전화번호다. SIM의 subscription ID는 변경될 수 있어 업무 회선의 영구 ID로 쓰지 않는다. 실제 실행 시 유효한 SIM인지 다시 확인한다. 수신 메시지 식별에는 기기·설치 세대·SMS/MMS 종류·원본 식별을 포함한다.

### 10.3 두 발신 경로의 실행 소유권

| 시작 위치 | 작업 원본·실행 | 클라우드의 역할 |
| --- | --- | --- |
| PC에서 발송 | 서버가 job 생성 → 지정 Android가 claim → 로컬 journal → 제출 | 전송 요청·배정·상태의 기준 |
| 업무폰에서 직접 발송 | 먼저 Room에 DEVICE_OWNED job 생성 → 같은 송신 엔진 실행 | 메시지·결과를 기록하고 PC에 공유. 이 작업을 다른 폰에 배정하지 않음 |

업무폰 직접 발신은 모바일 데이터가 끊겨도 셀룰러 SMS와 기존 권한·SIM이 유효하면 로컬에서 수행할 수 있다. 나중에 클라우드에 기록을 올릴 때 이미 보낸 문자를 QUEUED 서버 작업으로 다시 만들면 안 된다. PC 요청과 폰 직접 발신은 UI 진입점이 다르지만 실제 SmsManager 호출 코드는 하나로 통합한다.

보내기 버튼을 누르는 순간 고정 client_message_id를 만들고 Room 트랜잭션으로 기록한다. 빠른 두 번 누름·화면 회전·재시작으로 새 ID를 만들지 않는다. 의도적으로 다시 보낸 동일 본문은 다른 작업이며 본문 해시만으로 삭제하지 않는다.

### 10.4 수신 경로

Receiver는 SMS PDU 또는 MMS 도착을 인식하고 긴 네트워크 작업 전에 로컬 영속 수신 작업을 남긴다. 기본 SMS 역할에 필요한 Telephony Provider 보관도 실제 구현한다. 단순히 Receiver에서 작업 예약 후 Inbox를 읽는 것만으로 신규 문자 보관을 가정하지 않는다. MMS 본문·첨부는 다운로드 상태와 재시도를 관리한다.

Provider와 Room은 하나의 DB 트랜잭션으로 묶을 수 없으므로 수신 receipt ID와 단계별 journal로 복구한다. 같은 수신 이벤트를 다시 처리해도 한 논리 메시지로 정리한다. 주기 복구 스캔은 시간+ID 커서와 페이지로 처리하고 최신 100/30건 제한 때문에 오래된 미처리 문자가 남지 않게 한다.

### 10.5 상태와 중복 방지

발신 상태는 QUEUED, CLAIMED(서버 발신), SUBMITTING, SUBMITTED, SENT, DELIVERED, FAILED, UNKNOWN, CANCELLED다. 수신은 RECEIVED다. 앱 화면에는 대기 / 전송 중 / 전송됨 / 배달 확인 / 실패 / 확인 필요를 표시한다.

- SUBMITTING: 호출 직전 journal 작성 완료. 이 이후 재시작은 자동 재발송부터 하지 않는다.
- SUBMITTED: OS API 호출이 접수된 단계. 전송 성공을 뜻하지 않는다.
- SENT: 해당 메시지의 모든 부분 전송 콜백이 성공한 단계.
- DELIVERED: 지원되는 회선에서 배달 콜백을 확인한 단계. SENT만으로 만들지 않는다.
- UNKNOWN: 제출 여부 또는 최종 결과를 확인할 근거가 부족한 단계.

PendingIntent·콜백 식별에 attempt_id와 part_index를 포함한다. 콜백은 Room에 먼저 저장하고 서버 업로드는 재시도 가능하게 한다. 서버는 event_id와 시도별 이벤트를 보존하고 늦은 이벤트 때문에 SENT를 QUEUED로 되돌리지 않는다. 일부만 보낸 긴 문자는 전체 성공으로 표시하지 않는다.

네트워크 재전송은 안전하게 반복하지만 이미 제출한 실제 SMS는 자동 반복하지 않는다. UNKNOWN에서 사용자가 재발송을 선택하면 중복 가능 안내와 새 시도 ID를 남긴다. PC나 폰의 수정 UI가 전송 완료 상태를 직접 upsert할 수 없게 한다.

서버 begin과 취소는 같은 job에 대한 조건부 상태 변경이다. 취소가 먼저 commit되면 begin을 거절하고, begin이 먼저 commit되면 취소를 보장하지 않는다. lease 만료만으로 SUBMITTING/SUBMITTED 작업을 다른 기기에 배정하지 않는다. 콜백이 OS 호출 반환보다 먼저 도착할 수 있으므로 뒤늦은 SUBMITTED 기록도 SENT/DELIVERED를 덮어쓰면 안 된다. 상태는 단순 enum 숫자 비교가 아니라 attempt·part별 증거와 허용 전이로 집계한다.

### 10.6 깨우기·보안·기기 상태

FCM에는 작업 ID 등 최소 정보만 담고 인증된 API로 원본을 조회한다. WorkManager는 네트워크 상태와 unique work를 사용해 중복 실행을 줄이고, Room의 실행 소유권 검사를 최종 방어로 둔다. FCM이나 앱 스케줄러가 모든 절전 상태에서 즉시 실행된다고 보장하지 않는다.

PC와 폰에 최근 연결, 미처리 수신, 발송 대기, 확인 필요, 기본 SMS 역할, SMS 권한, 선택 SIM 상태를 보여준다. 로그·장애 첨부에는 실제 키·전체 고객 메시지·전화번호를 기본 출력하지 않는다.

서버에서 기기를 해제하면 새 클라우드 작업·자료 접근은 차단한다. 단, 인터넷이 끊긴 폰에서 사용자가 직접 하는 기본 문자 기능까지 원격으로 즉시 정지시킬 수 있다고 보장하지 않는다. 폰의 로컬 문자 기능과 서버 업무 권한의 경계를 화면·운영 문서에 구분한다.

## 11. API v2 계약 개요

아래 endpoint는 구현할 계약이다. 목록 조회는 cursor/limit을 사용하며 응답 크기 상한을 둔다. 사용자 인증과 제한된 장치 실행 인증을 구분한다.

| 메서드·경로 | 역할 |
| --- | --- |
| `POST /api/v2/devices/register` | 로그인 세션에 기기를 연결 |
| `GET /api/v2/devices` | 역할·접속·버전·대기 상태 |
| `POST /api/v2/sessions/{id}/capture-lease` | 수집 시작·갱신·인계 명령 |
| `POST /api/v2/stt/credentials` | Soniox 단기키 발급 |
| `POST /api/v2/transcripts/batch` | 확정 조각·문장 종료·누락구간 이벤트 적재 |
| `GET /api/v2/sessions/{id}/transcripts` | 전체 전사의 검색·페이지 조회 |
| `POST /api/v2/transcripts/{id}/corrections` | 원문을 보존한 정정 |
| `POST /api/v2/comments/batch` | worker의 댓글 원문·시간 적재 |
| `GET /api/v2/sessions/{id}/comments` | 댓글 페이지 조회 |
| `POST /api/v2/sales/commands` | 판매 확정·수정·취소 |
| `GET /api/v2/operations/{id}` | 응답 유실·처리 중 결과 조회 |
| `POST /api/v2/print-jobs/commands` | claim·begin·결과·재출력 |
| `GET /api/v2/messages/conversations` | 업무 대화 목록 |
| `GET /api/v2/messages/conversations/{id}` | 대화 메시지 페이지 |
| `POST /api/v2/messages/send` | PC에서 지정 업무폰으로 발송 요청 |
| `POST /api/v2/messages/device-events` | 수신·폰 직접 발신·전송 콜백 업로드 |
| `POST /api/v2/messages/jobs/claim` | 서버 발신 작업의 원자적 인수 |
| `POST /api/v2/messages/jobs/{id}/begin` | 서버 발신 작업 제출 직전 상태 |
| `GET /api/v2/sync/changes` | 변경 커서 복구 |
| `POST /api/v2/media/uploads` | 제한된 private Storage 업로드 권한 |

성공 봉투는 `ok, apiVersion, serverTime, requestId, data`, 오류는 `ok=false, requestId, error(code, message, retryable, details)`다. 권한 403, 버전/작업 내용 충돌 409, 만료 커서 410, 잘못된 값 422, 제한 429, 일시 장애 503을 구분한다. 401/403을 무한 자동 재시도하지 않는다.

확정 조각 payload 예시:

```json
{
  "requestId": "d83528d3-0cbb-4b69-9427-77f227d54bc4",
  "sessionId": "6218f113-c49e-45f1-ac98-2d3ba21390e8",
  "streamId": "2bf9f8c8-8ac8-4f9d-a8da-9207a43a2301",
  "leaseEpoch": 3,
  "items": [{
    "eventId": "1834b54d-5521-43a9-b21b-bd829a0c1cad",
    "kind": "FINAL_TEXT_CHUNK",
    "sequence": "42",
    "audioStartMs": 12000,
    "audioEndMs": 14200,
    "text": "이 상품은 파란색이고 가격은 이만원입니다.",
    "sourceReceivedAt": "2026-09-14T01:00:14.350Z"
  }]
}
```

workspace와 실제 actor device는 인증에서 결정한다. 예제의 leaseEpoch·시간·ID는 필드 설명용이며 실제 운영값이 아니다. requestId는 진단용이며 재시도·배치 재구성에도 항목 eventId와 그 원문은 유지한다. 판매 확정 같은 업무 명령에는 이와 별도로 안정적인 operationId를 사용한다.

### 11.1 전화기 직접 답장 이벤트 예시

다음은 `POST /api/v2/messages/device-events`의 ‘폰에서 만든 발신 이력’ 예시다. 이것을 PC의 `/messages/send`로 보내면 안 된다. 번호·ID·시각은 형식 설명용이며 실제 발송 대상이 아니다.

```json
{
  "events": [{
    "eventId": "a895dddf-a6b6-4a15-92e1-e09b0f9bf0a7",
    "kind": "PHONE_MESSAGE_CREATED",
    "occurredAt": "2026-09-14T02:10:00.000Z",
    "message": {
      "clientMessageId": "37b35904-1145-45aa-98eb-62c5a718bfb8",
      "businessLineId": "e7c24449-a8e7-4f0b-950e-c4b4f3186609",
      "recipient": "+821000000000",
      "body": "네, 요청하신 주소로 확인했습니다.",
      "direction": "OUTBOUND",
      "origin": "PHONE",
      "executionOwner": "DEVICE_OWNED"
    }
  }]
}
```

생성 이력과 실제 결과는 별도 이벤트다. 이후 attempt/part별 SUBMITTED·sent callback·delivery callback 근거를 올린다. 결과 이벤트가 먼저 도착해도 FK 오류로 버리지 않도록 선행 메시지 이력을 함께 보내거나 미해결 이벤트로 보존해 연결한다. 서버는 origin/owner 값을 그대로 믿지 않고 인증 기기·등록 회선·해당 endpoint가 허용하는 사건인지 확인한다.

PC 발신 요청은 operationId, businessLineId, targetDeviceId, recipient, body, 관련 sale/invoice ID를 받는다. 서버가 CLOUD_OWNED job을 생성하며 위 PHONE 이력을 배정 대상으로 변환하지 않는다. PC와 폰 모두 실제 발송 이전에 본문·대상·업무 회선을 사용자에게 보여준다.

## 12. Android 기존 Play 앱 업데이트와 데이터 이행

사용자 확인 사실: 기존 앱은 Play 승인·비공개 게시·시험을 마쳤다. 이 설계는 같은 등록 앱의 버전업이다. 기존 배포 승인 여부를 다시 미확보로 기록하지 않는다.

확인한 소스는 applicationId `shop.voicecap.smsbridge`, namespace `com.voicecap.sms`, versionCode 7, versionName 1.3.3이다. 업데이트 applicationId와 Play App Signing 체계를 유지한다. AAB 업로드 키와 실제 사용자 설치 APK의 앱 서명 키를 구분한다. 새로 키를 생성해 기존 키를 덮어쓰지 않는다.

다음 versionCode는 Play 전체 트랙의 최고값보다 높게 정한다. 코드의 7만 보고 무조건 8을 쓰지 않는다. 현재 compileSdk 35/targetSdk 36은 환경 정비 때 compileSdk를 targetSdk 이상으로 맞추고 SDK·AGP·Gradle·JDK·Kotlin·Room 조합을 고정한다.

기존 `voicecap_sms_bridge` SharedPreferences의 device_id, device_token, workspace_id, device_name, 동의, 업무 연락처, uploaded 표식을 읽어 이행한다. 자격증명은 보안 저장소로 이동 후 복구 시험을 통과한 뒤 기존 저장 위치를 정리한다. 단순 업데이트로 기기·installation ID를 새로 만들지 않는다. 이전에 installation_id가 없으면 한 번만 발급해 저장한다.

기존 SENT는 전송 콜백 성공의 증거가 아니므로 `LEGACY_SUBMITTED` 이행 표식을 별도 보관한다. 기존 발송 이력을 읽는 과정에서 새 QUEUED 작업을 생성하지 않는다. Room에는 명시적인 DB migration과 시험을 두고 데이터 삭제 후 재생성하는 fallback을 사용하지 않는다.

Play 비공개 트랙에서 기존 설치본을 삭제하지 않고 업데이트한다. 연결 유지·기존 문자·동의·미전송 기록·기본 역할·직접 답장·PC 요청·재부팅을 시험한다. 변경한 권한·데이터 사용이 있을 때만 기존 스토어 선언과의 차이를 점검한다.

## 13. 배포·관측·이행

개발과 시험용 Supabase 환경을 운영과 분리한다. 새 DB 변경은 추가 migration으로 기록하고 운영 migration을 과거로 되돌려 덮어쓰지 않는다. 민감정보를 제외한 합성 판매자 A/B·방송 회차를 사용한다.

workspace별 `workflow_version`을 두고 v2 전환 때 구형 판매/출력/SMS 생성 경로를 서버에서도 막거나 호환 어댑터로 전달한다. 같은 작업공간에서 구버전 폰과 신버전 폰이 같은 SMS 작업을 각각 소비하지 않게 한다. 전환 전 pending/SUBMITTING/UNKNOWN 작업을 정리·매핑한다.

지표는 전사 확정 조각 수/로컬 대기/서버 ACK/누락 구간, 댓글 수집·적재 지연, sync cursor 지연, 판매 command 중복·충돌, 문자 대기·부분 실패·UNKNOWN, 출력 UNKNOWN, device heartbeat, STT 사용량·비용을 포함한다. 원문 손실을 UI가 정상이라는 이유로 숨기지 않는다.

댓글·전사·문자 원문은 임의로 샘플링 삭제하지 않는다. 보관·아카이브 정책은 작업공간 설정과 요금제에 명시하고 검색·내보내기·파일 복구를 포함한다. 원문 보관을 모델 개선 데이터 제공 동의로 해석하지 않는다.

### 13.1 화면 캡처·상품사진·첨부

화면 캡처는 대상 창/영역과 사용자가 누른 시각을 기록하고 방송 회차·상품·판매에 연결한다. Android 상품사진과 수신 MMS도 같은 media 계약을 쓴다. 파일은 우선 로컬에 보관하고 메타데이터+해시+업로드 상태를 기록한 후 private Storage에 올린다. 서버가 파일 업로드를 확인한 뒤 AVAILABLE로 바꾸며, 경로만 생성한 상태를 업로드 완료로 표시하지 않는다.

`media_assets`에는 workspace, owner entity, origin device, capture time, object key, content type, byte count, hash, state를 둔다. 이미지 썸네일과 원본을 구분하고 허용 크기·형식·열람 권한을 검사한다. 서명 URL은 짧게 발급한다. 로컬 큐에 남은 파일은 앱 재시작 후 이어서 올린다. 매번 Base64 이미지 전체를 판매 행이나 Realtime 메시지에 넣지 않는다.

### 13.2 상용 운영과 업데이트

이용권은 서버가 검증한 결제 공급자의 결과·서명 webhook으로 갱신한다. 클라이언트가 ‘결제 완료’를 요청했다는 이유만으로 잔액이나 플랜을 변경하지 않는다. webhook ID 중복 방지, 환불·해지·실패·사용량 한도·고객 지원용 감사 기록을 둔다. 한도 초과 시 새 유료 STT 세션을 제한할 수 있지만 이미 받은 원문·거래·문자 상태 업로드를 버리는 이유로 사용하지 않는다.

초기 과금 단위는 판매자 workspace를 기준으로 제안한다. 다중 관리 PC 사용을 전제로 하고, 동시 방송 수·STT 사용량·보관 용량·추가 업무 회선은 별도 정책으로 관리한다. 요금과 상한 숫자는 실제 원가·시험 결과를 보고 정하며 이 문서에서 확정 판매가를 만들지 않는다.

Windows는 서명된 설치·업데이트 패키지와 버전별 점진 배포를 제공한다. 방송/출력 실행 중 강제 업데이트하지 않으며 로컬 DB 이행 실패 시 원본을 보존하고 진단한다. Android는 기존 Play 앱 비공개 트랙에서 먼저 업데이트한다. 서버는 지원 클라이언트 버전과 workflow_version을 판정해 위험한 구형 실행 경로를 막는다. 서버 장애 대응, DB와 Storage의 별도 복원 시험, 고객별 export·삭제·보관 정책을 출시 체크리스트에 포함한다.

로그에는 토큰·전화번호 전체·문자/전사 원문을 기본 출력하지 않는다. 필요한 업무 원문은 접근 통제한 업무 저장소에 두고, 분석/모니터링 로그와 분리한다. PC/Android 앱 제거·디스크 고장 이전에 클라우드에 도달하지 못한 자료까지 복구를 보장할 수 없으므로 대기 상태와 백업 범위를 사용자에게 명확히 표시한다.

## 14. 개발 순서와 출시 기준

1. 기존 앱 업데이트 식별·환경·시험 데이터와 API 계약 고정.
2. 작업공간 권한·독립 로그인·원자적 명령·동기화 기반.
3. 전체 전사·댓글 시간 저장과 서버 조회를 합성 데이터로 완성.
4. Android Room·수신·직접 답장·PC 발송·전송 결과·기존 앱 업데이트.
5. Windows 방송·Soniox·수집 권한·판매·실제 출력 연결.
6. 정산·배송·AI 정정·운영자·결제·사용량·장애 복구와 부하 시험.

세부 절차는 [작업지시서](C:/dev/voice-pin-anti/docs/plans/2026-09-14-saas-redesign/02_JUNIOR_WORK_ORDERS.md), 완료 판정은 [인수시험](C:/dev/voice-pin-anti/docs/plans/2026-09-14-saas-redesign/03_ACCEPTANCE_TESTS.md)을 따른다. 자동화 시험, 실제 통신사 SMS 왕복, 실제 프린터, 기존 Play 설치본의 업데이트 시험을 구분해서 기록한다.

## 15. 공식 확인 자료

- Soniox의 중간/확정 토큰 구분은 [실시간 전사 문서](https://soniox.com/docs/stt/rt/real-time-transcription)를 기준으로 공급자 어댑터에서 처리한다.
- 단기 키 제한과 접속·스트림 만료 차이는 [Soniox 단기 키](https://soniox.com/docs/guides/temporary-api-keys)를 따른다.
- 변경 통지 채널 설계는 [Supabase Broadcast 가이드](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes), 권한 경계는 [RLS 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)를 참고한다.
- Android 업데이트의 서명은 [앱 서명](https://developer.android.com/studio/publish/app-signing), 버전은 [앱 버전 관리](https://developer.android.com/studio/publish/versioning)를 따른다.
- 기본 문자 앱과 Provider 역할은 [Android Telephony](https://developer.android.com/reference/android/provider/Telephony), 로컬 데이터 이행은 [Room migration](https://developer.android.com/training/data-storage/room/migrating-db-versions)을 기준으로 검증한다.
- FCM의 백그라운드 실행 기대치는 [Android 메시지 우선순위](https://firebase.google.com/docs/cloud-messaging/android-message-priority)를 확인한다.
- .NET 10 LTS 선택은 [Microsoft 지원 주기](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)를 확인했다. Windows 전용 UI라는 제약은 [WPF 개요](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/overview/)를 따른다.
