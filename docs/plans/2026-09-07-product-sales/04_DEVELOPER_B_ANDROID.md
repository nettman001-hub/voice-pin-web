# 개발자 B 작업지시서 — Android 판매관리

작성일: 2026년 9월 7일 · 담당: 개발자 B · 대상: `android/voicecapSMS`

## 1. 작업 목적과 소유 범위

기존 voicecapSMS 앱에 판매관리 탭을 추가한다. 판매자는 현재 상품과 댓글을 보고 구매자를 여러 명 선택해 판매를 등록하며, 상품별 판매내역과 구매자를 수정할 수 있다. 휴대폰에서 저장한 판매와 정정 전표는 서버를 통해 지정된 PC 도우미로 전달한다.

이 문서는 작업지시서다. 아래의 신규 클래스, 레이아웃, 테스트 경로는 **개발할 때 만들 예정인 파일**이며 지금 존재하는 기능이 아니다. 먼저 [공통 구현 명세](02_SHARED_CONTRACT.md)를 끝까지 읽고 용어와 요청 규칙을 맞춘다.

| 담당 | 수정 가능한 영역 | 맡는 결과 |
| --- | --- | --- |
| B | `android/voicecapSMS/**` | Android UI, 카메라, API 연결, 기기 테스트, Android 인계문서 |
| A | 공통 계약, `supabase/**`, `src/**`, `server/**`, `desktop/**`, 공유 fixture | 서버·DB·웹·댓글 중계·PC 출력 |

B는 서버 응답을 임의로 고치거나 PC 도우미를 직접 연결하지 않는다. 계약 변경이 필요하면 재현 예와 필요한 필드를 A에게 전달하고 공통 명세와 fixture가 바뀐 후 적용한다. Android의 `127.0.0.1`은 휴대폰 자신이므로 PC 댓글 도우미 주소로 사용할 수 없다.

## 2. 반드시 지킬 확정 규칙

- 같은 `buyerId`의 댓글을 여러 개 선택하면 구매자 한 명으로 합친다. 기본 수량은 1이고 판매자가 수량을 변경할 수 있다. 서로 다른 구매자를 닉네임만 보고 합치지 않는다.
- 가격 수정은 기존 활성 판매에도 적용한다. 영향받는 구매자와 변경 전후 금액을 먼저 보여주고 판매자가 확인한 뒤 저장한다.
- 상품등록이나 댓글 수신만으로 매출을 늘리지 않는다. 선택은 예상값이며 서버 판매 저장 성공 이후 확정값을 갱신한다.
- 상품명·사진 URL 대신 변하지 않는 `productId`로 상품을 연결한다. 중복 없는 표시 번호는 서버가 발급한다.
- `operationId`는 저장 동작 한 번의 UUID다. 같은 요청 재시도에는 같은 ID, 내용이 달라진 새 동작에는 새 ID를 쓴다.
- `revision`은 서버가 주는 버전이다. 앱에서 임의로 증가시키거나 충돌 응답을 무시하지 않는다.
- 판매 저장 성공과 종이 출력 완료는 다르다. 출력 대기·실패·확인 필요가 있어도 저장된 판매를 다시 등록하지 않는다.

## 3. 현재 파일과 신규 구조

아래 기존 경로는 모두 저장소 루트 기준이다.

| 기존 파일 | 현재 역할 / 작업 시 주의 |
| --- | --- |
| `android/voicecapSMS/app/src/main/java/com/voicecap/sms/MainActivity.java` | 단일 `android.app.Activity`, Java로 만든 연결·문자 설정 화면. 탭 구조와 생명주기 기반 화면으로 나누되 SMS 처리를 유지 |
| 같은 폴더의 `BridgeClient.java` | 일회용 코드 연결과 기기 토큰 인증. 판매용 오류 모델과 API 호출은 별도 클래스에 작성 |
| 같은 폴더의 `BridgePreferences.java` | 기기 ID·토큰·workspace 저장. 값 존재와 실제 서버 권한을 구분 |
| 같은 폴더의 `SyncScheduler.java`, `SmsSyncJobService.java` | SMS 15분 재동기화. 판매 댓글 갱신에 재사용하지 않음 |
| 같은 폴더의 `SmsSyncManager.java`, `SmsReceiver.java`, `MmsReceiver.java` | 기존 문자 수신·발신 처리. 판매 UI 추가로 업무 동작이 바뀌지 않도록 회귀 확인 |
| `android/voicecapSMS/app/src/main/AndroidManifest.xml` | 현재 카메라 선언 없음. 카메라 권한·화면 선언을 추가할 위치 |
| `android/voicecapSMS/app/build.gradle` | 현재 Java 앱, compileSdk 35 / targetSdk 36 / minSdk 26. CameraX·AndroidX 화면·RecyclerView 의존성 검증 위치 |
| `android/voicecapSMS/README.md`, `PLAY_DISTRIBUTION.md` | 빌드·페어링·테스트 배포 안내. README 대상 API 설명과 실제 Gradle 값의 불일치를 확인 |

