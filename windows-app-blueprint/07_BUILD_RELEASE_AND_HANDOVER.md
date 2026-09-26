# 07. 개발환경·설치·업데이트·운영 인계

[처음으로](README.md) · [기능 이전표](01_SCOPE_AND_FEATURE_PARITY.md) · [구현·검증 계획](06_IMPLEMENTATION_AND_TEST_PLAN.md)

이 장의 폴더와 npm script는 **향후 구현할 새 프로젝트의 계약**이다. 현재 `windows-app-blueprint/`에서 `npm run dev`를 실행하면 앱이 생기는 것이 아니다. 문서 및 `prototype/index.html` 외의 실제 Windows 코드 프로젝트는 이번 작업에서 만들지 않았다.

## 7.1 개발자는 무엇을 준비하는가

| 준비물 | 기준 | 준비 이유 |
|---|---|---|
| 개발 PC | Windows 11 x64 기준 환경 | 최초 정식 시험·패키지 대상 |
| Git | 저장소 접근 가능한 버전 | 기존 기준 commit과 신규 변경 추적 |
| Node/npm | 기존 검증 환경 Node 24.12.0 / npm 11.6.2에서 시작 | 기존 코드 재현 후 새 앱 기준 버전 고정 |
| Electron | 기존 helper lock의 44.0.0은 이전 실험 기준 | 출시 시 지원 버전으로 재검증; 숫자만 올리지 않음 |
| 에디터 | TypeScript/React/JSON 지원 | IPC·도메인 타입 확인 |
| Windows SDK/빌드 도구 | 필요한 네이티브 모듈의 요구조건에 맞춤 | SQLite·오디오 native addon을 빌드해야 할 때 |
| Python | 선택한 STT 런타임 전용 패키지 구성 | 시스템 Python과 앱 STT 환경 분리 |
| Supabase | 별도 개발·검증 프로젝트 | 실제 거래·RLS·Storage·migration 시험 |
| 테스트 장치 | 마이크, 프린터(출력 사용 시), Android/SIM(문자 사용 시) | 가짜 응답으로 검증할 수 없는 기능 확인 |

이는 Windows 10 또는 ARM64에서 동작하지 않는다는 단정이 아니다. 최초 합격 환경을 고정하는 것이다. 다른 OS/아키텍처는 Electron 지원 범위, 서명, 드라이버, STT 바이너리, SQLite addon, 실기기 시험 결과를 확보한 뒤 지원표에 추가한다.

시스템의 Python·JDK·전역 Node 설정을 앱 설치 프로그램이 임의로 변경하지 않는다. 최종 사용자에게 Git·Node·개발 SDK 설치를 요구하지 않는 것이 설치 앱의 목표다. 오프라인 STT를 선택하면 앱의 모델 관리자에서 필요한 런타임/모델을 준비하고 진행률·용량·실패 이유를 표시한다.

## 7.2 향후 코드 프로젝트 구조

아래는 제안 구조다. 이름을 바꿀 경우 02/03의 책임 경계가 유지되는지 확인하고 설계 변경 기록에 남긴다.

