# Supabase 동시 쓰기 + 로컬 읽기 리뷰

대상: 커밋 `8746ed1`의 5개 변경 파일과 관련 UI·서버 처리 경로. 운영 Supabase에 접속하거나 데이터를 변경하지 않았다. 아래 재현은 실제 TypeScript 모듈에 메모리 저장소·API 응답 모형을 주입한 결과이며, 실브라우저 부하 측정은 아니다.

## 1. 종합 평가: D

2초마다 수행하던 `getSalesFeed` 네트워크 호출을 제거한 것은 확인된다. 그러나 현재 구현은 **양쪽 저장 성공을 확인하는 동기화 구조가 아니라, 서로 실패할 수 있는 저장을 개별 실행하고 로컬 복사본을 신뢰하는 구조**다. 구매자 식별, 취소 합계, 댓글 삭제, 계정 전환에서 기능 회귀가 확인되어 운영 승인 전 수정이 필요하다.

브라우저 저장과 Supabase 저장을 하나의 원자적 트랜잭션으로 묶을 수는 없다. 보장해야 할 것은 ‘동시 완벽 일치’가 아니라 **서버 확정 여부의 명확한 표시, 미전송 작업 보존, 멱등 재시도, 서버 변경 수신과 누락 복구**다. 화면은 메모리에서 즉시 읽으면서 이 조건을 충족할 수 있다.

## 2. 장점 및 성과

- `/live`에서 기존 폴링 조건이 계속 충족되는 경우, 탭당 시간당 약 1,800회의 주기적 피드 Edge 호출을 제거한다. 이것은 해당 폴링의 감소량이며 전체 Supabase 요청·비용 100% 감소를 뜻하지 않는다.
- 댓글 수신 직후 로컬 화면 반영, 상품 API 성공 응답의 재사용, 댓글 배치 업로드는 타당한 방향이다.
- 메모리 댓글 100건, 중복 검사 키 제한, 저장 댓글 5,000건 제한 등 일부 용량 관리가 있다.
- 기존 상품·세션 revision 검사와 서버 operation ID 처리 기반을 이후 동기화 설계에 활용할 수 있다.
- 네트워크를 기다리지 않는 읽기는 가능하지만 ‘0ms’라는 주석은 측정 결과가 아니다. 현재 읽기는 전체 JSON 파싱과 집계를 수행한다.

## 3. 잠재적 위험 및 엣지 케이스

이 문서의 Critical은 판매 기능·집계 정확성·계정 데이터 분리에 영향을 주어 우선 수정해야 하는 문제다. 서버 침해 가능성이 확인되었다는 뜻은 아니다.

### Critical 1 — 구매자 ID와 정식 댓글 ID가 소실됨

- [ProductSalesContext.tsx:146](C:/dev/voicecap-web/src/context/ProductSalesContext.tsx:146): 모든 피드 댓글의 `buyerId`를 `null`로 만든다. 초기 서버 댓글을 저장할 때도 구매자 ID를 버린다.
- [CommentCaptureContext.tsx:295](C:/dev/voicecap-web/src/context/CommentCaptureContext.tsx:295): 새 댓글 ID는 `stream-*`이며, 업로드 성공 응답은 250행에서 캐시에 병합하지 않는다.
- [ProductSalesPage.tsx:250](C:/dev/voicecap-web/src/pages/seller/ProductSalesPage.tsx:250): 구매자 ID가 없으면 닉네임을 판매 API에 전달한다. 서버는 이를 UUID인 `buyers.id`/`sales.buyer_id`로 사용한다.
- **영향:** 댓글 선택 판매가 실패할 수 있고, 댓글 사용 이력 연결도 정식 서버 ID를 잃는다.
- **재현:** 서버의 정상 구매자 UUID가 초기 동기화 직후 로컬 피드에서 `null`이 됨.
- **수정:** 서버 수집 응답에 플랫폼 메시지 ID→정식 댓글 ID·구매자 ID 매핑을 포함하고 같은 로컬 레코드에 병합한다. 미확정 댓글은 즉시 표시하되 UUID 대신 닉네임을 보내 판매 완료로 처리하지 않는다.

### Critical 2 — 서버 합계와 로컬 합계의 계산 규칙이 다름