권장 신규 구조는 다음과 같다. 클래스 이름은 Android 내부 구현안이며 API 이름은 변경하지 않는다.

```text
app/src/main/java/com/voicecap/sms/
  SmsBridgeFragment.java             기존 문자 연결 화면 분리
  sales/
    SalesManagementFragment.java     회차·상품·댓글·선택 화면
    SalesViewModel.java              화면 상태, 선택, 진행 중 요청
    SalesRepository.java             모의/실제 데이터 접근 공통 인터페이스
    FakeSalesRepository.java         A가 제공한 fixture로 개발
    RemoteSalesRepository.java       실제 서버 결과를 모델로 변환
    SalesApiClient.java              sales-api HTTPS 요청/공통 오류
    PendingOperationStore.java       응답 미확정 요청과 operationId 보존
    CommentAdapter.java              RecyclerView 댓글 행 표시
    ProductCaptureFragment.java      입력폼·전면 카메라·카운트다운
    ProductCaptureController.java    카메라 시작/촬영/해제 제어
    SessionProductsFragment.java     이번 회차 판매된 상품 목록
    ProductSalesEditFragment.java    상품과 구매자 수정·영향 확인
    SalesSettingsFragment.java       공통 상품 설정 조회/변경
    model/                          계약에 대응하는 Java 데이터 클래스
app/src/main/res/layout/             위 화면과 목록 행의 XML 레이아웃
app/src/test/                       선택·금액·응답 변환 검증
app/src/androidTest/                카메라/화면/생명주기 검증
```

## 4. 티켓별 실행 순서

### B-01. 개발 환경과 SMS 기준 상태 확보

**선행:** 저장소 인계 문서와 이 폴더의 공통 구현 명세를 읽는다.

1. Android Studio에서 `android/voicecapSMS`를 열고 현재 브랜치·커밋과 수정 파일을 기록한다. 다른 사람이 수정한 파일을 덮어쓰지 않는다.
2. Gradle/JDK/SDK 조합을 확인하고 기존 debug 빌드·lint 결과를 남긴다. compileSdk와 targetSdk 불일치가 새 라이브러리를 막으면 A와 기준을 맞추고 Android 안에서 조정한다.
3. 테스트 기기로 페어링, 연결 해제, 기본 SMS 앱 역할 요청, 문자 권한, 수신·동기화·발신의 기준 동작을 기록한다.
4. 실사용 고객 문자 대신 승인된 테스트 번호와 예제 문자를 쓴다. 기기 토큰·서명키·문자 원문을 공개 로그에 남기지 않는다.

**산출물:** Android 개발 환경 기록, 기존 동작 체크표, 빌드 결과. **완료:** 새 화면 추가 전 발생하던 오류와 새 오류를 구분할 수 있다.

### B-02. 탭과 생명주기 기반 화면 뼈대

**선행:** B-01 완료. **작업:** AndroidX Fragment/Activity와 RecyclerView 의존성을 실제 Gradle 조합에서 검증하고 버전을 고정한다.

1. `판매관리`, `문자연동` 탭을 만든다. MainActivity는 탭과 공통 내비게이션을 담당하고 기존 화면은 문자연동 화면으로 분리한다.
2. 기존 SMS 역할·권한 요청 결과가 새 화면에 전달되도록 옮긴다. 기기 연결 해제의 네트워크 호출도 UI 스레드 밖에서 실행한다.
3. 판매 탭 진입에 SMS 권한이나 기본 SMS 앱 지정을 요구하지 않는다. 판매용 권한은 서버의 `permissions`로 판단한다.
4. 화면 회전·탭 이동·복귀 시 선택 상태와 입력폼을 보존하고, 종료된 화면에 뒤늦게 도착한 응답을 표시하지 않는다.