```text
voicecap-studio/
├─ apps/desktop/
│  ├─ main/                    # 창, 로그인, 파일 선택, OS 기능, IPC 권한
│  ├─ preload/                 # renderer에 노출할 제한된 API
│  ├─ renderer/                # React 화면, 컴포넌트, 스타일
│  ├─ resources/               # 아이콘, 동봉 글꼴, 전표 템플릿
│  └─ electron-builder.yml     # Windows 패키지 설정
├─ packages/
│  ├─ domain/                  # 판매·상품·고객·회차의 순수 규칙
│  ├─ contracts/               # IPC/API DTO, JSON schema, event 버전
│  ├─ broker/                  # 업무 요청·동기화·복구·단일 DB 소유자
│  ├─ storage/                 # SQLite migration, repository, outbox
│  ├─ cloud/                   # 인증된 Supabase 업무 API adapter
│  ├─ comments/                # TikTok 수집·정규화·durable ingest
│  ├─ audio/                   # 입력 선택·PCM·세션·장치 복구
│  ├─ stt/                     # Python/Vulkan 감독자·모델 manifest
│  ├─ printing/                # 작업 큐·전표·Windows spool adapter
│  ├─ ai/                      # 규칙/클라우드/PC AI 요청·검증
│  └─ ui/                      # 토큰·기본 UI·접근성 패턴
├─ supabase/
│  ├─ functions/               # 인증·업무 command·장치·AI
│  └─ migrations/              # 신규 환경/기존 환경 전환 migration
├─ runtime/                    # 런타임 manifest 및 조립 도구, 개발용 실제 키 없음
├─ scripts/                    # 개발·서명·업데이트 검증 명령
├─ tests/unit/
├─ tests/integration/
├─ tests/e2e/
├─ tests/fixtures/             # 가짜 고객·댓글·음성 및 권한 시나리오
├─ docs/                       # 개발/운영/변경 기록
├─ package.json
└─ package-lock.json
```

초보 개발자를 위해 처음부터 여러 npm 패키지로 배포할 필요는 없다. npm workspace 안에서 책임별 디렉터리와 import 경계를 분리하면 된다. broker·domain의 함수가 React 컴포넌트를 import하지 않게 검사한다. `packages/ui`의 범용 UI가 Supabase 키나 Node 파일 API를 알게 만들지 않는다.

현재 도우미의 `stage-server.cjs`처럼 동작하는 코드 파일을 수작업 배열로 복사하는 구조는 새 앱의 기본 빌드 방식으로 사용하지 않는다. 의존성 그래프 기반 빌드와 런타임 자산 manifest를 사용하고, 누락 자산은 패키지 검증 단계에서 실패시킨다.

## 7.3 기존 파일은 어떻게 옮기는가

| 기존 자산 | 새 위치/전환 | 먼저 확인할 것 |
|---|---|---|
| `src/pages`, `components` | renderer와 공통 UI | 01 기능 ID와 05 화면 spec 대응 |
| `src/services/*Parser`, matcher | domain | 브라우저 전역 의존 제거, 기존 단위 검사 재사용 |
| `SalesContext`, `ProductSalesContext` | 화면 read model + broker command | 두 판매 쓰기 경로 통합, 누락 메타 보존 |
| `remoteWorkspaceService` | cloud adapter·server command | renderer 직접 DB 쓰기·클라이언트 역할 신뢰 제거 |
| `CommentCaptureContext` | renderer 댓글 view + comments service | 두 producer 대신 하나의 업로드 책임 |
| `server/index.js` | comments/audio/IPC 서비스 조립 | HTTP 라우트와 업무 기능 분리 |
| `sttBridge`, `stt_worker.py`, Vulkan | stt package/runtime | 경로·ABI·버전·다운로드 해시·worker 종료 |
| helper main/preload | 새 main/preload에 필요한 기능 선별 | 이전 appId, hardcoded URL, taskkill 제거 |
| print UI/CSS | resources 전표 + printing adapter | 종이 규격·DPI·revision·중복 출력 상태 |
| 기존 migrations/functions | 신규 backend baseline + 전환 migration | 실제 운영 스키마와 코드 차이를 먼저 확인 |
| Android | 기존 companion 연동 유지 | 기존 capability·계약 버전 호환 시험 |
| 기존 테스트 | 도메인/계약 회귀 테스트로 이관 | 테스트 이름이 아닌 실제 검증 범위 확인 |

파일을 복사한 뒤 import가 통과하는 것과 기능 이전 완료는 다르다. 예를 들어 `printJobStore`를 복사했어도 worker가 시작되지 않으면 출력 큐는 실행되지 않는다. 02의 시작·중지 수명주기와 06의 실행 검사를 함께 구현한다.

## 7.4 구현할 개발 명령 계약

다음 명령은 **새 package.json에 구현할 이름**이다. 구현 전에는 실행하지 않는다.

