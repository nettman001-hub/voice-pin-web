# 01. Windows 앱 범위와 웹 기능 전체 이전 명세

작성일: 2026-09-26. 문서 상태: **개발할 제품의 설계이며 구현 완료 보고서가 아니다.** 기준 자료는 [기존 전체 설계도](../PROJECT_REPLICATION_BLUEPRINT.md), [기존 웹 설계](../docs/replication/02_WEB_DESIGN.md), 그리고 아래에 연결한 실제 소스다. 운영 계정·고객 데이터·시크릿은 조회하지 않았다.

## 1. 제품의 완료 범위

제품명은 설계용 명칭 **VoiceCAP Studio for Windows**로 사용한다. 최종 상표·이름은 출시 전에 결정한다. 사용자는 설치 프로그램 하나로 로그인, 라이브 판매, 댓글 수집, 음성인식, 판매 검토, 고객 문자 업무, 정산·배송, 프린터 설정, 관리자 기능을 이용한다. 기존 댓글 도우미는 앱 내부의 기능이 되고 별도 프로그램 설치나 `127.0.0.1:2137` 서버 주소 입력을 요구하지 않는다.

소스 재사용 기준은 React/TypeScript 화면과 순수 업무 로직이다. Electron 44는 기존 lock 기준의 출발점이며, 새 배포 시점에 지원·보안 검토를 거쳐 잠근다. renderer는 화면, main은 인증·권한·OS 기능·네트워크의 조정자, utility process는 댓글 연결·STT 같은 무거운 작업을 맡는다. main이 감독하는 **Data broker utility process가 SQLite와 durable queue를 단독 소유**하고 Supabase가 공동 업무 데이터의 원본이 된다. 이 문서의 `voicecap-studio/`는 **앞으로 만들 구현 프로젝트의 경로**이며 이번 설계 작성으로 앱 코드가 생성되는 것은 아니다.

Windows 앱의 SIM 문자 발송 기능은 기존 Android 동반 앱을 통해 수행한다. Windows에 Android 기능 전체를 복제한다는 뜻은 아니다. 판매·기기·문자 관리 화면, 발송 요청, 진행 상황 확인은 Windows 안으로 옮기되 휴대전화의 문자 권한과 통신망은 Android가 담당한다. 휴대폰 미연결 상태에서도 판매·정산 초안은 사용할 수 있고 문자 발송은 대기/실패를 분명하게 표시한다.

### 개발자가 혼동하면 안 되는 네 가지 상태

| 표기 | 정확한 뜻 | 이번 문서의 적용 |
|---|---|---|
| 현재 구현 | 소스에 실제 처리 경로가 있음 | 외부 서비스·실기기 성공까지 증명한 것은 아님 |
| 현재 부분 구현 | 화면/서비스/서버 중 일부만 연결됨 | 남은 연결과 실패 복구를 개발해야 함 |
| 현재 시뮬레이션 | 로컬 상태·고정 데이터·모의 성공을 사용 | 시연 모드로 이전하고 운영 기능을 따로 완성해야 함 |
| Windows 제안 | 새로 구현할 설계 결정 | 전 항목이 개발·검증 대기 상태 |

**모든 웹 기능 이전**은 아래 WF-001~WF-067을 모두 접근·실행 가능하게 만드는 것이다. 화면이 없는 기능도 포함한다. 기존 시뮬레이션은 제품 내 명확한 시연 모드에서 보존하며, 실제 결제·훈련·삭제·신고·통계가 필요한 운영 기능으로 바뀌기 전에는 해당 업무를 완료했다고 표시하지 않는다. 출시 범위에서 원래 메뉴를 조용히 삭제하는 방법으로 완료 처리할 수 없다.

## 2. 라우트 전수 대응: 41개 선언

[현재 App.tsx](../src/App.tsx)의 `Route path` 리터럴은 `/`, `*`, 별칭, redirect를 포함해 **41개**다. 화면의 새 메뉴 이름이 달라도 주소 호환표는 유지한다. 새 앱은 내부 경로 라우터를 쓰며 아래 경로를 OS 파일 경로로 해석하지 않는다. 로그인 redirect/deep link는 허용 목록·세션 검증 후 main이 전달한다.