**산출물:** 탭 화면과 분리된 문자 화면. **완료:** 탭 20회 전환·화면 회전 후 중복 요청과 SMS 동작 손상이 없다.

### B-03. 공통 모델·모의 API·요청 상태 보존

**선행:** A가 `contracts/product-sales/v1/` fixture와 JSON Schema를 제공한다. 미제공 시 임의 응답을 확정하지 말고 화면 뼈대까지 진행한다.

1. `SalesRepository` 아래 모의/실제 구현을 나눈다. fixture는 A 소유 원본을 읽거나 빌드에서 복사하며 B가 별도로 다른 계약을 만들지 않는다.
2. 공통 `ok`, `apiVersion`, `data`, `error`를 파싱한다. null 가격, 빈 회차, 번호이미지, 권한 거절, 충돌, 출력 대기, 미접수 operation, 구매자 검색/확인 fixture를 모두 연결한다.
3. API 주소는 기존 `VOICECAP_API_BASE_URL`의 `/sales-api`를 사용한다. 기기 인증 헤더는 `X-VoiceCAP-Device-Token`이고 workspace는 서버가 결정한다.
4. 재사용 가능한 비동기 실행기를 두고 UI 갱신은 메인 스레드에서 한다. 요청마다 해제되지 않는 새 스레드를 만들지 않는다.
5. 저장 요청을 보내기 전에 action, operationId, 요청 본문을 앱 전용 저장소에 기록한다. 결과를 모르면 `get-operation`으로 확인한다. NOT_FOUND는 아직 서버에 접수되지 않은 상태이므로 기존 operationId와 동일 본문으로 원래 요청을 보낸다. PROCESSING은 지연 후 다시 조회하고 SUCCEEDED는 기존 결과를 반영하며 FAILED는 공통 오류 규칙을 따른다.
6. 저장된 요청에 토큰 원문을 중복 저장하지 않는다. 연결 해제·계정 변경 뒤 다른 workspace에서 이전 요청을 재전송하지 않는다.

**산출물:** Repository/모델/공통 오류/미확정 요청 복구. **완료:** 미접수는 같은 ID로 재전송하고, 응답 유실 후 재조회에서 기존 성공을 찾으면 새 판매 요청을 만들지 않는다.

### B-04. 판매관리 기본 화면과 설정

**선행:** B-02, B-03 완료. **사용 action:** `get-bootstrap`, `get-sales-feed`, `update-settings`.

1. 상단 왼쪽에 이번 회차 판매갯수·합계금액, 오른쪽에 `신규 상품등록` 버튼을 둔다.
2. 바로 아래 현재 상품번호/상품명·사진·가격을 표시한다. 번호이미지도 사진과 같은 카드에서 보여주며 만료된 이미지 URL은 서버에서 새로 받는다.
3. 아래에 댓글 목록, 맨 아래에 선택 구매자 수·수량·예상금액과 `판매등록완료` 버튼을 고정한다. 작은 화면과 키보드가 열린 상태에서 버튼이 가려지지 않게 한다.
4. 설정 화면은 공통 세 토글을 읽고 `update-settings`에 `operationId`, `expectedRevision`, `settings`를 보낸다. 충돌 시 입력을 보존하고 다시 조회한다.
5. 상품등록 OFF면 명시적 등록 기능을 숨긴다. 사진 OFF면 카메라를 사용하지 않고 번호이미지, 상품명 입력 OFF면 번호/이름폼을 숨기고 서버 번호를 쓴다.
6. 회차나 활성 상품이 없으면 상태와 필요한 동작을 안내한다. 탭을 열었다는 이유로 회차·상품을 자동 생성하지 않는다. 회차 시작·종료는 명시 동작과 공통 action을 사용한다.
7. 판매 권한이 없으면 웹 기기관리에서 관리자가 권한을 켜야 함을 안내한다. `list-devices`, `update-device-capabilities`, `set-output-device`는 A 소유 웹 기기관리 흐름이며 Android가 자신의 권한을 임의로 올리거나 출력 대상을 바꾸지 않는다.

**산출물:** 판매 탭·공통 설정 화면. **완료:** 설정 조합과 빈 상태에서 허용되지 않은 등록을 실행하지 않고 기존 저장 상품이 사라지지 않는다.