| 제안 명령 | 수행할 일 | 성공 조건 |
|---|---|---|
| `npm ci` | lock 기준 의존성 복원 | lock 불변, native addon 준비 여부 확인 |
| `npm run dev` | renderer 개발 서버 + main/preload + 로컬 서비스 | 별도 helper 실행 없이 새 앱 기동 |
| `npm run typecheck` | main/preload/renderer/공유 계약 타입 검사 | 웹 src만 검사하지 않음 |
| `npm run test:unit` | 순수 판매·파싱·상태 로직 | 외부 서비스·사용자 데이터 접근 없음 |
| `npm run test:integration` | 테스트 DB·IPC·큐·worker 통합 | 재시작·중복·충돌 시나리오 통과 |
| `npm run test:e2e` | 패키징된 앱의 UI·기능 전이 | 핵심 판매 및 모든 화면 접근 시나리오 |
| `npm run build` | main/preload/renderer 및 worker 조립 | 코드·필수 runtime manifest 포함 |
| `npm run package:win` | 로컬 설치 없는 unpacked 패키지 | 깨끗한 Windows 계정에서 기동 |
| `npm run dist:win` | 서명 가능한 Windows 설치 파일 | 서명·자산·업데이트 검증 포함 |

최종 CI에는 package smoke test를 포함한다. Electron의 Node와 개발 PC Node는 ABI가 다를 수 있으므로 SQLite 등 네이티브 모듈을 개발 Node에서만 성공시켜서는 안 된다. Electron 대상 빌드/재빌드 및 패키지 로드 시험을 통과해야 한다. ABI 호환에 따라 addon 방식 또는 별도 broker 프로세스를 선택하는 세부 결정은 02/03을 따른다.

## 7.5 환경과 비밀값

환경을 `development`, `staging`, `production`으로 나눈다. 앱 화면의 설정·진단에 현재 환경과 서버 별칭을 표시하여 운영과 시험을 혼동하지 않게 한다.

| 값 | 저장 위치 | 앱에 동봉 가능한가 |
|---|---|---|
| Supabase URL/공개 client key | 서명된 비밀 아닌 앱 설정 | 가능. 권한은 서버/RLS가 검사 |
| API 계약 버전·업데이트 채널 | 앱 설정·manifest | 가능 |
| 사용자 refresh token | main이 OS 보호 저장소로 보관 | 설치 파일에 넣지 않음 |
| PC 기기 자격 | main 기기 등록 후 보호 저장 | 전 사용자 공용 값 동봉 금지 |
| 사용자별 STT/AI 자격 | 사용할 실행 위치에 맞춘 보호 저장 | renderer/일반 로그에 노출하지 않음 |
| Supabase service role | Edge/배포 서버 비밀 환경 | 앱·APK·renderer에 절대 동봉하지 않음 |
| 연결코드 pepper | 서버 비밀 환경 | 앱에 동봉하지 않음 |
| 코드 서명/배포 자격 | CI 또는 서명 담당 환경 | 앱 패키지에 들어가지 않음 |

앱에는 API key 한 개를 추출하면 모든 판매자 작업공간을 관리할 수 있는 자격을 넣지 않는다. Electron ASAR는 파일 묶음이며 비밀 저장소가 아니다. 개발 중 `.env`를 쓰더라도 renderer bundle과 installer에 실제 비밀값이 들어가는지 산출물을 검사한다.

## 7.6 개발용 데이터와 테스트 격리

테스트는 전용 `userData` 디렉터리와 별도 workspace에서 실행한다. 테스트 시작 시 디렉터리를 분리하는 단일 helper를 만들고, STT·printing·broker·로그가 모두 그 경로를 사용하게 한다.

기존 `sttBridge` 테스트는 실제 사용자 설정을 변경하는 부작용이 발견되었다. 새 앱 테스트는 아래 조건을 만족해야 한다.