| 번호 | 기존 경로 리터럴 | 현재 요소/동작 | Windows 목적지 | 기능 ID |
|---|---|---|---|---|
| 01 | `/` | 초기화 후 로그인 상태·역할별 이동 | 시작 게이트 | WF-001 |
| 02 | `/onboarding` | OnboardingPage | 첫 실행 안내 | WF-002 |
| 03 | `/login` | LoginPage | 계정 로그인 | WF-003, WF-066 |
| 04 | `/signup` | SignupPage | 가입·이메일 확인 | WF-004 |
| 05 | `/password/reset` | PasswordResetPage | 계정 복구 | WF-005 |
| 06 | `/pricing` | PricingPage | 요금 안내 | WF-006 |
| 07 | `/privacy` | PrivacyPolicyPage | 개인정보 문서 | WF-007 |
| 08 | `/live` | LiveHomePage | 라이브 스튜디오 | WF-008~WF-019 |
| 09 | `/seller/product-sales` | ProductSalesPage | 상품 판매 | WF-020~WF-024 |
| 10 | `/sales/product` | 위 페이지 별칭 | 상품 판매의 정규 경로로 연결 | WF-020~WF-024 |
| 11 | `/voice-training` | VoiceTrainingPage | 음성 연습·평가 | WF-050 |
| 12 | `/training` | 위 페이지 별칭 | 음성 연습·평가 | WF-050 |
| 13 | `/recognition-rules` | RecognitionRulesPage | 인식·캡처·댓글 규칙 | WF-015, WF-026, WF-049 |
| 14 | `/rules` | 위 페이지 별칭 | 인식·캡처·댓글 규칙 | WF-049 |
| 15 | `/comments` | CommentRecordsPage | 댓글 기록 | WF-027, WF-028 |
| 16 | `/sales` | SalesListPage | 판매 작업 목록 | WF-029, WF-036, WF-037 |
| 17 | `/sales/:id` | SalesDetailPage | 판매 상세 패널/독립 경로 | WF-030, WF-034, WF-035 |
| 18 | `/sales/:id/capture` | CaptureViewerModal | 판매 증빙 이미지 뷰어 | WF-031 |
| 19 | `/sales/review` | SalesReviewPage | 방송 후 검토 | WF-032~WF-035 |
| 20 | `/invoices` | InvoiceManagementPage | 고객별 정산서 | WF-038, WF-039 |
| 21 | `/shipments` | ShipmentManagementPage | 배송 작업 | WF-040 |
| 22 | `/settlement` | SettlementPage | 판매 정산·CSV | WF-041 |
| 23 | `/seller/devices` | DeviceManagementPage | 연결 기기 | WF-042, WF-043 |
| 24 | `/devices` | 위 페이지 별칭 | 연결 기기 | WF-043 |
| 25 | `/seller/helper` | CommentHelperPage | 통합 장치·댓글 엔진 설정 | WF-044~WF-048 |
| 26 | `/helper` | 위 페이지 별칭 | 통합 장치·댓글 엔진 설정 | WF-044~WF-048 |
| 27 | `/subscription` | plans로 replace redirect | 구독 플랜 | WF-051 |
| 28 | `/subscription/plans` | PlanSelectionPage | 구독 플랜 | WF-051 |
| 29 | `/subscription/payment` | PaymentPage | 결제 진행·결과 | WF-052 |
| 30 | `/subscription/manage` | SubscriptionManagePage | 구독·결제 이력 | WF-053 |
| 31 | `/notifications/settings` | NotificationSettingsPage | 알림·소리 | WF-054 |
| 32 | `/settings/notifications` | 위 주소로 replace redirect | 알림·소리 | WF-054 |
| 33 | `/my` | MyPage | 계정·환경·데이터 관리 | WF-014, WF-042, WF-055, WF-056 |
| 34 | `/error/permission` | PermissionErrorModal | 권한 복구 안내 | WF-057 |
| 35 | `/admin` | AdminDashboardPage | 관리자 개요·STT 운영 | WF-058 |
| 36 | `/admin/sales` | AdminSalesManagementPage | 전체 판매·사용량 | WF-059 |
| 37 | `/admin/members` | MemberManagementPage | 회원·STT 이용권 | WF-060 |
| 38 | `/admin/reports` | ReportManagementPage | 신고 처리 | WF-061 |
| 39 | `/admin/stats` | AdminStatsPage | 통계·시스템 로그 | WF-062 |
| 40 | `/admin/ai` | AdminAiSettingsPage | AI 설정·진단 | WF-063, WF-064 |
| 41 | `*` | `/`로 replace redirect | 안전한 시작 경로 | WF-001 |

추가로 `/live?demo=start`, `/sales?session=...`, 판매 상세/캡처에서 돌아갈 때의 회차 query를 보존한다. `/sales/review`, `/sales/product`가 동적 `:id`로 오인되지 않도록 명시 경로 테스트를 둔다. 인증 전에는 공개 6개 페이지를 사용할 수 있고, 로그인 화면 로딩 중 빈 본문을 보이지 않는다. 관리자 여부는 메뉴 표시만으로 판정하지 않고 main 및 서버가 각각 검증한다.

## 3. 실제 소스 연결표

아래 S 번호는 기능표를 짧게 읽기 위한 근거 키다. 링크는 현재 저장소 파일이며 새 구현 파일을 의미하지 않는다.