### B-05. 최신 댓글과 구매자별 선택·수량

**선행:** B-04 완료. **사용 action:** `get-sales-feed`.

1. RecyclerView 행은 좌측 닉네임·멘트, 우측 이번 회차 구매갯수/금액과 총 누적구매횟수/금액으로 구성한다. 긴 닉네임·멘트는 줄바꿈하고 선택 상태는 색과 체크표시로 보여준다.
2. 선택 댓글 ID 목록과 `buyerId → 선택 댓글들, quantity`를 따로 보관한다. 같은 구매자의 댓글을 추가 선택해도 수량은 자동 증가하지 않는다. 명시적으로 누른 commentId만 근거로 보관하며 같은 buyerId의 미선택 댓글을 자동 체크하거나 sourceCommentIds에 추가하지 않는다.
3. 구매자별 수량 조절을 제공한다. 한 댓글을 해제해도 같은 구매자의 다른 선택 댓글이 남으면 구매자와 수량을 유지하며 마지막 댓글을 해제하면 해당 구매자를 제거한다.
4. 가격과 수량은 정수 검증한다. Android 계산은 `long`으로 하고 공통 범위와 합계 상한을 검사한다. 서버가 최종 금액을 계산한다.
5. 서버 확정 통계와 `등록 후 예상` 통계를 분리한다. 회차 수량은 quantity 합계, 누적 구매횟수는 ACTIVE 판매 행 수이므로 수량 2개를 구매 2회로 표시하지 않는다.
6. 탭이 보이는 동안 이전 요청 종료 후 약 1초 간격으로 갱신한다. capturedAt/ingest_sequence 내림차순을 지키고 새 댓글 커서와 과거 페이지 커서를 혼용하지 않는다. 화면에 보이거나 선택된 구매자를 watchedBuyerIds로 전달하며 한 요청에 최대 100명 제한을 지킨다.
7. 새 댓글이 와도 위치와 선택을 유지한다. 읽는 중이면 `새 댓글 N개` 안내로 최신 위치 이동을 제공한다. 탭 이탈 시 polling을 취소한다.
8. 새 댓글이 0건이어도 응답의 summary, buyerStats, activeProduct, revision을 반영한다. 댓글 cursor가 그대로라는 이유로 웹에서 바뀐 가격·구매자·합계를 무시하지 않는다. 100명을 넘는 조회는 A의 Schema와 페이지 규칙으로 나누며 UI의 확정 통계를 단말에서 추정하지 않는다.

**산출물:** 댓글 목록·다중 선택·수량 조절·예상 통계. **완료:** 같은 구매자 댓글 3개 선택은 기본 1개이고 수량을 2로 고치면 예상 수량만 2개 증가한다.

### B-06. 상품등록과 전면 카메라 2초 촬영

**선행:** B-03, B-04 완료, A의 이미지 업로드 계약 제공. **사용 action:** `prepare-product`, `update-product-draft`, `commit-product`.