1. 명시한 테스트 경로 밖에 설정·DB·전표·음성을 쓰지 않는다.
2. 실제 Windows 기본 프린터와 실제 SMS 번호를 자동 선택하지 않는다.
3. 임시 폴더는 매 테스트 run마다 고유하고, 실패 자료를 유지할 수 있다.
4. 정리 도구는 workspace 안의 검증한 절대 경로만 정리한다.
5. 유료 STT/AI·실문자·실인쇄 시험은 별도 opt-in suite로 나눈다.

테스트 fixtures에는 서로 다른 두 workspace, 같은 닉네임의 다른 사람, 두 회차의 같은 상품번호, 만료 토큰, 실패한 업로드, 이미 처리된 operation, 결과 불명확한 인쇄를 포함한다.

## 7.7 설치 프로그램과 첫 실행

기본 설치 단위는 `VoiceCAP Studio Setup.exe`, 앱 식별자 제안은 `shop.voicecap.studio`다. 파일명은 실제 서명/릴리스 파이프라인 구현 때 확정한다. 기존 `shop.voicecap.commenthelper`와 다른 앱으로 등록하여 사용자의 기존 설정을 뜻하지 않게 덮어쓰지 않는다.

설치 패키지에는 renderer, main, 필요한 서비스 코드, 검증한 바이너리, 글꼴 라이선스와 고지, 모델 manifest를 포함한다. 대형 STT 모델은 선택 다운로드가 기본이며, 별도 오프라인 설치 묶음을 제공할 수 있다. 다운로드는 임시 파일에 받고 해시 확인 후 원자적으로 이름을 바꾸어 미완성 모델을 로드하지 않는다.

첫 실행 단계의 상태와 합격 조건:

| 단계 | 사용자에게 보일 것 | 실패 처리 |
|---|---|---|
| 앱 확인 | 버전·서명된 runtime 자산 상태 | 손상 파일명/재설치 안내; 무한 재시작 금지 |
| 로그인 | 스토어 선택과 로그인 결과 | 재시도·비밀번호 재설정·지원 |
| 로컬 데이터 준비 | 캐시/큐 준비, 남은 복구 작업 | migration 오류 시 원본 백업 보존 |
| 방송 계정 | 수집 계정과 실제 연결 상태 | 오프라인 방송/자격오류/네트워크 구분 |
| 소리 | 입력 장치·레벨·짧은 전사 시험 | 권한·장치 없음·잘못된 입력 안내 |
| 프린터 | 장치 선택·용지·테스트 라벨 | 건너뛰기 또는 재설정 |
| 휴대폰 | 연결코드·상태·권한 | 문자 미사용이면 건너뛰기 |
| 준비 완료 | 선택한 구성과 시작 버튼 | 해결이 필요한 항목만 강조 |

앱 시작 시 다른 프로세스가 포트를 점유했다는 이유로 `taskkill`하지 않는다. 기존 helper가 켜져 있다면 연결 센터에서 중복 실행 가능성을 안내하고 정상 종료 방법을 제공한다. 새 앱이 소유하는 자식 프로세스만 수명주기를 관리한다.

## 7.8 실제 화면·장치 권한 설정

| 기능 | 사용자가 결정하는 것 | 저장 범위 |
|---|---|---|
| 댓글 | TikTok 계정·회차 연결·재시도 | workspace 설정 + 기기 런타임 상태 |
| 오디오 | 마이크/시스템 소리·장치·음량 확인 | 해당 PC 설정 |
| 캡처 | 선택 화면/창·영역·해상도 | source ID는 PC별, 영역은 재검증 |
| STT | 공급자·모델·CPU/GPU·품질 시험 | workspace 기본 + PC override |
| 프린터 | Windows 장치·용지·여백·자동 출력 | PC 설정, 기본 출력 기기 서버 등록 |
| Android | 기기 연결·문자 및 판매 capability | 서버 장치 등록 |
| AI | 작업 종류·실행 위치·제공자·검증 결과 | 권한 있는 설정 + PC local endpoint |

다른 PC에 Windows 장치 ID·프린터명·GPU 번호를 그대로 복사해 자동 활성화하지 않는다. 이전된 설정에는 “다시 확인 필요”를 표시하고 실제 장치와 연결한 후 적용한다.