| 소스 키 | 근거 파일/묶음 |
|---|---|
| S01 | [App.tsx](../src/App.tsx), [AuthContext.tsx](../src/context/AuthContext.tsx), [auth 폴더](../src/pages/auth) |
| S02 | [LiveHomePage.tsx](../src/pages/seller/LiveHomePage.tsx), [LiveContext.tsx](../src/context/LiveContext.tsx) |
| S03 | [audioCaptureService.ts](../src/services/audioCaptureService.ts), [deepgramService.ts](../src/services/deepgramService.ts), [localSttService.ts](../src/services/localSttService.ts), [captionStreamService.ts](../src/services/captionStreamService.ts) |
| S04 | [salesExtractor.ts](../src/services/salesExtractor.ts), [voiceCommandParser.ts](../src/services/voiceCommandParser.ts), [voiceSaleCandidate.ts](../src/services/voiceSaleCandidate.ts), [nicknameMatcher.ts](../src/services/nicknameMatcher.ts), [commentNicknameVerifier.ts](../src/services/commentNicknameVerifier.ts) |
| S05 | [ProductSalesPage.tsx](../src/pages/seller/ProductSalesPage.tsx), [ProductSalesContext.tsx](../src/context/ProductSalesContext.tsx), [productSalesApi.ts](../src/services/productSalesApi.ts), [productImageService.ts](../src/services/productImageService.ts) |
| S06 | [CommentCaptureContext.tsx](../src/context/CommentCaptureContext.tsx), [commentStreamService.ts](../src/services/commentStreamService.ts), [CommentRecordsPage.tsx](../src/pages/seller/CommentRecordsPage.tsx), [cloudCommentPublisher.js](../server/cloudCommentPublisher.js), [server/index.js](../server/index.js) |
| S07 | [SalesContext.tsx](../src/context/SalesContext.tsx), [SalesListPage.tsx](../src/pages/seller/SalesListPage.tsx), [SalesDetailPage.tsx](../src/pages/seller/SalesDetailPage.tsx), [SalesReviewPage.tsx](../src/pages/seller/SalesReviewPage.tsx) |
| S08 | [CaptureViewerModal.tsx](../src/pages/seller/CaptureViewerModal.tsx), [screenCaptureService.ts](../src/services/screenCaptureService.ts), [RecognitionRulesPage.tsx](../src/pages/seller/RecognitionRulesPage.tsx) |
| S09 | [pendingSalesService.ts](../src/services/pendingSalesService.ts), [voiceCorrectionService.ts](../src/services/voiceCorrectionService.ts), [SaleAiActionButtons.tsx](../src/components/sales/SaleAiActionButtons.tsx), [SaleAiEvidenceModal.tsx](../src/components/sales/SaleAiEvidenceModal.tsx) |
| S10 | [CommerceContext.tsx](../src/context/CommerceContext.tsx), [BuyerReconciliationPanel.tsx](../src/components/sales/BuyerReconciliationPanel.tsx), [CustomerStatsBadge.tsx](../src/components/sales/CustomerStatsBadge.tsx), [customerMessageParser.ts](../src/services/customerMessageParser.ts), [smsBridgeService.ts](../src/services/smsBridgeService.ts) |
| S11 | [InvoiceManagementPage.tsx](../src/pages/seller/InvoiceManagementPage.tsx), [ShipmentManagementPage.tsx](../src/pages/seller/ShipmentManagementPage.tsx), [SettlementPage.tsx](../src/pages/seller/SettlementPage.tsx), [csvExporter.ts](../src/services/csvExporter.ts) |
| S12 | [DeviceManagementPage.tsx](../src/pages/seller/DeviceManagementPage.tsx), [devicePairingService.ts](../src/services/devicePairingService.ts), [Android 설계](../docs/replication/05_ANDROID_DESIGN.md) |
| S13 | [CommentHelperPage.tsx](../src/pages/seller/CommentHelperPage.tsx), [commentHelperService.ts](../src/services/commentHelperService.ts), [main.cjs](../desktop/comment-helper/main.cjs), [preload.cjs](../desktop/comment-helper/preload.cjs), [도우미 UI](../desktop/comment-helper/ui) |
| S14 | [cloudPrintWorker.js](../server/cloudPrintWorker.js), [printJobStore.js](../server/printJobStore.js), [sttBridge.js](../server/sttBridge.js), [stt_worker.py](../server/stt_worker.py), [vulkanRunner.js](../server/vulkanRunner.js) |
| S15 | [AppDataContext.tsx](../src/context/AppDataContext.tsx), [storageService.ts](../src/services/storageService.ts), [VoiceTrainingPage.tsx](../src/pages/seller/VoiceTrainingPage.tsx), [subscription 폴더](../src/pages/subscription) |
| S16 | [MyPage.tsx](../src/pages/my/MyPage.tsx), [NotificationSettingsPage.tsx](../src/pages/my/NotificationSettingsPage.tsx), [PermissionErrorModal.tsx](../src/pages/my/PermissionErrorModal.tsx), [PrivacyPolicyPage.tsx](../src/pages/legal/PrivacyPolicyPage.tsx), [salesDemoService.ts](../src/services/salesDemoService.ts) |
| S17 | [admin 페이지](../src/pages/admin), [aiSettingsApi.ts](../src/services/aiSettingsApi.ts), [api 폴더](../api), [remoteWorkspaceService.ts](../src/services/remoteWorkspaceService.ts) |
| S18 | [supabaseClient.ts](../src/services/supabaseClient.ts), [authCredentialsService.ts](../src/services/authCredentialsService.ts), [Supabase 함수](../supabase/functions), [마이그레이션](../supabase/migrations), [API 계약](../contracts/product-sales/v1/README.md) |

## 4. 기능 이전 행렬

각 행의 완료 기준은 출시 인수에서 반드시 증거를 붙인다. `의존`은 앞 기능 또는 구성요소가 먼저 동작해야 한다는 뜻이다. 모든 저장·변경은 workspace와 역할 경계를 검사하며, 일시적으로 화면에 보인 값을 클라우드 저장 완료라고 부르지 않는다.

### 4.1 시작·인증·라이브