1. 폼에 상품번호/상품명과 가격을 받고 `확인`을 누르면 입력을 고정한다. 숫자만 입력한 값은 requestedProductCode 문자열로 보내며 `00123`의 선행 0을 보존한다. 일반 텍스트는 name으로 보내고 번호는 서버가 발급한다. 상품코드를 단말 시각으로 만들지 않는다.
2. prepare용 operationId로 `prepare-product`를 호출해 draftId, draftRevision, productId, productCode, imageUpload, 만료시각을 받는다. 아직 판매 가능한 상품은 아니다.
3. 사진 설정 ON이면 CAMERA 권한을 필요한 시점에 요청하고 CameraX의 전면 카메라 Preview와 ImageCapture를 생명주기에 연결한다.
4. 카메라 준비 완료 후 화면에 2초 카운트다운을 표시하고 한 번만 촬영한다. 권한 요청·기기 초기화 시간은 이 2초에 포함하지 않는다.
5. 전면 카메라 없음·다른 앱 사용 중·권한 거절이면 이유와 재촬영/취소/번호이미지 등록 선택을 제공한다. 후면 카메라로 자동 전환하지 않는다. 판매자가 대체를 직접 고르면 `update-product-draft`에 별도 operationId, draftId, expectedDraftRevision, imageKind=NUMBER_IMAGE, imageFallbackConfirmed=true를 보낸다. 기존 productId/productCode 예약을 유지하고 새 prepare로 자기 번호와 충돌시키지 않는다. 같은 전환의 재시도는 같은 operationId를 쓴다.
6. 회전과 좌우 반전을 확인해 상품 글자가 뒤집히지 않는 저장 사진을 만든다. 앱 전용 임시파일, JPEG 긴 변 1280px/최대 2MB 기본안을 적용한다.
7. 서버가 발급한 imageUpload 객체의 URL·method·headers·제한·만료를 따라 draft 경로로 업로드한다. 임의 storage 경로나 공개 URL을 만들지 않는다. 재촬영은 기존 유효 draft 경로를 사용한다. 사진 OFF의 번호이미지는 imageFallbackConfirmed=false가 허용되며, 사진 ON에서는 판매자가 대체를 명시 확인한 경우에만 번호이미지로 전환한다. 실패를 자동 번호이미지 성공으로 바꾸지 않는다.
8. commit용 별도 operationId와 draftId, 최신 expectedDraftRevision, expectedSessionRevision으로 `commit-product`를 호출한다. 각 단계의 재시도에는 그 단계의 같은 operationId를 쓴다.
9. 서버 확정 응답으로 현재 상품·회차 revision을 교체한다. 가격 null 상품은 가격 미입력으로 표시하고 판매 완료를 막는다.
10. 화면 이탈·취소·회전에서 카운트다운을 해제하고 재진입 후 자동 재촬영하지 않는다. 업로드 실패에는 입력/사진을 보존하고 완료/만료 draft에 update-product-draft를 호출하지 않는다. 만료는 상태 확인 후 공통 번호 예약 규칙에 따라 재준비한다.

**산출물:** 상품폼·카메라 제어·업로드·등록 복구. **완료:** 확인 연타·회전·재시도에도 상품이 중복 등록되지 않고 `00123`이 유지된다. 사진 OFF에서 카메라 권한이 뜨지 않으며 사진 ON 실패 대체는 판매자가 직접 고른 경우에만 실행된다.

### B-07. 판매등록 완료와 출력 상태

**선행:** B-05, B-06 완료, 실제 판매 API 준비. **사용 action:** `search-buyers`, `confirm-buyer`, `commit-sales`, `get-operation`, `get-print-status`.

1. 누르는 순간 sessionId, productId, expectedProductRevision, expectedSessionRevision, buyers를 고정한다. buyers에는 buyerId, quantity, sourceCommentIds를 넣는다.
2. 선택 구매자 중 미확인 신원이 있거나 가격이 없으면 오류 위치를 보여준다. 구매자는 search-buyers로 후보를 찾고 판매자가 기존 후보를 선택하거나 명시적으로 수동 신원을 확인했을 때만 confirm-buyer를 호출한다. MANUAL_CONFIRMED를 플랫폼 검증 신원으로 표시하지 않고, 같은 닉네임이라는 이유로 과거 구매자를 자동 병합하지 않는다. 서버가 돌려준 buyerId로 선택과 근거를 다시 확인하며 댓글 개수를 구매수량으로 전달하지 않는다.
3. 요청을 보존하고 버튼을 처리 중으로 바꾼다. 실패 시 전체 선택을 유지한다. 서버 성공 후에만 선택을 비우고 응답의 summary/buyerStats를 반영한다.
4. 상품이 다른 기기에서 바뀌면 기존 선택의 상품·가격을 조용히 바꾸지 않는다. 최신 내용을 보여주고 판매자가 재확인한 뒤 새 요청을 만든다.
5. 출력은 서버가 함께 만든 printJobs만 조회한다. Android에서 별도 로컬 printSale이나 인쇄 작업 생성 요청을 보내지 않는다.
6. `QUEUED`는 출력 대기, `CLAIMED`는 처리 준비, `SUBMITTING`은 접수 중, `SUBMITTED`는 Windows 인쇄 접수, `FAILED`는 실패, `UNKNOWN`은 출력 여부 확인 필요로 표시한다.

**산출물:** 판매등록·서버 합계 갱신·출력 상태. **완료:** PC가 꺼져 있어도 판매는 한 번 저장되고, PC 재연결 후 전표 상태만 바뀐다.

### B-08. 상품별 판매내역과 구매자 수정

