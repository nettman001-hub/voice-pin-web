# 관리 영역 재설계의 판매구조 근거

기준일: 2026-11-02. 코드 기준: `a14f4dc`에서 분기한 설계 작업. 이 문서는 현재 저장소의 구현을 읽고 정리한 근거이며 운영 배포 상태나 실제 폰 검증 완료를 뜻하지 않는다. 앱 코드는 변경하지 않았다.

## 1. 실제 판매구조

일반 쇼핑몰의 상품 상세 → 장바구니 → 카드결제 순서와 다르다. 방송 회차에서 판매자가 댓글의 구매자를 선택하고 가격·수량을 입력하여 판매를 적재한다. 이후 구매정보를 대조하고, 여러 판매 건을 묶어 정산서를 보내고, 계좌 입금을 연결하고, 보관 또는 택배 업무를 진행한다. 상품이 미리 등록되지 않은 판매도 가능하다.

| 영역 | 현재 구현 | 코드 근거 |
|---|---|---|
| 회차 | `LiveSession`은 ACTIVE / ENDED. 판매·상품·댓글은 회차에 연결된다. | [`productSales.ts`](../../../src/types/productSales.ts#L26), [`live.ts`](../../../src/types/live.ts#L5) |
| 구매자 | 내부 `buyerId`, 플랫폼 사용자 번호·아이디, 표시 닉네임을 가진다. 터치 저장은 플랫폼 사용자 번호를 우선 사용하고, 없으면 플랫폼 아이디를 대조한다. | [`202610310001_touch_sale_capture_paths.sql`](../../../supabase/migrations/202610310001_touch_sale_capture_paths.sql#L64) |
| 댓글터치 판매 | `operationId`로 재전송을 식별하고, 활성 회차·판매 연결을 검사한 뒤 판매·근거 댓글·출력 작업을 트랜잭션으로 저장한다. 동일 댓글의 추가 판매는 명시적으로 허용해야 한다. | [`touchSales.ts`](../../../supabase/functions/sales-api/handlers/touchSales.ts#L317), [`202610310001_touch_sale_capture_paths.sql`](../../../supabase/migrations/202610310001_touch_sale_capture_paths.sql#L31) |
| 가격·수량 | 입력 100 미만은 만원 단위, 1,000 이상은 원 단위. 100~999는 거부한다. 판매의 `amount`는 `unitPrice × quantity`로 저장된다. 이미 합산된 `amount`에 수량을 다시 곱하면 중복 계산이다. | [`touchSalesCore.ts`](../../../supabase/functions/sales-api/handlers/touchSalesCore.ts#L23), [`202610310001_touch_sale_capture_paths.sql`](../../../supabase/migrations/202610310001_touch_sale_capture_paths.sql#L40) |
| 상품 | 명시적 상품 ID가 없어도 판매 가능하다. 번호 방식은 같은 회차의 같은 상품번호 문맥으로 상품을 연결한다. 기본 방식에서는 상품 ID·이름이 없을 수 있다. | [`202610310001_touch_sale_capture_paths.sql`](../../../supabase/migrations/202610310001_touch_sale_capture_paths.sql#L95) |
| 판매 상태 | 자동저장 / 수동수정 / 확정 / 보류 / 취소. 별도 `recordState`, 동기화 상태, 출력 상태, 구매자 해결 근거를 가진다. | [`live.ts`](../../../src/types/live.ts#L1) |
| 구매정보 대조 | 문자로 받은 구매정보 `CustomerPurchaseClaim`에 닉네임·연락처·주소·금액·캡처·판매 ID 연결과 MATCHED / MISMATCH / NEEDS_REVIEW 등이 있다. | [`commerce.ts`](../../../src/types/commerce.ts#L40), [`CommerceContext.tsx`](../../../src/context/CommerceContext.tsx#L335) |
| 정산서 | 선택한 판매 ID들을 하나의 청구서에 연결한다. 상품합계에 배송비 포함 여부를 선택한다. 생성은 DRAFT, 문자 발송 요청은 QUEUED, 입금 연결은 PAID이다. | [`InvoiceManagementPage.tsx`](../../../src/pages/seller/InvoiceManagementPage.tsx#L174), [`InvoiceManagementPage.tsx`](../../../src/pages/seller/InvoiceManagementPage.tsx#L302), [`CommerceContext.tsx`](../../../src/context/CommerceContext.tsx#L424) |
| 입금 | 계좌 알림 / 문자 / 수동 입금을 보관하며 정산서와 연결한다. 입금 데이터 수신과 주문 대조 완료는 별개다. | [`commerce.ts`](../../../src/types/commerce.ts#L74), [`paymentMatching.ts`](../../../src/services/paymentMatching.ts#L115) |
| 배송 | READY → PACKED → SHIPPED → DELIVERED, 취소는 CANCELLED. 여러 판매 ID를 한 배송 업무에 연결한다. | [`commerce.ts`](../../../src/types/commerce.ts#L95), [`CommerceContext.tsx`](../../../src/context/CommerceContext.tsx#L509) |

`SaleRecord`는 상품별 판매 기록이고 정산서·입금·배송은 각각 `saleIds[]`로 연결된다. **판매 1건 = 정산서 1건 = 택배 1건**으로 설계하면 안 된다. 현재 정산서 작성 화면의 구매자 묶음은 닉네임 문자열 중심이며, 배송 업무 자동 묶음은 `회차:닉네임` 기준이다. 미래 설계에서는 안정적인 구매자 ID와 명시적인 묶음 식별자가 필요하다.

## 2. 보관과 합배송

현재 보관은 `CustomerKeepingRecord`이며 `saleIds`, 상품금액 스냅샷, 회차, 등록시각, 메모를 가진다. 상태는 KEPT / RELEASED 두 가지다. 별도의 물류 보관 위치, 요청 출고일, 부분 출고 원장은 없다.

- 기록은 워크스페이스별 로컬 저장소와 `workspace_settings.customer_keeping_records`에 저장한다. 현재는 전용 보관 테이블·항목별 revision 계약이 아니다. ([서비스](../../../src/services/customerKeepingService.ts#L15))
- 구매자 요약은 이전 회차 KEPT 기록을 찾는다. 현재 서비스는 닉네임 **유사도**로 보관을 연결한다. 구매자 ID 기반으로 정확히 구분하는 고객통계 인덱스와 기준이 다르므로, 재설계에서 비슷한 이름의 고객을 자동 합배송하면 안 된다. ([보관 조회](../../../src/services/customerKeepingService.ts#L74), [고객 인덱스](../../../src/services/customerStatsIndex.ts#L136))
- 같은 회차·유사 닉네임의 KEPT 기록을 갱신하며, 전달한 판매 ID와 합계로 교체한다. `keptAt`도 갱신되므로 현재 시각만으로 최초 보관 경과일을 정확히 복원할 수 있다고 가정하면 안 된다. ([보관 저장](../../../src/services/customerKeepingService.ts#L115))
- 구매자 배송 카드에서는 이전 보관 상품을 합산할 수 있고, `includeKeepingInThreshold` 설정에 따라 무료배송 기준 금액에도 넣는다. 표시용 최종 총액은 이전 보관 금액도 포함한다. 이것은 **미수금 잔액 계산**이 아니다. 이미 입금한 보관 금액을 새 청구에 다시 넣지 않도록 별도의 청구·입금 배분 확인이 필요하다. ([BuyerShippingCard](../../../src/components/shipping/BuyerShippingCard.tsx#L80))
- `releaseKeeping`, `releaseAllBuyerKeeping` 서비스는 출고 상태를 기록하지만, 현재 배송 생성 함수는 이 함수를 호출하지 않는다. 보관 해제와 택배 생성이 원자적으로 묶였다고 볼 수 없다. ([보관 해제](../../../src/services/customerKeepingService.ts#L176), [배송 생성](../../../src/context/CommerceContext.tsx#L509))
- 현 배송 생성은 `회차:닉네임`으로 묶는다. 이전 회차까지 합친 명시적 합배송 그룹은 후속 설계다.

배송비는 무료 / 고정 / 조건부 무료 정책과 구매자·회차별 수동 지정이 있다. 기본값은 배송비 3,000원·50,000원 이상 무료이나 판매자가 변경할 수 있으므로 UI에 고정 규칙처럼 쓰지 않는다. 수동 배송비는 여러 회차가 섞인 선택에는 자동 적용하지 않는다. `remoteAreaFee` 필드는 있지만 현재 계산 함수는 주소로 도서산간을 판정하여 자동 가산하지 않는다. ([정책·수동 지정](../../../src/services/shippingService.ts#L7), [혼합 회차](../../../src/services/shippingService.ts#L100), [계산](../../../src/services/shippingService.ts#L202))

## 3. 입금·청구·배송의 현재 한계

현재 자동 입금 연결은 미결 정산서(QUEUED / SENT)를 대상으로, 동일 금액에 입금코드·닉네임·저장 별칭 근거가 있고 후보가 유일할 때 MATCHED로 연결한다. 금액만 같은 경우는 NEEDS_REVIEW다. 같은 구매자의 여러 정산서 합계가 입금액과 같아도 판매자 확인을 거친다. ([매칭 규칙](../../../src/services/paymentMatching.ts#L115))

판매자 수동 확인은 선택 정산서들을 PAID로 바꾼다. 현재 타입에는 부분입금 배분액·초과입금 잔액·환불 배분 원장이 없다. `isPaid(saleIds)`는 MATCHED 입금과 판매 ID 교집합 존재 여부를 검사한다. 따라서 이를 새 설계의 정밀한 완납·미수금 계산기로 그대로 사용하면 안 된다. ([입금 확인](../../../src/context/CommerceContext.tsx#L474), [`isPaid`](../../../src/context/CommerceContext.tsx#L352))

정산서 작성 후보에서는 보류·취소·서버 전송 대기·이미 입금 연결된 판매 등을 제외한다. 그러나 활성 미결 정산서에 이미 포함된 판매를 이 선택 필터가 모두 차단한다고 보장하지 않는다. 새 설계에는 청구 중복 방지와 판매 변경 이후 영향 확인이 필요하다. ([정산서 선택](../../../src/pages/seller/InvoiceManagementPage.tsx#L137))

배송 후보 화면은 보류·취소·전송 대기·구매자 미해결·이미 배송 연결된 항목을 제외하고, 발송대기 생성에 주소와 연락처를 요구한다. **입금 완료를 필수 조건으로 검사하지 않으며, 활성 보관 기록을 제외하는 검사도 없다.** 따라서 제안 UI의 “발송 가능”을 기존 함수 결과와 동의어로 사용해서는 안 된다. 완납·정보확인·보관 해제·판매 확정·중복출고 여부를 결합한 별도 판정이 후속 구현 사항이다. ([배송 후보·생성 검사](../../../src/pages/seller/ShipmentManagementPage.tsx#L112), [생성 함수](../../../src/context/CommerceContext.tsx#L509))

배송 안내 문자 요청에서 실패하지 않으면 SHIPPED로 변경한다. 실제 택배사 집하 확인과 같은 의미는 아니다. 또한 정산서의 `sentAt`도 발송 큐 등록 시점에 설정될 수 있다. 새 UI는 “요청함 / 전송 완료 / 실제 출고”를 각 데이터 근거에 맞춰 구분해야 한다. ([정산서 발송](../../../src/context/CommerceContext.tsx#L441), [배송 문자](../../../src/context/CommerceContext.tsx#L557))

## 4. 취소·반품·환불·약속미이행

판매 취소와 정산서 취소, 배송 취소는 서로 다른 객체의 상태다. 터치 판매 삭제는 판매를 취소·CANCELLED로 바꾼다. 이미 정산서나 입금에 사용한 판매의 가격·구매자·취소 수정은 현재 터치 UI에서 확인 안내를 하지만, 모든 하위 업무가 자동 재계산·환불되는 구현은 아니다. ([판매 취소](../../../src/context/SalesContext.tsx#L504), [하위 영향 안내](../../../src/pages/seller/TouchMobileSalesPage.tsx#L908))

`SaleStatus`에는 반품·환불이 없고 `ShipmentStatus`에도 RETURNED가 없다. 고객통계 함수는 레거시 값이나 메모에 등장하는 반품·환불 문자열을 판독하지만, 이것을 반품접수·검수·환불완료의 전용 업무 흐름이 존재한다는 뜻으로 읽으면 안 된다. ([판매 타입](../../../src/types/live.ts#L1), [배송 타입](../../../src/types/commerce.ts#L7), [통계 판독](../../../src/services/customerStatsIndex.ts#L44))

약속미이행은 **구매자 × 회차** 단위다. 판매자가 CONFIRMED / CANCELLED를 명시한 기록이 우선하고, 해당 회차에 명시적 결정이 있으면 자동 추정을 건너뛴다. 현재/활성 회차도 자동 미이행 계산에서 제외한다. 이전 회차의 취소·반품·환불/노쇼/미입금 메모, 취소되거나 기한이 지난 미입금 정산서 등에서 추정하고 회차별 Set으로 1회만 센다. ([기록 모델](../../../src/services/promiseDefaultService.ts#L3), [집계](../../../src/services/customerStatsIndex.ts#L74))

이 자동 추정에는 정상 취소도 섞일 수 있으므로 새 설계에서 “기한 초과 입금 대기”와 “판매자가 확정한 약속미이행”을 별도로 보여 주는 것이 타당하다. 판매 3건 미입금을 미이행 3회로 표시해서는 안 된다.

## 5. 대시보드 지표에 필요한 구분

| 지표 | 확인된 현재 기준 / 재설계 시 주의 |
|---|---|
| 판매금액 | 공통 `isBillableSale`은 보류·취소·recordState CANCELLED·AI NOT_SALE을 제외한다. PENDING 동기화는 이 함수가 제외하지 않는다. 새 대시보드의 “저장 완료 판매금액”은 서버 저장 조건을 추가해 명시해야 한다. ([함수](../../../src/services/billableSales.ts#L4)) |
| 기존 판매 목록의 확정금액 | `calculateSalesListRevenue.confirmedAmount`는 판매 status=확정만 더하는 금액이 아니라, billable 합계에서 판매자가 확정한 약속미이행 구매자·회차 금액을 제외한다. 완납액·입금액·이익과 다르다. ([계산](../../../src/services/salesListRevenue.ts#L11)) |
| 고객 누적 구매 | 고객 배지는 이전 회차의 유효 판매를 합산한다. 건수와 구매 회차 수를 별도로 센다. 현재 회차는 todayCount로 분리하며, 활성 회차 정보가 없을 때 최근 12시간을 현재로 취급하는 폴백이 있다. 이를 정확한 KST “오늘” 통계로 재사용하지 않는다. ([계산](../../../src/services/customerStatsIndex.ts#L65)) |
| 주문 수·상품 수·인원·택배 수 | 판매 행 수, quantity 합, 고유 buyerId 수, shipment 수를 각각 정의한다. 현재 데이터에서는 닉네임 기준 그룹도 있으므로 동명·개명 고객을 고려해야 한다. |
| 미청구 | 판매 저장, 구매자·금액 검토, 활성 청구 연결을 따로 확인해야 한다. 현재 “미입금” 또는 “판매금액−입금액”으로 대체하면 안 된다. |
| 미수금 | 청구금액에서 해당 청구에 실제 배분된 입금·환불·취소 조정을 계산해야 한다. 현재 구조로 모든 부분입금·초과입금을 정확히 계산할 수 있다고 표기하지 않는다. |
| 처리할 일 | 구매정보 불일치, 입금 대조, 저장 실패, 문자 전송 실패, 출력 실패, 배송 보류는 다른 작업이다. 한 건이 여러 문제에 걸릴 수 있어 카드 건수의 단순 합을 고유 주문 수처럼 제시하지 않는다. |

## 6. 구문서와 현재 구현의 차이

- 2026-09-30 구매요청 기반 판매 DESIGN은 장기 목표를 포함한다. 같은 폴더의 IMPLEMENTATION_STATUS는 당시 부분 적용 범위를 구분한다. 이 설계의 모든 Allocation / RequestLine / Outbox 모델이 현재 관리 영역에 존재한다고 전제하지 않는다.
- 2026-10-21 댓글터치 DESIGN의 “PC 필수 / 웹앱” 설명은 현재 전체 구조가 아니다. 현 구현에는 Android 판매 앱, 폰 단독 댓글·촬영, 폰 BLE 또는 PC 출력 선택이 있다. 관리 영역은 하나의 로그인 세션·WebView 안에서 판매 화면을 숨겨 유지하여 댓글·프린터가 계속 동작하도록 구성됐다. ([SalesAppShell](../../../src/components/common/SalesAppShell.tsx#L10), [TouchSettings](../../../src/types/touchSales.ts#L12))
- 새 제안에서 추가하는 작업 큐, 서버 집계 API, 입금 배분, 안정적인 합배송 그룹, 보관의 항목별 원장, 반품·환불 흐름은 **후속 설계**로 표시해야 한다. 현재 사용 가능한 기능과 섞어 완료 상태로 설명하지 않는다.

이 근거는 저장소 정적 확인에 한정한다. 개인정보·비밀키·운영 판매 기록을 열거나 수정하지 않았다.

## 7. 화면 간 집계와 조회 차이

아래 차이는 같은 관리 업무를 안드로이드와 웹에서 함께 재설계해야 하는 근거다. 현재 화면의 숫자를 그대로 새 카드에 옮기기보다, 공통 조회 조건과 상태 판정을 먼저 정의해야 한다.

1. **판매 목록과 문자비교의 구매금액 기준이 다르다.** 판매 목록의 구매자 합계는 `isBillableSale`을 적용하지만, 문자비교는 선택 회차의 모든 판매 행을 구매자로 묶은 뒤 보류·취소 등을 별도 제외하지 않고 금액을 합산한다. 새 화면의 청구 대상 금액과 입금 비교 금액은 동일한 유효 판매 집합을 사용해야 한다. ([판매 목록 합계:597](../../../src/pages/seller/SalesListPage.tsx#L597), [문자비교 대상:719](../../../src/pages/seller/CustomerMessagesComparisonPage.tsx#L719), [문자비교 금액:747](../../../src/pages/seller/CustomerMessagesComparisonPage.tsx#L747))

2. **선택 회차의 입금 조회는 실제 회차 귀속 조회가 아니다.** 판매 목록과 문자비교는 입금시각이 회차 시작 이후인지 검사하며 종료시각 경계는 두지 않는다. 날짜를 해석하지 못한 입금도 포함한다. 과거 회차를 선택하면 이후 다른 방송의 입금이 조회될 수 있고, 선택 회차에 귀속된 선입금은 시간 조건으로 빠질 수 있다. 새 조회는 정산서·판매 연결을 기준으로 귀속하고, 연결 전 입금은 미귀속 목록으로 분리해야 한다. ([판매 목록:495](../../../src/pages/seller/SalesListPage.tsx#L495), [문자비교:545](../../../src/pages/seller/CustomerMessagesComparisonPage.tsx#L545), [정산서 화면:165](../../../src/pages/seller/InvoiceManagementPage.tsx#L165))

3. **구매자별 입금 배지에 추정 연결이 섞일 수 있다.** 문자비교는 수동 연결, 판매 ID, 정산서 ID 순으로 구매자를 찾고, 연결이 없으면 입금자명과 닉네임의 부분문자열도 대조한다. 이 구매자 맵에 들어간 입금은 `matchStatus === MATCHED`를 필수로 검사하지 않고 합산하여 PAID / PARTIAL / OVERPAID를 표시한다. 새 UI에서는 미귀속 입금, 추천 후보, 확정 연결을 별도로 표시하고 추천 금액을 확인입금액에 합산하지 않아야 한다. ([구매자 매핑:576](../../../src/pages/seller/CustomerMessagesComparisonPage.tsx#L576), [이름 추정:604](../../../src/pages/seller/CustomerMessagesComparisonPage.tsx#L604), [배지 계산:641](../../../src/pages/seller/CustomerMessagesComparisonPage.tsx#L641))

4. **문자비교의 ‘매칭 완료’ 건수도 확정 연결 건수와 다를 수 있다.** 화면은 전체 입금 수에서 구매자 매핑에 실패한 입금 수를 뺀 값을 매칭 완료로 표시한다. 위의 이름 추정만으로 구매자 맵에 포함된 입금도 이 수에 들어갈 수 있다. 반면 commerce의 `isPaid`는 MATCHED 상태를 검사한다. 새 대시보드의 입금 확인 건수는 확정 상태와 배분 근거를 기준으로 집계해야 한다. ([미매핑 분리:616](../../../src/pages/seller/CustomerMessagesComparisonPage.tsx#L616), [매칭 완료 표시:1910](../../../src/pages/seller/CustomerMessagesComparisonPage.tsx#L1910), [`isPaid`:352](../../../src/context/CommerceContext.tsx#L352))

5. **판매 건수·구매자 수·평균 단가의 단위를 분명히 해야 한다.** 문자비교의 수신/입금 상태 수는 구매자 그룹마다 1씩 세지만 변수명은 `receivedSalesCount`, `paidSalesCount`다. 기존 정산 화면의 평균 단가는 유효 판매 행 금액 합계 ÷ 판매 행 수다. 구매자당 객단가나 상품 수량당 단가가 아니다. 새 UI는 판매 건·상품 개·구매자 명·정산서 건·배송 묶음 건의 단위를 명시해야 한다. ([구매자 기준 집계:762](../../../src/pages/seller/CustomerMessagesComparisonPage.tsx#L762), [평균 계산:107](../../../src/pages/seller/SettlementPage.tsx#L107))

6. **배송 취소 후 재출고는 별도 상태 설계가 필요하다.** 배송 후보는 CANCELLED 배송까지 포함한 모든 배송의 `saleIds`를 기등록 집합으로 만들며, 생성 함수도 기존 배송과 판매 ID가 하나라도 겹치면 생성하지 않는다. 따라서 배송을 취소했다고 자동으로 재출고 후보에 복귀하는 구현은 아니다. 새 설계는 취소 배송 이력을 보존하면서 재출고 명령과 현재 유효 배송 배정을 구분해야 한다. ([후보 제외:110](../../../src/pages/seller/ShipmentManagementPage.tsx#L110), [생성 중복 검사:519](../../../src/context/CommerceContext.tsx#L519))

7. **화면에 내려온 배열만으로 전체 업무 총계를 보장하기 어렵다.** commerce 조회는 워크스페이스별 테이블을 각각 조회해 배열로 변환하며, 이 경로에는 명시적인 페이지 순회나 전체 개수·완전성 메타데이터가 없다. 판매 조회에는 별도의 `range` 페이지 인자가 있다. 실제 서버 반환 제한이나 누락 발생을 운영에서 검증했다는 뜻은 아니지만, 새 대시보드에서 ‘전체’를 표시하려면 서버 집계 또는 완전성을 보장하는 페이지 조회 계약이 필요하다. ([commerce 조회:797](../../../src/services/remoteWorkspaceService.ts#L797), [판매 페이지 조회:645](../../../src/services/remoteWorkspaceService.ts#L645))

8. **여러 테이블의 현재 상태를 공통 기준으로 조회해야 한다.** 판매·정산서·입금·배송은 별개 데이터이고 commerce 변경도 테이블별 upsert로 전송된다. 지금의 각 화면 계산을 독립적으로 확장하면 조회 시점과 조건이 달라질 수 있다. 새 업무홈에는 서버 권한으로 제한한 scope, 집계 기준시각(`asOf`), 조회 완전성, 상태별 사유, 동일 조건의 상세 목록을 반환하는 공통 조회 계약이 필요하다. 이는 후속 설계이며 현재 API가 제공한다고 주장하지 않는다. ([commerce 테이블:30](../../../src/services/remoteWorkspaceService.ts#L30), [개별 조회:804](../../../src/services/remoteWorkspaceService.ts#L804), [테이블별 저장:873](../../../src/services/remoteWorkspaceService.ts#L873))