| ID / 근거 | 현재 기능·상태 | Windows 위치 | 이전 방법 | 의존 | 완료 기준 |
|---|---|---|---|---|---|
| WF-001 / S01 | 초기 로그인 확인·역할 이동·보호 route·unknown redirect 구현 | 시작 게이트 | 경로 표 유지, main 인증 스냅샷 기반 화면 전환 | WF-066 | 41개 경로를 비로그인/판매자/관리자로 진입해 의도한 결과, 무한 이동 없음 |
| WF-002 / S01 | 소개·시작 CTA 구현 | 첫 실행 안내 | 소개와 실제 첫 실행 장치 점검을 연결 | 설치 상태 | 가입/로그인/요금/정책이 모두 접근 가능, 뒤로 가기 복원 |
| WF-003 / S01,S18 | 로그인·데모 계정·자동 로그인 있음, 비밀번호 Base64 저장 | 로그인 | 실제 인증은 main broker, 시연은 별도 프로필; 비밀번호 재저장 제거 | Supabase Auth | 재시작 자동 로그인, 만료·정지·로그아웃 처리, renderer에 refresh token 없음 |
| WF-004 / S01 | 판매자 가입·OTP 확인/재발송·온보딩 호출 | 가입 | main → Auth → 온보딩 → workspace 순서 이식 | 이메일 환경, DB | 만료·중복 이메일·재발송 제한 처리, 클라이언트로 관리자 생성 불가 |
| WF-005 / S01 | 원격은 재설정 이메일 요청, 이후 저장 완료는 보완 필요; 로컬 검증 시뮬레이션 | 계정 복구 | 검증된 recovery callback과 실제 새 비밀번호 저장 연결 | Auth redirect | 새 비밀번호로 재로그인, 재사용/변조/만료 링크 거절 |
| WF-006 / S01,S15 | 요금 안내·플랜 선택 동선 | 요금 안내 | 서버 플랜 카탈로그와 결제 동선을 연결, 공개 접근 유지 | WF-051 | 가입 전후 같은 가격/혜택, 통화·청구주기·체험 조건 표시 |
| WF-007 / S16 | 개인정보 페이지 | 도움말·정책 | 버전이 있는 번들 정책+서버 최신 안내, 오프라인 열람 | 릴리스 문서 | 음성/댓글/고객/SMS 보관·처리 내용이 실제 기능과 일치 |
| WF-008 / S02,S05 | 새 회차/이어가기·청취 시작/중지·회차 판매 갱신 | 라이브 상단 | 회차와 청취 상태 기계 분리; main이 활성 회차 소유 | WF-024, WF-066 | 단순 로그인으로 회차 생성 안 됨, 중지·재시작에도 동일 회차 재개 |
| WF-009 / S03 | 탭 오디오·마이크 선택, 파형·볼륨 | 라이브 입력 장치 | 마이크 경로 이식; 방송 오디오는 Electron 캡처/WASAPI loopback 기술 검증 후 adapter로 제공 | OS 장치·권한 | 마이크/방송소리 각각 시험, 장치 분리/변경 복구, 탭 소리 지원을 확인 없이 단정하지 않음 |
| WF-010 / S03,S17 | Deepgram/Soniox 및 Web Speech 관련 경로 | 음성 엔진 선택 | 클라우드 STT 세션은 main/worker; 제공자·이용권·사용시간 기록 유지. Web Speech는 Electron 호환 검증 필요 | 관리자 STT 설정 | 최종 전사·끊김·재연결·사용량 확인, 제공자 키가 renderer/배포물에 없음 |
| WF-011 / S03,S14 | 로컬 Whisper STT, Python/Vulkan 경로 | 오프라인 음성 | 내장 worker 프로세스, 모델 설치/검증/중단 UI와 IPC | 모델·런타임 | 인터넷 차단 상태 전사, 오류 backend 설명, CPU fallback 명시, 응답 늦어도 UI 동작 |
| WF-012 / S02,S03 | 임시/확정 자막·두 줄 분할·흐름 | 라이브 자막 패널 | 순수 chunker 재사용, final ID와 generation 검증 | WF-009~011 | interim 교체와 final 추가 분리, 동일 final을 판매로 두 번 처리하지 않음 |
| WF-013 / S02 | 장기 무음 안내와 중지 카운트다운 | 라이브 입력 상태 | 기존 5분 무음·20초 카운트다운 정책을 명시 설정값으로 이식 | WF-009 | 음성 복귀/계속 청취 취소가 동작, 화면 이동만으로 몰래 청취 종료하지 않음 |
| WF-014 / S16,S02 | 시연 오디오 파형·댓글·전사·판매·정정 | 시연 모드 | 독립 SQLite/profile과 화면 배너; 실제 출력·문자·클라우드 쓰기 비활성 | 시연 fixture | demo=start와 수동 시작·종료 지원, 시연 종료 뒤 실제 자료 오염 0건 |
| WF-015 / S08 | 화면 공유·캡처 영역 드래그/크기조절·프리셋·시험·분리 | 라이브 증빙/설정 | desktop source 선택과 정규화 좌표 이식; 모니터 DPI 매핑 새 구현 | OS 캡처 | 다중 모니터·125/150/200% DPI·공유 중단 처리, 지정 영역·판매 연결 보존 |
| WF-016 / S04,S02 | 구매확정·상품등록·캡처·수정모드 음성 규칙 | 라이브 자동화 | 파서를 순수 domain으로 추출, 검증 결과만 command 실행 | WF-012, WF-049 | 부정·질문·불완전 발화는 자동확정하지 않고 규칙 테스트 그대로 통과 |
| WF-017 / S04,S05 | 음성 후보 생성·후속 발화 보완·상품 미리보기 | 후보 확인 패널 | 후보 ID/state/수명·회차를 main에서 관리, 취소 가능 | WF-016, WF-020 | 회차 변경 시 이전 후보 차단, 동일 상품/판매 후보 중복 commit 없음 |
| WF-018 / S04,S06 | 한글/영어/숫자/끝번호 닉네임 대조·댓글 근거 | 구매자 후보 | 순수 매칭 재사용, workspace/session/time window 함께 검사 | WF-025 | 다른 회차의 같은 닉네임으로 확정하지 않음, 애매한 후보는 선택 가능 |
| WF-019 / S07,S17 | 음성 판매 직접 DB 저장·캡처·자동 출력 | 라이브 판매 스트림 | legacy SaleRecord adapter를 두고 단계적으로 공통 command API/queue로 통일 | WF-018, WF-046, WF-065 | 가격·상태·보류근거·이미지·revision이 새 PC 재조회 후 일치 |

### 4.2 상품·댓글·판매 검토