**선행:** B-07 완료, A의 수정 preview fixture/API 준비. **사용 action:** `list-session-products`, `get-product-sales`, `search-buyers`, `confirm-buyer`, `prepare-product-image`, `preview-product-change`, `commit-product-change`.

1. 판매내역 우측 `수정`에서 이번 회차 판매등록된 상품목록을 열고 상품 선택 시 상품내용과 구매자 목록을 표시한다.
2. 서버 product revision과 salesRevision, 각 sale revision을 보관한다. 구매자 추가·교체는 search-buyers와 필요한 confirm-buyer로 확정한 ID를 사용한다. 닉네임을 수정해 buyerId를 바꾸는 방식으로 구현하지 않는다. 구매자 추가·변경·제외와 수량 변경은 편집 상태에만 반영한다.
3. 사진 변경은 prepare-product-image로 현재 productId의 수정용 imageUpload와 imageId를 받는다. B-06의 전면 카메라 제어와 업로드 처리를 재사용하고 업로드한 imageId를 proposedProduct.imageId에 넣는다. 사진 업로드만으로 상품을 수정하지 않으며 기존 상품 등록용 prepare/commit으로 새 상품을 만들지 않는다.
4. `preview-product-change`에 proposedProduct, proposedSales, expectedProductRevision, expectedSalesRevision을 보낸다. proposedSales 행의 saleId/expectedRevision과 추가·취소 구조는 A의 JSON Schema를 그대로 따른다.
5. 영향받는 모든 구매자, 수량, 전후 단가/합계, 전체 증감, 기존 출력·정산서·입금·배송 연결 영향을 표시한다. 가격 변경이 기존 활성 판매 전체에 적용됨을 명확히 안내한다.
6. 판매자가 변경내용을 확인하면 새 operationId와 previewToken으로 `commit-product-change`를 호출한다. 확인 전 자동 저장하지 않는다.
7. preview 이후 새 판매가 생기거나 revision이 바뀌면 다시 조회·미리보기·확인한다. preview 만료도 입력을 보존하고 새 미리보기를 받는다.
8. 서버 성공 뒤 상품·구매자·합계·출력 상태를 다시 반영한다. 구매자 제외는 취소 이력으로 남고 변경 없는 저장은 새 전표가 생기지 않아야 한다.
9. 정정·추가·취소 전표는 서버 결과를 표시한다. 문자 재발송·환불·배송 변경을 앱이 자동 실행하지 않는다.

**산출물:** 상품별 수정과 영향 확인 화면. **완료:** 가격 변경 전후 확인, 동시 수정 충돌, 구매자 추가/제외의 전표 종류가 웹과 같다.

### B-09. 실제 API 연결과 오류 처리

**선행:** B-03~B-08 모의 화면 완료, A가 테스트 환경과 판매 권한 부여. **작업:** Repository만 실제 구현으로 전환해 같은 화면을 검증한다.

| 응답/상황 | 필수 처리 |
| --- | --- |
| 401 AUTH_REQUIRED / DEVICE_REVOKED | 판매 요청 중단·재연결 안내, 반복 전송 금지 |
| 403 CAPABILITY_DENIED | 웹 기기관리에서 관리자가 판매 권한을 부여하도록 안내. Android의 SMS 설정을 반복 요구하지 않음 |
| 409 REVISION_CONFLICT / ACTIVE_PRODUCT_CHANGED | 입력 보존·최신 내용 확인·다시 승인 |
| 409 PRODUCT_CODE_EXISTS / COMMENT_ALREADY_COMMITTED | 기존 상품 또는 기존 판매 안내, 새 ID로 무작정 재전송 금지 |
| 409 OPERATION_PAYLOAD_MISMATCH | 같은 ID의 본문이 바뀐 구현 오류 기록, 중복 저장으로 해결하지 않음 |
| 410 PREVIEW_EXPIRED / DRAFT_EXPIRED | 편집값 보존·미리보기 또는 등록 준비 재진행 |
| 422 VALIDATION_ERROR / PRICE_REQUIRED / BUYER_UNRESOLVED | 해당 입력 오류 표시·저장 중단. 구매자 문제는 검색/명시 확인 완료 후 재시도 |
| 429 RATE_LIMITED / 503 TEMPORARILY_UNAVAILABLE | Retry-After/지연 재시도, 저장 응답 미확정이면 get-operation 우선 |
| 통신 단절·앱 종료 후 재실행 | 기존 operationId로 상태 확인, 새 판매를 자동 생성하지 않음 |
| get-operation의 NOT_FOUND | 기존 operationId와 동일 본문으로 원요청 재전송. 새 ID를 발급하지 않음 |
| 사진 ON 촬영 실패 | 판매자가 재촬영·취소·번호이미지 대체를 선택. 대체 확인 전 자동 저장 금지 |