- [storageService.ts:607](C:/dev/voicecap-web/src/services/storageService.ts:607): `status === '보류'`만 제외한다.
- [common.ts:30](C:/dev/voicecap-web/supabase/functions/sales-api/handlers/common.ts:30): 서버는 `record_state = ACTIVE`로 집계한다.
- [products.ts:551](C:/dev/voicecap-web/supabase/functions/sales-api/handlers/products.ts:551): 취소 시 수량·금액을 유지하고 `record_state`를 `CANCELLED`로 바꾼다.
- [remoteWorkspaceService.ts:48](C:/dev/voicecap-web/src/services/remoteWorkspaceService.ts:48): 판매 매핑에 `record_state`와 `buyer_id`가 없다. 로컬 필터 하나를 추가하는 것만으로 해결되지 않는다.
- **재현:** 활성 판매 1개/100원 + 취소 판매 2개/200원을 저장하면 로컬은 3개/300원으로 집계함. 서버의 활성 판매 기준은 1개/100원이다.
- **수정:** 서버 상태·revision·구매자 ID를 손실 없이 매핑하고 서버/클라이언트가 같은 집계 규칙을 사용한다. 보류 제외 여부도 양쪽 규칙으로 명시한다.

### Critical 3 — 다른 기기·탭의 상품/댓글 변경과 재연결 누락을 복구하지 못함

- [ProductSalesContext.tsx:252](C:/dev/voicecap-web/src/context/ProductSalesContext.tsx:252): 갱신은 로컬 조립만 수행한다.
- [remoteWorkspaceService.ts:586](C:/dev/voicecap-web/src/services/remoteWorkspaceService.ts:586): 기존 구독은 판매 및 commerce 테이블 6개다. `products`, `live_sessions`, `live_comments` 변경을 수신하지 않는다.
- `activeProductRef`가 localStorage보다 우선하며, ProductSalesContext에 탭 간 저장 변경 수신이 없다. 다른 탭이 캐시를 바꿔도 기존 메모리 상품이 유지된다.
- 구독 상태 변화·온라인 복귀 때 피드 재검증/cursor 복구도 없다.
- **재현:** 서버 상품을 1→2, 세션 revision을 1→2로 바꾼 뒤 `pollFeed()`를 실행해도 로컬은 상품 1/revision 1을 유지함.
- **영향:** 오래된 가격·활성 상품·댓글 표시, 다음 쓰기에서 revision 충돌. 판매 테이블 Realtime이 동작해도 상품·댓글 동기화를 대신하지 못한다.
- **수정:** workspace 범위 변경 이벤트와 탭 간 알림을 같은 메모리 저장소에 적용한다. 최초 구독 승인 및 재접속 때 누락 변경을 보정하고 오래된 revision은 거부한다. 운영 Realtime publication/RLS 설정은 별도 확인이 필요하다.

### Critical 4 — 일부 쓰기 경로가 새 로컬 원본을 갱신하지 않음

- [ProductSalesContext.tsx:472](C:/dev/voicecap-web/src/context/ProductSalesContext.tsx:472): `commitSales` 성공 후 `resp.sales`/`summary`를 로컬에 반영하지 않고 이전 판매 저장소로 피드를 다시 만든다. 자동 후보 확정도 같은 문제다.
- 이후 별도 SalesContext의 판매 Realtime→전체 재조회가 성공하면 회복될 수 있지만, 즉시 반영이 아니고 구독 누락 시 회복이 보장되지 않는다.
- [CommentRecordsPage.tsx:160](C:/dev/voicecap-web/src/pages/seller/CommentRecordsPage.tsx:160): 서버 댓글 삭제 후 기록 화면만 재조회하고 로컬 댓글을 제거하지 않는다.
- **영향:** 삭제한 댓글이 라이브 피드와 [음성 판정](C:/dev/voicecap-web/src/context/LiveContext.tsx:727)에 남는다. 초기 동기화도 append이므로 삭제가 자동 정리되지 않는다.
- **수정:** 등록·수정·삭제·취소·AI 정정·다른 기기 작업의 결과를 공통 저장소에 적용한다. 삭제는 정식 ID 매핑과 삭제 이벤트/tombstone까지 다뤄야 한다. 최신 50개 응답에 없다는 이유만으로 과거 댓글을 모두 삭제해서는 안 된다.