| ID / 근거 | 현재 기능·상태 | Windows 위치 | 이전 방법 | 의존 | 완료 기준 |
|---|---|---|---|---|---|
| WF-020 / S05 | 상품번호·이름·가격·카메라/번호 이미지·draft/commit | 상품 등록 패널 | prepare→이미지→commit 계약 유지, 새 IPC repository | 회차·Storage | 가격 0/미입력 구분, 번호 앞자리 0 보존, 촬영 실패 시 명시적 번호 이미지 전환 |
| WF-021 / S05 | 활성 상품·목록·상품별 판매 조회 | 상품 판매 | 캐시+server revision으로 활성 상품 전환 | WF-020 | 여러 기기 변경 후 현재 상품 일치, 종료 회차에는 잘못 등록하지 않음 |
| WF-022 / S05 | 댓글 구매자 선택·해제·수량±·판매 확정 | 댓글 옆 판매 선택 트레이 | buyerId/sourceCommentIds 유지, command durable queue | WF-018, WF-024 | 같은 구매자 여러 댓글이 수량을 몰래 늘리지 않음; 선택·수량을 최종 확인 가능 |
| WF-023 / S05 | API에 상품/판매 변경 preview·commit·영향 정산 존재, 화면 노출 범위는 부분적 | 상품 수정 패널 | 기존 API 기능도 누락 없이 노출, before/after·previewToken 사용 | revision, 서버 transaction | stale preview 거절, 영향 금액·구매자·정산 경고와 저장 결과 일치 |
| WF-024 / S05,S18 | operationId·get-operation·revision·cursor API | 공통 작업 상태 센터 | Data broker의 durable outbox와 main 전송 조정, 재시도마다 동일 operationId, 충돌 UI | SQLite, Edge API | 응답 분실 후 조회로 복구; 동일 요청 중복 판매·통계·인쇄 생성 없음 |
| WF-025 / S06 | TikTok 수집·소켓·웹/도우미 클라우드 업로드 병존 | 내장 댓글 엔진+실시간 댓글 | 수집기 하나와 publisher 하나를 utility process/main에 통합; IPC로 배치 전달 | 회차, TikTok 연결 | 중복 제거·순서·재연결·ACK 기준 동기화, 웹과 도우미 이중 업로드 없음 |
| WF-026 / S06,S08 | TikTok ID·수집 토글·감지어·소리/팝업 설정 | 댓글 설정·알림 | workspace 설정과 장치 소리 설정 분리 저장 | WF-025, WF-054 | 설정 저장·재실행 유지, 수집 off와 일시 단절을 다른 상태로 표시 |
| WF-027 / S06 | 회차·기간·닉네임/내용 검색, CSV/TXT 다운로드 | 댓글 기록 | 서버 cursor 검색+가상 목록, native 저장 대화상자 | WF-025, WF-065 | 기존 5,000건 조회 상한을 전체 내보내기 완성으로 오인하지 않음; 모든 페이지를 내보내고 건수 표시 |
| WF-028 / S06 | 댓글 1건·선택·현재 필터 전체 삭제 | 댓글 기록 | 선택/필터 범위 확인, 권한 검증·감사 이력·판매 증거 보존 정책 | WF-027 | 페이지 밖 선택 범위 분명, 다른 회차/작업공간 삭제 불가, 이미 판매 근거인 항목 처리 일관 |
| WF-029 / S07 | 판매 회차 query·검색·상태·정렬·구매자 그룹/개별·CSV | 판매 작업 목록 | 원 기능 유지, column visibility·가상화·선택 상태 적용 | WF-019, WF-022 | 그룹합/개별합/CSV 동일, 상세 왕복 후 필터와 스크롤 유지 |
| WF-030 / S07 | 판매 상세·닉네임/금액 수정·삭제·상태·인쇄 | 상세 드로어+정규 경로 | 서버 optimistic concurrency, 변경 사유·revision 기록 | WF-024 | 저장 실패 시 값 복원/재시도, 다른 기기 수정 충돌을 덮어쓰지 않음 |
| WF-031 / S08 | 여러 캡처 넘기기·확대·다운로드 | 증빙 뷰어 | private URL 재발급, native 다운로드, Esc·화살표 | WF-065 | 만료 이미지 복구, 없는 판매/이미지 안내, 이전 회차 목록 복귀 |
| WF-032 / S07,S09 | 보류 행 닉네임/금액 수정·행 저장/삭제·일괄 확정 | 방송 후 검토 | 미해결 이유별 필터, 배치 검증 결과를 건별 반환 | WF-029, WF-033 | 필수값 부족 건은 보류 유지, 성공/실패 건수와 사유 표시 |
| WF-033 / S09 | 보류 사유·증거 스냅샷·후속 발화·규칙 우선 해결 | 보류 사유 패널 | 순수 rule engine 추출, 증거 snapshot 영구 저장 | WF-018, WF-065 | 규칙으로 해결되는 건에 AI 호출 불필요, 타회차 근거로 사유 제거 불가 |
| WF-034 / S09,S17 | AI 재검토·후보 적용·근거/이력 모달, 일부 모의 응답 존재 | AI 근거 패널 | 실제 task 상태·provider·근거·version 보존; 후보 검증 후 적용 | WF-063, WF-064 | 근거 부족/서비스 장애 구분, AI가 생성한 임의 ID·가격을 무검증 저장하지 않음 |
| WF-035 / S09 | 음성 정정·대상 매칭·후속 발화·rollback | 라이브/상세 정정 이력 | 이전값·후값·revision·출력 영향 저장, 후속 결제/배송 잠금 정책 | WF-030, WF-046 | 원 판매 ID 유지, 금액/구매자 정정·되돌리기·정정 전표 구분 |

### 4.3 고객·정산·기기·내장 도우미

