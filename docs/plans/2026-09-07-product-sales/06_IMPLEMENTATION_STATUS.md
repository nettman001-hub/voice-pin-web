# 상품 중심 판매관리 구현 상태

작성일 2026년 9월 8일 · 단일 Antigravity 에이전트 진행 기록

이 문서는 계획이 아니라 실제 구현 상태와 검증 증거를 남기는 작업 장부다. 에이전트는 작업을 시작할 때 현재 값을 직접 확인해 채우고, 각 체크포인트와 의미 있는 커밋을 완료할 때 갱신한다. 테스트를 실행하지 않았거나 실제 기기·프린터를 확인하지 않았다면 `PASS`로 기록하지 않는다.

## 1 실행 기준

| 항목 | 현재 값 |
| --- | --- |
| 상태 | NOT_STARTED |
| 현재 체크포인트 | G0 |
| 작업 경로 | 시작 시 기록 |
| 기능 브랜치 | 권장 `codex/product-sales-single-agent` |
| 시작 HEAD | 시작 시 `git rev-parse --short HEAD` 결과 기록 |
| origin/main | 시작 시 fetch 후 기록 |
| 작업 트리 | 시작 시 `git status --short` 결과 기록 |
| 계약 버전 | 1 |
| API 버전 | 1 예정 |
| 시험 workspace | 미정 |
| Android 시험 기기 | 미확보 |
| 실제 프린터 | 미확보 |

상태 값은 `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `PASS`, `FAIL`, `NOT_APPLICABLE`만 사용한다. `BLOCKED`와 `FAIL`에는 재현 절차와 다음 행동을 반드시 적는다.

## 2 체크포인트

| 체크포인트 | 작업 | 상태 | 완료 커밋 | 검증 증거와 남은 항목 |
| --- | --- | --- | --- | --- |
| G0 | 환경 기준, ANDROID-01, CORE-01 계약 Schema·fixture | NOT_STARTED |  |  |
| G1 | CORE-02~CORE-05 DB·인증·상품·댓글 API | NOT_STARTED |  |  |
| G2 | ANDROID-02~ANDROID-06, CORE-06~CORE-08 | NOT_STARTED |  |  |
| G3 | CORE-09~CORE-10, ANDROID-07~ANDROID-09 | NOT_STARTED |  |  |
| G4 | ANDROID-10, CORE-11~CORE-12, T01~T22 | NOT_STARTED |  |  |

## 3 티켓 기록

| 티켓 | 상태 | 커밋 | 실행한 테스트 | 미검증·차단 사항 |
| --- | --- | --- | --- | --- |
| ANDROID-01 | NOT_STARTED |  |  |  |
| CORE-01 | NOT_STARTED |  |  |  |
| CORE-02 | NOT_STARTED |  |  |  |
| CORE-03 | NOT_STARTED |  |  |  |
| CORE-04 | NOT_STARTED |  |  |  |
| CORE-05 | NOT_STARTED |  |  |  |
| ANDROID-02 | NOT_STARTED |  |  |  |
| ANDROID-03 | NOT_STARTED |  |  |  |
| ANDROID-04 | NOT_STARTED |  |  |  |
| ANDROID-05 | NOT_STARTED |  |  |  |
| ANDROID-06 | NOT_STARTED |  |  |  |
| CORE-06 | NOT_STARTED |  |  |  |
| CORE-07 | NOT_STARTED |  |  |  |
| CORE-08 | NOT_STARTED |  |  |  |
| CORE-09 | NOT_STARTED |  |  |  |
| CORE-10 | NOT_STARTED |  |  |  |
| ANDROID-07 | NOT_STARTED |  |  |  |
| ANDROID-08 | NOT_STARTED |  |  |  |
| ANDROID-09 | NOT_STARTED |  |  |  |
| ANDROID-10 | NOT_STARTED |  |  |  |
| CORE-11 | NOT_STARTED |  |  |  |
| CORE-12 | NOT_STARTED |  |  |  |

## 4 필수 검증

| 대상 | 명령 또는 방법 | 상태 | 실행 환경과 결과 |
| --- | --- | --- | --- |
| 웹 | 저장소 루트 `npm run build` | NOT_STARTED |  |
| 서버 | `server/`의 실제 제공 테스트 명령 | NOT_STARTED |  |
| PC 도우미 | `desktop/comment-helper/`의 실제 제공 테스트 명령 | NOT_STARTED |  |
| Android debug | `android/voicecapSMS`에서 `.\gradlew.bat :app:assembleDebug` | NOT_STARTED |  |
| Android unit/lint | `testDebugUnitTest`, `lintDebug` | NOT_STARTED |  |
| Android 기기 | `connectedDebugAndroidTest`와 수동 SMS 회귀 | NOT_STARTED |  |
| DB·RLS | 빈 개발 DB, 기존 데이터 복제 DB, cross-workspace와 권한 거절 | NOT_STARTED |  |
| 인쇄 | 실제 용지, lease 경쟁, UNKNOWN 복구와 중복 출력 방지 | NOT_STARTED |  |
| 통합 인수 | 05 문서 T01~T22 | NOT_STARTED |  |

## 5 배포 상태

| 대상 | 상태 | 적용 버전·환경 | 증거·복구 방법 |
| --- | --- | --- | --- |
| migration | NOT_STARTED | 배포 전 승인 필요 |  |
| RPC·RLS | NOT_STARTED | 배포 전 승인 필요 |  |
| sales-api Edge Function | NOT_STARTED | 배포 전 승인 필요 |  |
| PC 도우미 | NOT_STARTED | 배포 전 승인 필요 |  |
| 웹 | NOT_STARTED | 배포 전 승인 필요 |  |
| Android | NOT_STARTED | 배포 전 승인 필요 |  |

`main` push, 운영 DB 변경, Edge Function 배포, 설치 파일 배포, Play 배포는 코드 완료와 별도다. 사용자 승인 없이 이 표의 배포 상태를 `PASS`로 변경하지 않는다.

## 6 결정·차단·변경 기록

| 날짜 | 요구사항·티켓 | 종류 | 내용 | 영향 파일·테스트 | 다음 행동 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-08 | 실행 방식 | 결정 | 하나의 Antigravity 에이전트와 하나의 기능 브랜치에서 순차 구현 | 문서 전체 | G0부터 시작 |

계약 변경은 이전 규칙, 새 규칙, 이유와 서버·웹·Android·PC 도우미 영향을 적는다. 작업을 재개할 때는 이 문서와 `git log`, `git status`를 대조하며 표만 보고 완료를 추정하지 않는다.