## 7.9 기존 사용자 데이터 이전

앱 안에 “기존 VoiceCAP에서 가져오기” 흐름을 설계한다. 서버 이력과 로컬 개인 설정을 구분한다.

1. 동일 Supabase 계정으로 로그인하여 서버 workspace·판매·회차·댓글을 다시 조회한다.
2. 기존 웹의 규칙·훈련 문장·캡처 영역이 workspace settings에 동기화되었는지 확인한다.
3. 웹 내보내기 파일을 선택하면 schema 버전·파일 크기·workspace 표시를 검사한다.
4. 가져올 범주, 건수, 중복, 손실될 필드, 영향받는 설정을 미리 보여준다.
5. 실행 전 새 로컬 DB snapshot과 import 작업 ID를 만든다.
6. 확인한 범주만 적용하고 중간 실패 시 staging을 폐기하거나 되돌린다.
7. 서버에 있는 판매를 로컬 과거 `dadryeo_sales` 데이터로 덮어쓰지 않는다.
8. 이전 결과와 제외한 항목을 보고서로 남긴다.

| 항목 | 이전 정책 |
|---|---|
| 판매/고객/댓글·이미지 | 서버 원본 재조회. 독립 서버 이전은 별도 백업 복원 |
| 규칙/훈련 문장/캡처 영역 | 원격 동기화 우선, 가져오기 비교·확정 |
| 기존 Base64 자동로그인 비밀번호 | 읽어서 재사용/이관하지 않음. 새 로그인 요청 |
| helper STT 설정 | 값만 읽는 전용 importer, 장치 재검증 |
| 모델 파일 | manifest·해시·형식 일치 시 재사용; 다르면 재다운로드 |
| 프린터 설정/출력 이력 | 원본 보존 후 선택 가져오기, 중복 출력 키 정규화 검증 |
| legacy PC 문자 JSON | 별도 명시적 가져오기·중복 미리보기; 클라우드 원본과 혼합 금지 |
| 일시 세션·debug 로그·WAV | 기본 이전 제외 |

백업 화면에는 “이 PC 설정/미동기화 작업”과 “서버 자료 내보내기”를 따로 표시한다. 완전한 서버 백업 기능을 구현하지 않은 상태에서 버튼 이름을 “전체 데이터 백업”으로 사용하지 않는다.

## 7.10 업데이트와 데이터 버전

업데이트에는 세 가지 버전이 있다. 앱 코드 버전, 로컬 DB 스키마 버전, 서버 계약 버전이다. 셋 중 하나만 바뀌어도 나머지와의 호환성을 확인한다.

```text
업데이트 검색 → 버전·서명·해시 검증 → 백그라운드 다운로드
  → 방송/음성/출력/문자 작업 상태 확인
  → 작업 중이면 설치 보류
  → 사용자가 재시작 가능한 때 확인
  → 큐의 로컬 영속화 완료 및 snapshot → worker 정상 종료 → 설치
  → 로컬 migration → 자체 점검 → 복구 결과 표시
```

여기서 큐 저장 완료는 SQLite에 안전하게 기록되었다는 뜻이다. 원격 ACK가 없는 모든 대기 작업이 소진될 때까지 무조건 기다리지는 않는다. 오프라인에서는 미전송 operation과 dependency를 보존하고, 새 버전이 기존 명령 형식을 읽을 수 있는지 확인한다.

앱 파일을 이전 버전으로 되돌리는 것과 DB를 되돌리는 것은 다르다. 이전 앱이 새 DB 스키마를 읽을 수 없다면 자동 실행하지 않는다. migration 이전 snapshot과 서버 계약 호환 정책으로 복구한다. 서버에서 이미 처리한 거래는 앱 rollback으로 취소하지 않는다.

방송 중 업데이트 자동 재시작을 기본 허용하지 않는다. 긴급 보안 업데이트도 현재 작업 상태·저장 결과를 알려주고 전환 절차를 명시한다. 업데이트 manifest에서 임의 실행 명령을 받아 수행하는 구조를 만들지 않는다.