| ID / 근거 | 현재 기능·상태 | Windows 위치 | 이전 방법 | 의존 | 완료 기준 |
|---|---|---|---|---|---|
| WF-036 / S10 | 고객 문자/구매정보 대조·확인완료·주소/금액 수정·문의문자·MMS 열람 | 판매 고객 패널 | Commerce repository·Android bridge 유지, main이 발송 큐 상태 중계 | WF-042, WF-065 | 업무 문자만 연결, 미일치 사유 표시, 발송 요청/휴대폰 전송 결과 구분 |
| WF-037 / S10 | 고객 구매횟수·누적액·첫 구매·미입금/취소 등 배지 | 구매자 카드/표 | 현 규칙의 집계 테스트 확보 후 서버 집계로 이전 | WF-029, WF-038 | 닉네임이 같은 다른 고객 혼합 방지, 회차/전체 통계 기준 표시 |
| WF-038 / S10,S11 | 판매 선택→정산서 생성/발송/취소·상태 | 정산서 | 명시 금액·판매 연결·메시지 템플릿 유지, 서버 원본으로 저장 | WF-036 | 같은 판매 중복 청구 방지, 발송 실패가 정산서 완료로 표시되지 않음 |
| WF-039 / S10 | 문자 동기화 입금자료·isPaid·정산서/판매 대조 | 고객 입금 확인 | 기존 receipt 모델 이식, 수동 확인과 자동 대조 출처 표시 | Android bridge, WF-038 | 송금 확정과 텍스트 추정 구분, 부분/초과/취소 후 재대조 기준 일치 |
| WF-040 / S10,S11 | 판매→배송건 생성·수취인/주소·택배사/송장·포장/발송/완료·문자 | 배송 작업 | 상태별 command·발송 큐·고객 정보 마스킹 | WF-036, WF-039 | 한 판매 이중 배송 방지, 발송 실패 재시도, 배송완료를 택배사 실시간 조회로 오인하지 않음 |
| WF-041 / S11 | 보류 제외 합계·평균·일자/회차 그룹·전체/그룹 CSV | 정산 분석 | 확정된 집계 규칙을 domain에 고정, native export | WF-029 | 수량×단가·취소·보류·정정 반영, CSV와 화면 합계 및 시간대 동일 |
| WF-042 / S12,S16 | 만료·1회성 Android pairing 코드 생성 | 연결 기기·계정 | 기존 Edge pairing 재사용, main이 인증/재발급 중계 | workspace, Android | 만료·재사용 거절, 연결 후 Android Fake→Real 전환 확인 |
| WF-043 / S12,S05 | 기기 목록·capability 변경·출력 기기 선택 | 연결 기기 | revision·권한·audit 유지, 현재 PC를 명확히 표시 | WF-042, WF-024 | 비허용 장치 판매/인쇄 차단, 출력 기기 교체 후 이전 기기 중복 출력 없음 |
| WF-044 / S13 | 별도 도우미 상태·트레이·연결·UI | 앱 통합 상태 센터·트레이 | Electron main lifecycle과 댓글 worker 통합, 별도 설치 안내 제거 | WF-025 | 설치 하나/트레이 하나/수집기 하나, 창 닫기와 완전 종료 동작 명확 |
| WF-045 / S13 | 프린터 조회·기본 선택·용지·자동출력·시험인쇄 | 설정 > 출력 | getPrintersAsync·안전한 print IPC·설정 SQLite 이식 | Windows driver | 실제 라벨/일반 용지, 한글·긴닉네임·여백 시험, 프린터 제거 복구 |
| WF-046 / S14,S07 | 직접 print:sale 있음; cloud worker 시작 경로는 부분 구현 | 출력 대기열 | legacy/API 양 경로를 하나의 job consumer로 연결; lease·ACK·revision 저장 | WF-045, WF-024 | spool 접수와 종이 출력 구분; 제출 성공 journal이 있으면 ACK만 재시도, 제출 여부 자체가 불명확하면 UNKNOWN; 재출력은 사유와 새 job |
| WF-047 / S13,S14 | STT 장치 감지·설정·모델/가속 엔진 관리 | 설정 > 음성 엔진 | worker inventory/status/control IPC, 다운로드 무결성·취소·진행률 | WF-011 | GPU 명칭만으로 실제 가속 성공 표시하지 않음, 모델 누락/메모리 부족 복구 |
| WF-048 / S13 | 자동 실행·서버 재시작·로그·업데이트 | 설정 > 앱·문제 해결 | 앱 시작 옵션/worker 재시작/진단 번들·서명 업데이트로 통합 | 설치·릴리스 | 방송 중 업데이트 연기, 재시작 범위 설명, 토큰·고객문자 없는 진단 파일 |

### 4.4 설정·상업 운영·관리자