### Critical 5 — 미완료 저장과 오래된 조회가 충돌함

- [SalesContext.tsx:55](C:/dev/voicecap-web/src/context/SalesContext.tsx:55): 조회 결과로 판매 캐시 전체를 무조건 교체한다.
- **재현:** 이전 판매 조회 시작 → 판매 A 로컬 추가 → 이전 빈 조회 응답 도착 → 로컬 A 삭제 → A 서버 저장 성공. 이후 이벤트가 없으면 캐시에 A가 없는 상태가 유지된다.
- [SalesContext.tsx:86](C:/dev/voicecap-web/src/context/SalesContext.tsx:86)의 서버 저장 실패는 로그만 남긴다. 로컬에만 있는 판매/수정/삭제를 추적할 상태·재시도 큐·사용자 표시가 없다.
- 댓글 전송 큐도 [CommentCaptureContext.tsx:78](C:/dev/voicecap-web/src/context/CommentCaptureContext.tsx:78)의 메모리 ref라 오프라인 새로고침 시 유실된다. 저장 댓글로 큐를 복구하는 경로가 없다.
- 큐의 비영속성·일부 조회 경쟁은 기존에도 존재했지만, 이번에는 그 결과가 계속 읽는 로컬 저장소에 남으므로 새 아키텍처의 신뢰성 요건을 충족하지 못한다.
- **수정:** 로컬 미완료 작업과 서버 snapshot을 분리하여 병합한다. 영속 outbox, 고정 operation ID 재시도, per-entity revision 검증, 계정 전환 시 이전 응답 폐기가 필요하다.

### Critical 6 — 다른 계정의 캐시를 복원할 수 있음

- [storageService.ts:240](C:/dev/voicecap-web/src/services/storageService.ts:240): `dadryeo_sales`, `voicecap_comment_records`, 활성 상품/세션/부트스트랩 키가 workspace별로 분리되지 않는다.
- [ProductSalesContext.tsx:220](C:/dev/voicecap-web/src/context/ProductSalesContext.tsx:220): 실패 종류나 `cached.workspaceId` 확인 없이 복원한다.
- [AuthContext.tsx:232](C:/dev/voicecap-web/src/context/AuthContext.tsx:232): 로그아웃에서 이 캐시를 정리하지 않는다.
- **재현:** workspace B로 인증된 Provider에 A의 캐시를 남기고 bootstrap 실패를 주입하면 A의 bootstrap이 반환됨.
- **수정:** user/workspace 범위 키와 메모리 분리, 일치 여부 확인, identity 변경 시 진행 중 응답 무효화. 인증/권한 실패를 정상 오프라인 복원으로 취급하지 않는다. 이는 로컬 화면 데이터 분리 문제이며 서버 RLS 우회가 확인된 것은 아니다.

### Critical 7 — 저장 용량 초과를 성공처럼 처리함

- [storageService.ts:272](C:/dev/voicecap-web/src/services/storageService.ts:272): 저장 실패를 로그로만 남긴다.
- 피드는 메모리 최신값 대신 localStorage를 다시 읽어 실패 전 데이터에 머무른다.
- **재현:** 저장 예외를 주입하면 댓글 추가가 호출자에게 실패를 알리지 않고 새 댓글은 피드에서 누락됨. 판매도 저장 실패 후 합계가 0/0으로 남는 것을 확인함.
- 댓글 5,000건 제한은 바이트 제한이 아니며, 판매·이미지 문자열·기타 캐시도 같은 origin 공간을 공유한다.
- **수정:** UI 읽기를 메모리로 통합하고 지속 저장 실패를 명시한다. 대량 데이터/재전송 큐는 IndexedDB에 저장하고, 확정된 오래된 캐시만 정책적으로 정리한다. 미전송 작업을 용량 확보 목적으로 조용히 버려서는 안 된다.

