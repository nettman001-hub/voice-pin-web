# 상품 중심 판매관리 구현 상태

작성일 2026년 9월 8일 · 단일 Antigravity 에이전트 진행 기록

이 문서는 계획이 아니라 실제 구현 상태와 검증 증거를 남기는 작업 장부다. 에이전트는 작업을 시작할 때 현재 값을 직접 확인해 채우고, 각 체크포인트와 의미 있는 커밋을 완료할 때 갱신한다. 테스트를 실행하지 않았거나 실제 기기·프린터를 확인하지 않았다면 `PASS`로 기록하지 않는다.

## 1 실행 기준

| 항목 | 현재 값 |
| --- | --- |
| 상태 | IN_PROGRESS |
| 현재 체크포인트 | G0 |
| 작업 경로 | C:\dev\voicecap-web |
| 기능 브랜치 | `codex/product-sales-single-agent` |
| 시작 HEAD | `49f6cf0` |
| origin/main | `ad97ca2` (local main is 1 commit ahead: `49f6cf0`) |
| 작업 트리 | clean (시작 시 변경사항 없음) |
| 계약 버전 | 1 |
| API 버전 | 1 예정 |
| 시험 workspace | W1 (테스트), W2 (교차 검증) |
| Android 시험 기기 | 미확보 (adb devices: 연결 장치 없음) |
| 실제 프린터 | 미확보 |

상태 값은 `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `PASS`, `FAIL`, `NOT_APPLICABLE`만 사용한다. `BLOCKED`와 `FAIL`에는 재현 절차와 다음 행동을 반드시 적는다.

## 2 체크포인트

| 체크포인트 | 작업 | 상태 | 완료 커밋 | 검증 증거와 남은 항목 |
| --- | --- | --- | --- | --- |
| G0 | 환경 기준, ANDROID-01, CORE-01 계약 Schema·fixture | PASS |  | ANDROID-01 빌드/테스트 기준 확보, CORE-01 공통 스키마 및 10개 fixture, validate-contracts.test.mjs 8개 테스트 통과, 검토 C1 완료 |
| G1 | CORE-02~CORE-05 DB·인증·상품·댓글 API | IN_PROGRESS |  |  |
| G2 | ANDROID-02~ANDROID-06, CORE-06~CORE-08 | NOT_STARTED |  |  |
| G3 | CORE-09~CORE-10, ANDROID-07~ANDROID-09 | NOT_STARTED |  |  |
| G4 | ANDROID-10, CORE-11~CORE-12, T01~T22 | NOT_STARTED |  |  |

## 3 티켓 기록

| 티켓 | 상태 | 커밋 | 실행한 테스트 | 미검증·차단 사항 |
| --- | --- | --- | --- | --- |
| ANDROID-01 | PASS | `44ddf7f` | Gradle 9.3.1, JDK 17, SDK 35/36 환경 구성. `:app:assembleDebug`, `:app:testDebugUnitTest`, `:app:lintDebug` 완료 | 실기기/에뮬레이터 미확보로 connectedDebugAndroidTest 및 실기기 SMS 회귀는 미검증으로 기록 |
| CORE-01 | PASS |  | `contracts/product-sales/v1/`: JSON Schema, 10개 핵심 fixture, `npm run test:contracts` (8개 테스트 전원 통과), C1 검토 완료 | 없음 |
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
| 웹 | 저장소 루트 `npm run build` | PASS | vite v6.4.3 build 성공 (dist/ 생성, tsc 통과) |
| 서버 | `server/`의 실제 제공 테스트 명령 | PASS | `npm test` (node --test) 5개 테스트 모두 통과 |
| PC 도우미 | `desktop/comment-helper/`의 실제 제공 테스트 명령 | PASS | `npm test` (node --test) 5개 테스트 모두 통과 |
| Android debug | `android/voicecapSMS`에서 `.\gradlew.bat :app:assembleDebug` | PASS | OpenJDK 17, Android SDK 35/36 디버그 APK 빌드 성공 |
| Android unit/lint | `testDebugUnitTest`, `lintDebug` | PASS | 단위테스트 통과, 린트 보고서 생성 완료 (오류 0) |
| Android 기기 | `connectedDebugAndroidTest`와 수동 SMS 회귀 | 미검증 | 연결된 기기/에뮬레이터 미확보 (`adb devices` 빈 목록) |
| DB·RLS | 빈 개발 DB, 기존 데이터 복제 DB, cross-workspace와 권한 거절 | NOT_STARTED |  |
| 인쇄 | 실제 용지, lease 경쟁, UNKNOWN 복구와 중복 출력 방지 | 미검증 | 실제 프린터 미확보 |
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