| ID / 근거 | 현재 기능·상태 | Windows 위치 | 이전 방법 | 의존 | 완료 기준 |
|---|---|---|---|---|---|
| WF-049 / S08,S15 | 인식단어 추가/수정/삭제/활성·필수 규칙·캡처 설정 | 인식 규칙 | workspace revision 기반 저장, 장치 캡처 원본은 로컬 분리 | WF-016 | 필수 규칙 보호, 충돌/저장실패 표시, 새 PC 원격 복원 |
| WF-050 / S15 | 훈련 문장·횟수·예상 정확도 증가·완료 효과 **시뮬레이션** | 음성 연습·평가 | 기존 시연 보존; 운영은 실제 녹음→전사→정답 비교·사전 보정으로 구현 | WF-009~011 | 실제 측정/연습횟수/시연 수치를 구분; 모델 학습이라고 부르려면 데이터·학습·평가 파이프라인 별도 완성 |
| WF-051 / S15 | 베이직/프로/프리미엄 선택·7일 체험 로컬 UI | 구독 플랜 | 서버 카탈로그/entitlement, 시연 플랜 분리 | WF-006, WF-052 | 재설치·다른 PC로 체험기간 초기화 불가, 서버 시각 기준 상태 |
| WF-052 / S15 | 카드 폼·로컬 결제 이력·성공 효과 **모의 결제** | 결제 진행 | PG hosted checkout를 시스템 브라우저로 열고 서버 webhook 검증 후 앱 반영 | PG 계약·결제 서버 | 성공/취소/실패/중복 webhook/환불 시험; raw 카드/CVC/생년월일을 앱 DB·로그·백업에 저장하지 않음 |
| WF-053 / S15 | 현재 플랜·만료일·결제 이력·해지 UI **부분 시뮬레이션** | 구독 관리 | 서버 결제 이력·갱신/해지 예약·만료 권한과 연동 | WF-052 | 결제 성공 전 플랜 상승 금지, 해지 예약과 즉시 권한종료 구분 |
| WF-054 / S15,S16 | push/email 토글·브라우저 알림·시험 소리; 서버 전달은 미완성 | 알림·소리 | native toast/sound, 이메일 provider·서버 이벤트 연동, 조용한 시간 | OS 알림, 서버 | 토글별 전달 검증, 권한거절/집중지원 설명, 이메일 시험 수신 증거 |
| WF-055 / S16,S01 | 프로필·음성입력·로그아웃; 탈퇴 버튼은 접수 alert+logout | 계정·개인 설정 | 실제 프로필 저장 성공 표시, server deletion request·재인증·진행조회 신규 | Auth, 삭제 정책 | 탈퇴가 실제 요청 상태로 추적되고 토큰 철회, 보관 대상/삭제 대상 안내 일치 |
| WF-056 / S16,S15 | legacy JSON 백업/복원, 클라우드 전체 백업 아님 | 데이터 관리 | legacy importer+버전있는 export manifest·복원 미리보기·원본 출처 표시 | WF-065 | 스키마·중복·workspace 검사; 설정 백업과 클라우드 업무자료 내보내기를 구분 |
| WF-057 / S16 | 권한 오류 모달·뒤로/재시도 | 권한 복구 센터 | OS 마이크/화면/파일/알림/프린터별 설명과 허용 목록 Settings link | OS 정책 | 거절 상태에서 무한 재요청 없음, 사용자가 복구한 뒤 재시도 가능 |
| WF-058 / S17,S15 | 관리자 개요·STT 제공자 선택·Deepgram/Soniox 키 관리·AI 상태; KPI 일부 상수 | 관리자 운영 개요 | 키는 서버 vault; main은 입력 전달·마스킹 결과만 받음; 실제 집계 연결 | 관리자 claim, backend | 일반 판매자 직접 호출 거절, 저장한 원키 재조회 불가, KPI 기준시각·데이터 출처 표시 |
| WF-059 / S17 | 전체 판매·판매자/회차 펼침·검색·STT 사용량/로그 | 관리자 판매·사용량 | 서버 관리자 조회 API, pagination·기간 범위·export 정책 | WF-058 | 판매자 workspace 밖 접근 불가, 관리자 합계가 정의된 상태 집계와 일치 |
| WF-060 / S17 | 회원 검색/필터·정지/해제·사유·STT 이용권·사용량 로그 | 관리자 회원 | 현재 Edge 관리 API 보존+감사로그·동시수정 보호 | 서버 권한 | 정지 후 세션/유료 STT 차단, 해제 후 복구, 변경 actor/reason 저장 |
| WF-061 / S15,S17 | 신고 필터·접수/처리중/완료·정지 연계, 신고 상태 로컬 저장 | 관리자 신고 | 서버 reports·history 신규, 정지 API 성공과 신고완료 원자적 정책 | WF-060 | 재실행/다른 관리자 PC에서 상태 동일, 실패한 정지를 성공 완료로 표기하지 않음 |
| WF-062 / S15,S17 | 통계·시스템 로그 검색·일부 고정 KPI/예시 데이터 | 관리자 통계·진단 | 이벤트 집계/오류 수집 연결, 익명화·보관기간·데모 분리 | 관측 backend | 0건과 집계실패/미수집 구분, 계산식과 원본 집계 교차 확인 |
| WF-063 / S17 | AI 2슬롯·provider/model/endpoint/secret·우선순위·저장/적용 버전·fallback | 관리자 AI 설정 | draft/applied 분리, 서버 비밀값 저장, local engine endpoint는 main worker만 호출 | 관리자 권한, AI adapter | 저장과 적용 구분, 비밀값 마스킹, 테스트 결과 유효기간·실행 위치 표시 |
| WF-064 / S17,S09 | AI health/model목록/진단/fallback/복귀 설정, PC task runner 부분 구현 | AI 진단·작업 센터 | PC_HELPER 의미를 내장 worker로 치환, task claim/timeout/result 연결 | WF-063, durable queue | QUEUED 영구 방치 없음, 서버가 자기 loopback을 판매자 PC로 오인하지 않음 |
| WF-065 / S17,S18 | Supabase CRUD/Realtime·workspace 설정·private image URL·로컬 cache | 공통 data broker | Data broker 단일 SQLite 소유, main 인증/전송, SQL 마이그레이션·캐시·outbox·remote adapter | DB/RLS/Storage | 재로그인/다른 PC/오프라인 후 복원, 판매 메타 필드 누락 0, 만료 URL 재발급 |
| WF-066 / S18 | 현재 renderer Supabase 및 localStorage 자동 로그인 자격증명 | main 인증 broker | refresh token은 OS 암호화 저장; access token main 메모리, preload는 좁은 command API | OS 사용자 계정 | renderer에 저장된 자격증명 조회/임의 fetch/SQL API 없음; 로그인 입력은 전달 후 제거하고 영구 저장 금지 |
| WF-067 / S01 | Header/Sidebar/접기 localStorage·모바일 하단내비 | Windows 공통 shell | 메뉴 기능 보존·창 크기/DPI/키보드/검색·상태바 추가 | UI 시스템 | 모든 메뉴 키보드로 접근, 저장된 메뉴/창 상태 복원, 인증/관리자 경계 일관 |

## 5. 화면에 가려져도 옮겨야 하는 API 계약

[productSalesApi.ts](../src/services/productSalesApi.ts)의 메서드/액션을 아래처럼 포함한다. UI가 현재 일부만 호출한다는 이유로 API 기능을 버리지 않는다. 기존 request/response의 ID·revision·cursor·operationId 의미를 유지하고 새 API를 만들면 계약 버전을 올린다.