MDN은 Web Storage를 origin당 localStorage 5 MiB + sessionStorage 5 MiB로 설명하고 초과 시 `QuotaExceededError` 처리를 요구한다. 실제 한도·사용 가능 여부는 브라우저 환경도 고려해야 한다. [공식 참고](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

### Minor / 계약·성능 문제

1. **중복 댓글:** bootstrap append와 `addCommentRecords`가 중복을 제거하지 않는다. 동일 댓글 10개를 두 번 동기화하면 20개/고유 10개가 됨. `workspaceId+sessionId+platformMessageId`로 upsert해야 한다.
2. **복원 정렬:** newest-first 저장소에서 [초기 `.slice(-100)`](C:/dev/voicecap-web/src/context/CommentCaptureContext.tsx:67)은 가장 오래된 100개를 고른다. 최신 100개를 선택한 후 UI 순서로 정렬해야 한다.
3. **임시 세션 승격:** [세션 UUID 전환](C:/dev/voicecap-web/src/context/CommentCaptureContext.tsx:96)이 메모리/큐만 바꾸고 이미 저장한 로컬 댓글은 옛 세션에 남긴다.
4. **bootstrap 캐시 버전 분리:** 상품 등록·확정은 활성 상품/세션 캐시만 갱신한다. 이후 API 실패 때 예전 bootstrap의 상품을 복원할 수 있다. 같은 snapshot으로 원자적으로 저장해야 한다.
5. **구매자 통계 계약:** [storageService.ts:627](C:/dev/voicecap-web/src/services/storageService.ts:627)은 UUID 대신 닉네임으로 묶고 `totalPurchase*`도 현 세션만 계산한다. 서버는 전체 기간 누계다. 현재 `feed.buyerStats`의 직접 UI 사용은 확인되지 않아 즉각적인 화면 장애로 단정하지 않는다.
6. **메인 스레드 부하:** 댓글 한 건마다 최대 5,000건 배열을 파싱·직렬화·저장하고 2초마다 전체 판매를 재집계한다. 동기식 localStorage 작업은 네트워크 없이도 화면을 지연시킬 수 있다. 메모리 인덱스·변경분 집계·비동기 배치 저장이 적합하다. [MDN Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
7. **멀티 탭 경쟁:** 한 키의 배열을 읽고 수정해 다시 쓰는 작업은 탭 간 트랜잭션이 아니다. 두 탭이 각각 읽은 배열에 새 항목을 추가하면 마지막 저장이 다른 탭의 항목을 덮을 수 있다. IndexedDB 트랜잭션과 탭 알림을 함께 사용한다.

## 4. 구체적인 코드 개선 제안

아래는 설계 예시다. `localDb`, `memoryStore`, 구조화된 오류 분류 등은 새로 구현할 인터페이스이며 현재 코드에 그대로 붙이는 완성 패치가 아니다.

### 4.1 정식 댓글 식별자 보존 및 중복 없는 병합

수집 API가 신규 댓글과 중복 댓글 모두에 대해 매핑을 반환하도록 계약을 확장한다.

```ts
type CommentAck = {
  platformMessageId: string;
  id: string;                 // live_comments.id
  buyerId: string | null;     // buyers.id
};

async function applyCommentAcks(
  scope: { workspaceId: string; sessionId: string },
  acknowledgements: CommentAck[],
) {
  await localDb.transaction(async (tx) => {
    for (const ack of acknowledgements) {
      const key = [scope.workspaceId, scope.sessionId, ack.platformMessageId];
      // 같은 플랫폼 댓글을 새 행으로 추가하지 않는다.
      await tx.comments.merge(key, { ...ack, syncStatus: 'SYNCED' });
      await tx.commentOutbox.delete(key);
    }
  });
  await memoryStore.reloadComments(scope);
}
```

현재 API의 `acceptedIds` 배열만으로는 신규/중복 혼합 배치의 구매자 정보까지 복원할 수 없다. 클라이언트 변경과 서버 응답 변경이 함께 필요하다.

### 4.2 미전송 작업을 먼저 보존하고 서버 확정 응답 적용

```ts
async function queueSale(command: SaleCommand) {
  const operationId = crypto.randomUUID();
  await localDb.transaction(async (tx) => {
    await tx.pendingSales.put({ ...command, operationId, syncStatus: 'PENDING' });
    await tx.outbox.put({ operationId, command, attempts: 0 });
  });
  memoryStore.applyPendingSale(command, operationId);
  scheduleFlush();
}

async function flushSale(item: OutboxItem) {
  // 재시도 때 operationId를 새로 발급하지 않는다.
  const result = await salesApi.commit({
    ...item.command, operationId: item.operationId,
  });
  await localDb.transaction(async (tx) => {
    await tx.confirmedSales.upsertMany(result.sales);
    await tx.pendingSales.delete(item.operationId);
    await tx.outbox.delete(item.operationId);
  });
  memoryStore.applyConfirmedSales(item.operationId, result.sales);
}
```

서버 성공 뒤 로컬 ACK 저장이 실패해도 같은 operation ID로 재요청하면 같은 결과를 받아야 한다. 서버 멱등 처리는 판매·인쇄 작업을 포함해 트랜잭션으로 보장해야 한다. 네트워크 오류는 backoff 재시도, revision 충돌·권한 오류는 별도 상태로 분류한다. 조회 snapshot은 confirmed 영역에 적용하고 미완료 작업을 조용히 덮지 않는다.

### 4.3 계정·세션·버전을 검증한 snapshot 적용

```ts
let syncGeneration = 0;

async function reconcile(scope: Scope) {
  const generation = ++syncGeneration;
  const snapshot = await api.getSnapshot(scope); // 서버 계약 추가 또는 기존 API 조합
  if (generation !== syncGeneration) return;
  if (!sameScope(scope, currentScope())) return;
  if (snapshot.workspaceId !== scope.workspaceId) return;

  await store.mergeServerSnapshot(snapshot, {
    preservePending: true,
    rejectOlderRevisions: true,
  });
}

function onIdentityChanged() {
  ++syncGeneration;           // 이전 계정의 늦은 응답 폐기
  store.resetMemory();
}
```

storage key도 workspace/user별로 분리하고 API 오류를 구조화하여 인증·권한 오류에서는 다른 계정 캐시나 오프라인 성공 경로로 복원하지 않는다. 재접속 시 재조회는 요청 중복을 합치고, 조회 중 수신한 이벤트와 로컬 작업을 revision에 따라 병합해야 한다.

### 4.4 취소 상태를 포함한 동일 집계 규칙

```ts
type CanonicalSale = {
  id: string;
  sessionId: string;
  buyerId: string | null;
  recordState: 'ACTIVE' | 'CANCELLED';
  quantity: number;
  amount: number;
  revision: number;
};

function summarize(sales: CanonicalSale[], sessionId: string) {
  return sales.reduce((sum, sale) => {
    if (sale.sessionId !== sessionId || sale.recordState !== 'ACTIVE') return sum;
    return {
      sessionQuantity: sum.sessionQuantity + sale.quantity,
      sessionAmount: sum.sessionAmount + sale.amount,
    };
  }, { sessionQuantity: 0, sessionAmount: 0 });
}
```

서버 행→로컬 모델 변환에서 상태를 빠뜨리지 않아야 한다. 구매자 통계는 buyer UUID별로 세션 합계와 전체 기간 합계를 별도로 유지한다. 전체 기간 데이터가 로컬에 완전하지 않다면 1회 서버 누계와 이후 변경분을 조합한다.

### 적용 순서 및 검증

1. 정식 ID 보존, 취소 합계, 판매/삭제 응답 반영, 계정 캐시 분리를 먼저 수정한다.
2. UI가 읽는 메모리 store를 통합하고 저장 오류·미확정 상태를 표시한다.
3. 영속 outbox와 버전 병합을 도입한 뒤 변경 이벤트/재접속 복구를 검증한다. 삭제 이벤트 전달과 publication/RLS 설정도 확인한다. [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
4. 두 탭 동시 쓰기, 오프라인 새로고침, 서버 성공 직후 응답 유실, 저장 용량 초과, 느린 bootstrap 중 상품 변경, 로그아웃 후 이전 응답 도착을 통합 테스트한다.
5. 실브라우저에서 댓글 초당 유입량별 렌더 지연과 저장 시간, 네트워크 호출 수를 측정한다. 이번 리뷰에서는 운영 비용 및 지연 수치를 실측하지 않았다.

별도 요청한 1번(변경된 commerce 항목만 저장)은 로컬 코드에 적용했다. 추가 회귀 테스트 16개 및 빌드가 통과했다. 전체 252개 테스트 중 251개 통과, 변경하지 않은 AI 상태 판정 테스트 1개는 `DEGRADED` 기대/`AVAILABLE` 실제로 실패하며 단독 실행에서도 재현됐다. 6번 코드에는 리뷰에 따른 수정은 적용하지 않았다.