**산출물:** 실제 연결 결과와 오류별 화면. **완료:** 연결된 다른 판매자의 데이터가 보이지 않고 권한 회수 즉시 다음 요청이 거절된다.

### B-10. 회귀 검증·배포용 빌드·인계

**선행:** 모든 티켓 완료, A와 PC 도우미를 포함한 테스트 환경 준비. [공통 인수시험](05_ACCEPTANCE_TESTS.md)의 Android 관련 항목을 실행한다.

1. 동일 구매자 중복 댓글·미선택 댓글 미소비·수량 수정·연타·서버 미접수/응답 유실·회차 종료·상품 전환·가격 변경 중 새 구매자 추가·앱 재시작을 검증한다. 새 댓글 0건에서 웹 가격/구매자 수정이 Android 통계에 반영되는지도 확인한다.
2. 전면 카메라 거절/사용 중/없음, 촬영 중 화면 이동, 사진 회전·미러링, 업로드 실패·만료, 명시적 번호이미지 대체, `00123` 보존, 기존 상품 사진 변경, 작은 화면·큰 글꼴을 실기기에서 확인한다.
3. 웹창을 닫은 상태에서 Android 판매 → 서버 저장 → 지정 PC 출력 접수를 확인한다. PC 종료/프린터 문제에서 중복 판매와 자동 중복 출력이 없어야 한다.
4. B-01의 SMS 기준 항목을 다시 실행한다. 역할 요청, 권한 거절, 업무 문자 필터링, 수신·발신·15분 작업을 포함한다.
5. Android 8/API26 대상과 최신 실기기에서 확인한다. 테스트 배포는 기존 PLAY_DISTRIBUTION 절차를 따르고 서명 정보를 커밋하지 않는다.
6. 동명이인 검색·기존 구매자 선택·MANUAL_CONFIRMED 수동 확인에서 원치 않는 병합이 없고, 판매 권한 거절 안내 후 웹 관리자가 허용하면 재조회로 사용 가능한지 확인한다.

아래 명령은 `C:\dev\voice-pin-web\android\voicecapSMS`에서 실행한다. 테스트 경로는 B가 작성한 테스트를 검증하며 설치·운영 배포를 자동 승인하는 명령이 아니다.

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:lintDebug
.\gradlew.bat :app:connectedDebugAndroidTest
.\gradlew.bat :app:bundleRelease
```

`connectedDebugAndroidTest`는 연결 기기/에뮬레이터가 필요하다. release AAB의 서명은 기존 `VOICECAP_UPLOAD_*` 환경변수 네 개를 사용한다. 환경 문제로 실행하지 못한 항목을 성공으로 기록하지 않는다.

**인계 체크:** 변경 파일/커밋, 사용 API 버전, fixture 버전, Gradle·SDK·기기 정보, 빌드 결과, 인수시험 증거, 미해결 문제와 재현 절차, 토큰 없는 진단 로그, 테스트 APK/AAB 위치를 제출한다. 최종 완료 조건은 A와 같은 데이터·동일 계산·동일 수정 결과·중복 없는 판매를 확인하고 기존 SMS 기능이 유지되는 것이다.

## 5. 읽을 공식 자료

- [CameraX 사진 촬영](https://developer.android.com/media/camera/camerax/take-photo): ImageCapture와 저장 콜백 구현 참고.
- [CameraX 아키텍처](https://developer.android.com/media/camera/camerax/architecture): 화면 생명주기에 촬영을 연결하고 해제하는 구조 참고.
- [CameraX 회전 처리](https://developer.android.com/media/camera/camerax/orientation-rotation): 기기 방향과 저장 사진 방향 검증 참고.
- [RecyclerView Java 예제](https://developer.android.com/develop/ui/views/layout/recyclerview): 긴 댓글 목록의 뷰 재사용과 Adapter 구현 참고.