## 7.11 로그·진단·장애 지원

사용자가 설정 → 연결 센터 → 진단 보고서에서 선택해 저장할 수 있게 한다.

| 포함 | 기본 제외 |
|---|---|
| 앱/계약/DB 버전, OS/CPU/GPU 이름 | 토큰·API 키·비밀번호 |
| 연결 상태와 최근 오류 코드 | 고객 전체 전화번호·주소·문자 원문 |
| operation ID, 작업 상태, 지연/재시도 수 | 오디오 녹음·스크린샷 원본 |
| 모델 manifest와 해시 확인 결과 | 카드번호·CVC |
| 프린터명/용지 규격·작업 상태 | 판매자 브라우저 전체 저장소 |

필요한 예외 첨부는 항목·포함정보·대상을 사용자에게 보여준 뒤 선택하게 한다. 앱이 자동으로 외부 지원자에게 메시지나 진단 자료를 전송하는 흐름은 기본 설계에 포함하지 않는다.

| 장애 | 1차 조치 | 보존할 것 |
|---|---|---|
| renderer 멈춤 | UI 재시작·마지막 view 복원 | broker 미전송 큐·작업 ID |
| STT worker 종료 | 세대 증가·입력 중지 안내·제한 재시도 | 마지막 승인 전사와 오류 코드 |
| 댓글 연결 끊김 | jitter backoff·현재 회차 유지 | 마지막 ack 위치·pending 댓글 |
| 서버 오류 | outbox 유지·재시도/상태 조회 | request hash·operation ID |
| DB 손상/migration 실패 | 쓰기 차단·snapshot 복원 안내 | 손상 원본·백업·서버 확정 자료 |
| 출력 결과 불명확 | UNKNOWN으로 보존·수동 확인 | 전표 해시·판매 revision·spool 정보 |
| 앱 강제 종료 | 다음 시작에서 복구 단계 실행 | WAL/outbox/작업 상태 |

## 7.12 성능 검증 환경 기록

성능 목표 수치는 [06](06_IMPLEMENTATION_AND_TEST_PLAN.md)을 기준으로 한다. “빠르다” 대신 다음 조건을 함께 기록한다.

```text
PC/Windows 빌드:
CPU/RAM/GPU/드라이버:
모니터 해상도/배율:
앱/모델/계약 버전:
동시 실행 방송 프로그램:
네트워크 지연/단절 조건:
댓글 초당 유입/총 건수:
판매/이미지 개수:
앱 첫 기동/두 번째 기동:
UI 반응 p50/p95:
댓글 수신→표시/음성종료→후보 지연:
프로세스별 메모리/CPU/GPU:
오디오 drop/중복/미전송/충돌 수:
```

모델이 작은 대신 닉네임·금액 오류가 늘었다면 단순 지연 감소를 성공으로 판정하지 않는다. 성능은 판매 정확도·회복성·사용자 작업 시간과 함께 평가한다.

## 7.13 최종 인계 패키지

- 기준 소스 SHA, 버전 고정 파일, 빌드 방법과 실제 CI 결과
- 01의 모든 기능 ID에 대한 이전 결과와 05 화면별 검증 기록
- 서명된 설치 파일·체크섬·업데이트 채널·변경 목록
- 서버 migration·Edge Function 버전·환경변수 이름 목록
- 모델/바이너리 manifest·라이선스·배포/재다운로드 정책
- 사용자용 첫 실행·방송 시작·보류 해결·정산·장치 설정 안내
- 장애 로그 위치·복원 방법·인쇄/문자 결과 불명확 처리 절차
- 별도 보관하는 서명키·배포권한 인수 경로
- 실기기 검증표와 지원하지 않는 OS/장치/기능의 명시

최종 사용자는 댓글 도우미를 별도로 설치하지 않고 앱을 실행해 전체 판매 업무를 시작할 수 있어야 한다. 인터넷·프린터·휴대폰 등 실제 필요한 외부 자원은 연결 단계에서 정확하게 설명한다.