| 계약 범위 | 기존 액션 | 연결 기능 |
|---|---|---|
| 초기화·설정 | `get-bootstrap`, `update-settings` | WF-008, WF-049, WF-065 |
| 기기 | `list-devices`, `update-device-capabilities`, `set-output-device` | WF-043 |
| 회차 | `start-session`, `end-session`, `list-sessions` | WF-008 |
| 상품 등록/선택 | `prepare-product`, `update-product-draft`, `commit-product`, `activate-product`, `list-session-products`, `get-product-sales` | WF-020, WF-021 |
| 댓글·구매자 | `get-sales-feed`, `ingest-comments`, `list-live-comments`, `delete-live-comments`, `search-buyers`, `confirm-buyer` | WF-018, WF-025~WF-028 |
| 판매·복구 | `commit-sales`, `get-operation` | WF-022, WF-024 |
| 변경 미리보기/저장 | `prepare-product-image`, `preview-product-change`, `commit-product-change` | WF-023 |
| 출력 | `request-reprint`, `get-print-status` | WF-046 |

추가 경로는 `aiSettingsApi`, `remoteWorkspaceService`, `smsBridgeService`, `devicePairingService`와 `supabase/functions`의 실제 dispatch를 함께 확인한다. 특히 관리자 STT 설정/사용량·회원 상태, 보류/정정 AI task, workspace settings, SMS 동기화/발송은 상품 API 표만으로 덮이지 않는다. 구현 시작 시 action 목록을 생성하고 계약 fixture 없는 action에 fixture를 추가한다.

## 6. 판매용 완성을 위해 원본과 달라져야 하는 항목

이 표는 결함을 이미 수정했다는 보고가 아니라 **필수 후속 개발**이다. 이전 설계의 R01~R15와 연결되며 [개발·검증 계획](06_IMPLEMENTATION_AND_TEST_PLAN.md)의 단계별 gate에서 막는다.

| 코드 | 확인한 현재 차이 | Windows 설계에서 반드시 처리할 내용 | 관련 WF |
|---|---|---|---|
| D01 | 상품 예약 `expires_at` 코드/SQL 차이, 회차 번호와 workspace 유일성 차이 | 실제 schema 검사 후 새 migration; `(workspace, session, code)` 정책·legacy 회차 매핑·예약 만료 일치 | 008,020,024 |
| D02 | 연속 CRUD를 DB transaction으로 보장하지 못함 | 판매·이력·출력 job·operations·change log를 같은 DB transaction으로 확정하고 집계의 기준도 일치시킴. 실제 인쇄 등 외부 효과는 commit 뒤 별도 실행 | 019,022~024,046 |
| D03 | 일부 보조 API/RLS 역할·membership 검증 보완 필요 | renderer/main/Edge/DB/Storage 모두 음성/상품 경로 교차테넌트 시험 | 003,058~066 |
| D04 | Realtime publication 선언과 action contract 범위가 부족 | 적용 SQL·poll fallback·전 action fixtures·버전 호환 명시 | 024,065 |
| D05 | 직접 판매 변환이 일부 보류·AI 메타 필드를 보존하지 않음 | 상태·증거·후보·정정이력·revision·이미지의 왕복 저장 계약 | 019,030~035 |
| D06 | AI worker 소비/PC 연결, cloud print worker 시작 미연결 | 앱 시작/중지와 lease/heartbeat/timeout 연결; 불명확 결과 상태 | 034,046,064 |
| D07 | prepare-product-image 예시 URL·댓글 모의 성공 가능 | 실제 Storage signed upload, ACK된 DB 행만 동기화 성공 집계 | 020,023,025 |
| D08 | 2137 HTTP auth와 도우미 REST 헤더 차이 | 새 앱 내부는 typed IPC로 교체; 호환용 공개 로컬 서버를 기본 배포하지 않음 | 025,044~048 |
| D09 | 결제/훈련/통계/신고/알림 일부 시뮬레이션 | 시연 분리+위 WF별 운영 backend/실측 기능; 가짜 성공·가짜 정확도 금지 | 050~054,058,061,062 |
| D10 | 탈퇴 alert+로그아웃, 비밀번호 복구 저장 단계 부족 | 서버 요청·토큰 철회·recovery callback 완성 | 005,055 |
| D11 | Android 연결 후 repository 전환·문자 수신 저장/MMS 검증 부족 | companion 회귀/실기기 gate; Windows만 완성하고 SMS 완료라고 판단 금지 | 036,039,042 |
| D12 | 테스트가 실제 APPDATA STT 설정을 변경할 수 있음 | 테스트 환경 userData 강제 주입, 사용자 설정/DB/프린터와 격리 | 011,047,048 |

## 7. 기능 누락 판정 방법

1. `src/App.tsx`에서 41개 경로 리터럴을 추출해 2장과 비교한다. 경로만 맞추고 빈 화면을 만드는 것은 불합격이다.
2. WF-001~WF-067 각각의 UI 진입점·IPC command·server action·테스트 증거를 기능 기록에 연결한다. 관련 없는 층은 `해당 없음: 순수 화면`처럼 이유를 기록한다.
3. 실제 업무 회차를 가짜 고객으로 끝까지 수행한다. 댓글/음성 두 경로, 수동 상품 판매, 정정, 재출력, SMS 대조, 정산·배송, 관리자 조회를 모두 확인한다.
4. 원본과 동일한 조회 자료를 열어 건수·합계·상태·이미지·보류근거가 일치하는지 비교한다. 같은 화면이라는 이유로 데이터 기능이 같다고 판단하지 않는다.
5. 운영 미완성 항목은 필수 개발로 남긴다. “시연 가능”은 영업 시연 gate이며 “실사용 출시” gate를 통과한 것이 아니다.

전수 기능의 구체적인 개발 순서, 환경 격리, 회귀·실기기·성능 합격 조건은 [06. 구현과 검증](06_IMPLEMENTATION_AND_TEST_PLAN.md)을 따른다.
