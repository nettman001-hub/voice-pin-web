# 댓글터치 판매방식 · 구현 및 검증

사용자가 제공한 `댓글터치 판매방식 · VoiceCAP 판매 앱 설계.md`와 구매 댓글 깜빡임 추가 요청을 구현한 변경입니다. 운영 배포와 실제 방송 리허설은 별도입니다.

## 사용 흐름

1. PC 라이브 청취 홈에서 **댓글터치**를 선택합니다. 설정은 판매자 작업공간에 저장합니다.
2. 새 회차 판매 시작 또는 현재 회차 이어하기를 누르고 방송 탭의 화면과 오디오를 공유합니다. STT와 AI 판매 판단에는 연결하지 않습니다.
3. **판매 폰 열기** QR로 `/sell`을 열어 같은 판매자 계정으로 로그인합니다. 홈 화면에는 **VoiceCAP 판매**로 추가합니다.
4. 구매 댓글의 행 전체가 노란색으로 깜빡입니다. 깜빡이는 댓글 하나를 터치하면 현재 구매 알림 전체를 확인 처리하고, 그 행에만 파란 선택 표시를 남깁니다. 이후의 새 구매 댓글은 다시 깜빡입니다. 이미 확인한 행이나 일반 댓글을 누르면 새 알림은 유지합니다.
5. 확인 → 가격 입력 → 확정. `1.5`는 15,000원, `15000`은 15,000원입니다. 100~999는 단위 확인을 요구합니다.
6. 판매·선택 댓글 한 건·전표 작업·캡처 상태를 SQL 트랜잭션으로 저장합니다. 상태는 자동저장, 출처는 ANDROID_COMMENTS입니다.
7. PC가 서버 작업을 가져가 전표를 접수하고, **폰의 보정된 확정 시각 + 준비 시간 + 방송 지연** 장면을 해당 판매에 연결합니다.
8. 판매내역에서 가격/구매자 정정, 취소, 재출력, 재촬영, 다른 장면 선택을 할 수 있습니다.

## 구현 위치

| 영역 | 주요 파일 |
|---|---|
| 고객 통계 공통 표 | `src/services/customerStatsIndex.ts`, `src/context/CustomerStatsContext.tsx` |
| 원자적 저장·대기열·수정 | `supabase/migrations/202610210001_touch_sales.sql`, `supabase/functions/sales-api/handlers/touchSales.ts` |
| PC 운영 | `src/components/live/TouchDesktopPanel.tsx`, `src/services/touchPcWorker.ts` |
| 직접/예비 댓글 연결 | `src/services/touchSalesBridge.ts` |
| 지연·시계·최근 프레임 | `touchDelayEstimator.ts`, `touchClock.ts`, `touchFrameBuffer.ts` |
| 폰 화면 | `sell.html`, `src/mobileMain.tsx`, `src/pages/seller/TouchMobileSalesPage.tsx` |
| 댓글 표시·가격 입력 | `src/components/touch/`, `src/styles/touchSales.css` |
| 오프라인 저장·예비 사진 | `src/services/touchLocalStore.ts` |
| 관리자 현황 | `/admin/sales-phones`, `TouchPhoneConnectionsPage.tsx`, `202610210002_touch_sales_monitoring.sql` |

## 운영 전 적용 순서

운영 DB에는 실행하지 않았습니다. 검토·병합·배포 지시를 받은 뒤 적용합니다.

1. 현재 main의 기존 마이그레이션이 적용되어 있어야 합니다. 기존 sales, live_sessions, buyers, print_jobs, sale_revisions, voicecap-private 저장소를 사용합니다.
2. SQL Editor에서 `202610210001_touch_sales.sql`, `202610210002_touch_sales_monitoring.sql`을 순서대로 적용합니다. SQL은 재실행 가능하게 작성했고 PGlite에서 재실행도 검증합니다.
3. Supabase Realtime의 private Broadcast 권한과 `supabase_realtime` publication의 sales, touch_sale_details, touch_sales_runs, live_sessions, buyers 등록을 확인합니다. 신규 SQL은 publication이 존재하면 필요한 표를 추가합니다. 공개 채널로 우회하지 않습니다.
4. `sales-api` Edge Function을 배포합니다. 브라우저에는 서비스 역할 키를 넣지 않습니다.
5. `npm run build`로 PC/폰 두 HTML 진입점을 빌드하고 Vercel에 배포합니다. `/sell`은 `/sell.html`로 연결합니다. 폰 진입점은 LiveProvider, STT, 화면 공유, 로컬 댓글 도우미를 마운트하지 않습니다.
6. 기존 댓글 도우미는 업데이트하지 않습니다. 새 화면의 작업을 기존 `print:sale` 프로토콜로 전달합니다. 기존 서버 cloudPrintWorker는 켜지 않습니다.
7. 실제 판매자 시험 회차로 아래 리허설을 수행합니다.

## 자동 검증

- `npm test`: 기존 음성·판매 회귀 테스트와 새 통계/가격/SQL/권한/시계/캡처/오프라인 테스트.
- `npx tsc --noEmit`: 웹 타입 검사.
- `npx vite build`: 실제 번들 빌드. 기존 사용자가 수정한 `api/live-test-inference.js`를 다시 생성하지 않고 웹 빌드를 확인할 때 사용합니다.
- `npm run test:touch-ui`: 실제 Chromium WebRTC와 운영 폰 컴포넌트를 사용하는 격리된 브라우저 테스트. 로그인/DB 저장은 픽스처이며 운영 계정·전표 출력·방송에는 접속하지 않습니다.
- `node scripts/benchmark-touch-stats.mjs`: 합성 고객 1,000명, 판매 10,000건의 공통 표 조회 성능과 합계 확인.

브라우저 검증은 Playwright와 Chromium이 필요합니다. 일반 환경에서는 `npx playwright install chromium` 후 실행합니다. 기존 Chromium을 사용할 경우 `VOICECAP_CHROMIUM_PATH`로 실행 파일을 지정할 수 있습니다.

결과와 화면은 `artifacts/touch-sales/report.html`에 모읍니다. 수치는 해당 환경에서 측정한 결과이며 장치별 보장을 뜻하지 않습니다.

## 실제 기기 리허설에서 확인할 것

- SMS 앱이 실행 중인 Android Chrome과 iPhone Safari의 로그인·홈 화면 추가·화면 유지.
- 같은 와이파이와 LTE에서 직접 연결, 실패 시 비공개 예비 연결, 재접속 후 최근 500개 복구.
- 방송 소리 공유와 폰 마이크 허용 후 손뼉/발화의 실제 지연. 무음·잡음·PC 스피커 유입 때 잘못 갱신하지 않는지.
- 실제 프린터의 용지·드라이버·응답, PC 두 탭의 출력 한 번 처리, 출력 여부 불명 시 종이 확인 후 재출력.
- 방송 화면의 상품 사진, 지연 5/8초 환경, 상품 교체 직전/직후 사진과 예비 장면.
- 폰 화면 잠금, 앱 전환, 인터넷 중단, PC 창 닫기·절전·재접속, 회차 종료 후 남은 요청.

## 동작의 한계와 복구

- RMS 소리 크기 상관관계는 추정입니다. 패턴이 약하거나 겹치거나 0초 스피커 에코가 우세하면 갱신하지 않습니다. 세 번의 유효 측정 중앙값을 사용하고, 불가할 때 최근 측정값 또는 기본 6초 설정을 사용합니다. 모든 방송에서 자동 측정 성공이나 0.1초 정확도를 보장하지 않습니다.
- 원본 음성은 저장하거나 폰에서 PC로 전송하지 않습니다. 20Hz 크기 숫자만 직접 연결로 보냅니다. 예비 연결에는 음성 숫자나 예비 사진을 보내지 않습니다.
- 최근 프레임은 정상적으로 실행 중인 PC에서 약 2Hz, 30초 범위로 보관합니다. PC 창이 숨겨지거나 절전·브라우저 중단이 발생하면 타이머와 화면 수신이 늦어질 수 있습니다. 프레임이 없으면 다른 시점의 사진으로 대체하지 않고 캡처 없음으로 남깁니다. PC 창을 보이는 상태로 유지합니다.
- 자동 사진은 한 장입니다. 전후 2초 예비 장면은 PC IndexedDB에서 24시간 유효하며 만료 데이터는 접근/저장 시 정리합니다. 다른 장면을 선택하면 이전 서버 사진을 교체합니다.
- 캡처 요청 식별자가 일치하고 아직 대기 중인 요청만 사진을 저장합니다. 재촬영 이전의 늦은 요청이나 이미 완료된 요청은 새 사진을 덮어쓰지 못합니다.
- 출력 접수와 종이 배출은 다릅니다. 서버에 SUBMITTING을 기록한 뒤 도우미에 전달합니다. 접수 후 결과가 불명확하면 자동 반복하지 않고 확인 필요로 남깁니다.
- PC가 꺼진 동안 서버에 저장된 판매는 유지됩니다. PC 재연결 후 출력은 재개할 수 있지만, 이미 지나서 확보하지 못한 영상은 복원할 수 없습니다.
- 종료된 회차의 미전송 요청은 판매자가 명시적으로 현재 회차로 옮길 수 있습니다. 원래 시각·작업 번호를 남기고 사진은 재촬영 대상으로 둡니다. 다른 상품의 현재 장면을 자동으로 붙이지 않습니다.
- 월 메시지 수는 이 기능의 Broadcast/연결 추정치입니다. Supabase의 전체 실제 과금 수치는 Usage에서 확인해야 합니다.

## 설계와 구분한 구현 판단

- 상태는 첨부 MD의 자동저장 + 앱을 따랐습니다. 앞선 대화에서 제안했던 확정 기본값을 적용하지 않았습니다.
- Android 네이티브 앱이나 SMS 앱의 판매 탭을 만들지 않았으며 독립 웹 진입점을 사용합니다.
- 전표 처리와 캡처 예약 조회는 각각 진행하여, 느린 프린터가 나중 주문의 캡처를 막지 않게 했습니다.
- 공개용 실시간 채널·TURN·댓글 전체 DB 적재를 추가하지 않았습니다. 구매 의사 강조에는 기존 결정적 판별 함수를 사용합니다.
- 전역 관리자 여부는 사용자가 수정 가능한 user_metadata가 아니라 서버 app_metadata로 판단합니다.
