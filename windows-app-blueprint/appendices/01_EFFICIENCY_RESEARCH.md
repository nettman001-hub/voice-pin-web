# 첨부 01. 설계 완성 후 효율 개선 연구 보고서

조사일: 2026-09-26 · 대상: VoiceCAP Studio for Windows 설계 1.0

[전체 설계](../README.md) · [구현·검증 기준](../06_IMPLEMENTATION_AND_TEST_PLAN.md) · [설계 기준 기록](../DESIGN_BASELINE.json)

## 1. 조사 순서와 결론

본 설계 8개 문서, 시안 4개 파일, 문서 검사 도구의 기준 해시를 **2026-09-26 16:41:55 KST**에 기록한 뒤 이 연구를 시작했다. 최신 UI 원칙과 플랫폼 API를 확인한 본문 작성 단계와, 여기의 추가 효율 대안 조사는 구분한다. 부록 때문에 기준 본문을 다시 덮어쓰지 않았다.

조사 결과, 초기 제품은 본문의 Electron·React 구조로 구현하면서 **오디오 처리, 화면 갱신, 동기화 요청, 로컬 저장, 모델 준비**를 각각 측정하고 개선하는 순서가 합리적이다. 이 판단은 기존 코드의 재사용 범위와 아래 공식 자료에 근거한 설계자의 추론이다. 실제 신제품의 CPU·메모리·비용 절감률을 측정한 결과는 아니다.

SQLite의 WAL 수정 이력은 선택적 성능 개선과 별개로 **출시 전 의존성 검증에 반드시 반영할 조사 결과**다. 프레임워크 전체 교체, 특정 브라우저 탭만 캡처한다고 가정하는 구현, 거래 내구성을 낮추는 변경은 초기 기본안으로 채택하지 않는다.

## 2. 우선순위와 본문 대비 추가 사항

`S/M/L`은 상대적인 변경 범위이며 일정 견적이 아니다. 라이선스·공급자 정책·버전 지원은 실제 릴리스 때 재확인한다.

| ID | 추가안 | 본문보다 구체화한 점 | 기대 효율 · 아직 미측정 | 범위 | 판단 |
|---|---|---|---|---|---|
| ER-01 | AudioWorklet 기반 PCM 처리 | 기존 ScriptProcessor 교체, 유한 버퍼·전송 단위 실험 | 입력 끊김·UI 경합 감소 | M | P06에서 우선 실험 |
| ER-02 | 가상 목록+분리된 화면 구독 | TanStack Virtual 후보, 개체별 snapshot·선택 ID 분리 | DOM 수·전체 화면 재렌더 감소 | M | P01/P05에서 채택 후보 |
| ER-03 | 변경 알림+cursor pull | workspace 단위 알림, 재접속 복구와 주기 조회 분리 | 빈 조회·연결 중복 감소 | M | P03에서 비교 후 채택 |
| ER-04 | 짧은 DB batch·checkpoint 측정 | FULL 유지, 실제 SQLite 엔진 버전 검증 | commit 횟수·긴 꼬리 지연 감소 | S~M | 버전 검증 필수, tuning 실측 |
| ER-05 | 방송용 STT 프로필 | 기존 VAD/양자화 재사용, 한국어 판매 corpus·OBS 동시 시험 | 모델 비용·GPU 경합 감소 | M | P06에서 측정 후 기본값 선정 |
| ER-06 | 단계별 기동·선택 런타임 준비 | shell/복구/댓글/모델/관리 화면의 의존성 분리 | 첫 화면·설치 및 업데이트 부담 감소 | S~M | 초기 구현 반영 권고 |
| ER-07 | Windows process loopback 어댑터 | 공식 C++ sample 기반 선택 프로세스 트리 입력 | 불필요한 시스템 소리 혼입 감소 | L | 특정 앱 소리 요구 시 기술 검증 |
| ER-08 | Electron/Tauri/WinUI 비교 | 셸 크기뿐 아니라 STT·Node·인쇄 이전 비용 비교 | 총 유지비·설치 크기 비교 가능 | L | Electron 유지, 전면 교체 보류 |
| ER-09 | 인쇄용 창의 제한적 재사용 | 기존 job마다 창 생성/파괴 비용을 분리 측정 | 연속 라벨 제출 준비 시간 감소 | M | 결과 재현성 시험 후 선택 |
| ER-10 | 증거별 AI 호출 중복 제거 | 규칙 우선+증거/revision/설정 해시별 캐시 | 같은 자료의 반복 호출 감소 | M | P07에서 비용 계측과 함께 |

## 3. ER-01 — 오디오 처리를 화면 작업에서 분리

**현재 코드에서 확인:** [audioCaptureService.ts](../../src/services/audioCaptureService.ts)는 16kHz AudioContext를 요청하고 `createScriptProcessor(4096, 1, 1)` 및 Float32→PCM16 변환을 사용한다. 16kHz가 실제 적용된 경우 4,096샘플은 약 256ms다. 이것은 전체 음성인식 지연 측정값이 아니라 입력 블록 길이의 계산이다.

**공식 근거:** W3C는 ScriptProcessorNode를 폐기 예정으로 분류하고 AudioWorkletNode로 대체하도록 명시한다. AudioWorkletProcessor는 오디오 렌더링 스레드에서 처리 코드를 실행한다. [Web Audio 표준](https://www.w3.org/TR/webaudio-1.0/#AudioWorklet)

**제안:**

1. `packages/audio/pcmProcessor`를 AudioWorklet으로 구현한다. 실제 sample rate·채널 수를 확인하고 필요한 경우 상태를 보존하는 resampler를 사용한다.
2. worklet에는 가벼운 PCM 처리·레벨 계산만 넣는다. STT 추론, JSON 대량 생성, 파일 저장은 넣지 않는다.
3. 작은 오디오 block을 매번 범용 IPC로 보내는 대신, 20/40/80ms 등 **실험할** 묶음 크기를 정해 sequence·generation·sample count와 전달한다.
4. 유한한 ring/buffer pool을 두고 밀린 길이·drop을 기록한다. 무한 queue로 지연을 감추지 않는다. overflow 시 음성 누락 상태를 알리고 누락 구간을 자동 판매 근거로 쓰지 않는다.
5. PCM 전달 경로는 시작·중지·판매 command와 분리한다. Electron MessagePort는 전용 채널 연결을 지원하지만 Node의 MessagePortMain과 웹 MessagePort가 같은 전송 기능을 모두 보장하지는 않는다. 잠금 버전에서 지원 자료형·복사 횟수를 실제 측정한다. `invoke`로 port를 전달할 수 있다고 가정하지 않는다. [Electron MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)

**실험:** 기존/새 방식에 동일한 30분 음원과 50댓글/초, 표 검색·스크롤을 적용한다. 오디오 sample 누락, 입력→worker p95, event loop 지연, CPU, 최종 전사와 판매 정확도를 비교한다. packet을 줄여 호출 수만 늘거나 첫/끝 음절이 잘리면 채택하지 않는다. 이 변경이 외부 Chrome 탭 선택 문제까지 해결해 주는 것은 아니다.

## 4. ER-02 — 10만 건을 그리지 않고 필요한 부분만 그리기

**본문 기준:** 01/04/06은 가상 목록·서버 페이지 조회를 요구한다. 여기서는 구현 후보와 선택 상태 보존 방법을 추가한다.

**공식 근거:** TanStack Virtual은 표시할 항목 범위를 계산하며 마크업·스타일은 앱이 소유하는 headless 가상화 도구다. 따라서 본문의 디자인 토큰·행 높이·세부 패널을 유지할 수 있다. [TanStack Virtual 소개](https://tanstack.com/virtual/latest/docs/introduction)

**제안:** 댓글·판매 read model을 큰 단일 React context에서 분리한다. 댓글 수신 때문에 로그인 화면·설정·정산 전체가 갱신되지 않게 한다. 개체는 ID로 정규화하고 목록은 ID·정렬·필터 정보만 가진다. React 외부 store 연동 시 snapshot은 변경 전까지 같은 참조를 반환하고 변경 때 불변 값으로 바꾼다. [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)

- SQLite에는 전체 자료를 두되 renderer에는 현재 페이지와 제한된 주변 자료만 보낸다.
- 댓글 UI 갱신을 50~100ms 단위 후보로 묶되, 수집·저장·판매 명령의 내구성 ACK를 UI timer까지 지연시키지는 않는다.
- 선택 구매자는 배열 index가 아닌 ID로 보관한다. 새 댓글 삽입이 선택을 바꾸면 실패다.
- 긴 댓글·한글 줄바꿈·200% 확대에서 실제 행 높이를 측정한다. 고정 높이 가정 때문에 내용이 겹치지 않게 한다.
- 가상 행이 화면 밖으로 사라질 때 키보드 초점·선택·스크린 리더가 유지되는지 검사한다. CSV는 보이는 DOM 행만 긁어 내보내지 않는다.

**실험:** 1천/1만/10만 개 캐시, 50개/초 유입에서 실제 DOM 행 수·렌더 commit 수·입력 반응 p95·메모리를 비교한다. 목표는 [06](../06_IMPLEMENTATION_AND_TEST_PLAN.md)을 따른다. 작은 목록까지 무조건 가상화해 복잡성만 늘리지 않는다.

## 5. ER-03 — 계속 묻는 방식에서 변경 신호를 받는 방식으로

**현재 코드에서 확인:** [ProductSalesContext.tsx](../../src/context/ProductSalesContext.tsx)의 정상 판매 feed polling 목표 간격은 2,000ms다. 이 polling은 조건부로 활성화되고 실패 시 backoff가 있다. 앱의 모든 기능이 항상 2초마다 서버를 호출한다는 뜻은 아니다.

**규모 계산 예시:** 요청이 충분히 빨리 끝나고 한 PC에서 한 feed가 8시간 계속 켜져 있다면 `8 × 3,600 ÷ 2 = 14,400회`다. 100대가 같은 조건이면 144만 회다. 실제 운영 트래픽·청구액 측정값이 아니며, 요청 실패·화면 이동·페이지 수·서버 과금 규칙에 따라 달라진다.

**공식 근거:** Supabase는 데이터베이스 변경 전송에서 Broadcast와 Postgres Changes를 구분하며, 규모·보안 측면에서 Broadcast를 권장한다. Postgres Changes의 테이블 변경은 구독자별 접근 검사 비용과 처리 제약을 검토해야 한다. [변경 구독 가이드](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes), [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)

**제안:** workspace마다 권한 있는 알림 채널 하나를 유지한다. 알림에는 최소한의 변경 신호만 담고, main이 인증된 `changes(afterCursor)` API를 호출한다. 알림은 합칠 수 있어도 업무 변경 기록 자체를 생략해서는 안 된다. 03의 commit 순서가 보장된 cursor·snapshot·tombstone 계약은 그대로 유지한다.

1. 연결 직후·재연결 직후·앱 resume 시 cursor부터 따라잡는다.
2. 정상 상태는 이벤트가 있을 때 묶어서 조회한다.
3. 누락 감지를 위한 낮은 빈도 reconciliation을 둔다. 예를 들어 30~60초는 **실험 후보**이지 보장된 정답이 아니다.
4. Realtime 불가 시 polling으로 되돌리되 화면 활성·방송 상태·실패 수에 따라 간격을 조정한다.
5. 조직 membership 철회와 JWT 수명 때문에 채널 정책 갱신이 지연될 수 있으므로, 알림에 고객명·전화번호·판매 원문을 직접 싣는 범위를 최소화하고 실제 자료 pull에서 매번 서버 권한을 검증한다. 로그아웃/조직 변경에는 구독도 닫는다. [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)

**실험:** 이벤트 없음/지속 유입/일시 폭주/5분 단절/권한 회수에서 요청 수·지연·최종 DB hash·다른 조직 노출 0건을 비교한다. 새 Broadcast 채널 비용과 catch-up 조회 비용도 함께 계산한다. `144만 회가 모두 사라진다`고 약속하지 않는다.

## 6. ER-04 — 저장의 안전성을 유지하면서 I/O를 줄이기

**본문 기준:** broker 단일 소유, WAL, `synchronous=FULL`이다. 성능 향상을 이유로 금전성 outbox를 `NORMAL` 또는 `OFF`로 바꾸는 안은 채택하지 않는다. WAL의 NORMAL은 전원 장애·강제 재부팅에서 최근 commit의 내구성을 약화시킬 수 있다. [SQLite WAL 성능 설명](https://www.sqlite.org/wal.html#performance_considerations)

**추가 제안:** 댓글 1개마다 별도 commit하는 것과, 수집 지연 상한/최대 건수를 정한 짧은 batch transaction을 비교한다. 판매 확인은 댓글 batch 뒤에 무제한 대기하지 않도록 우선순위를 둔다. 네트워크·모델 추론을 DB transaction 안에 넣지 않는다. 긴 export는 page 단위로 읽고 query/index를 먼저 고친다.

checkpoint는 기본 정책에서 시작해 WAL 크기·commit p95/p99·busy 횟수를 기록한다. broker 안의 idle 시점 PASSIVE checkpoint를 실험하되, checkpoint를 끈 채 WAL이 무한히 자라게 하지 않는다. 서버 여러 PC가 같은 로컬 DB 파일을 공유하는 방식으로 바꾸지 않는다. [SQLite WAL](https://www.sqlite.org/wal.html)

### 출시 전 필수: 실제 내장 SQLite 버전 확인

2026년 공개된 WAL-reset 결함은 동시 connection의 write/checkpoint 경합 조건에서 손상을 일으킬 수 있다. 공식 수정 릴리스는 **3.51.3**, 구버전 계열 backport는 **3.44.6 / 3.50.7**이다. 단일 broker라도 addon 내부나 추후 backup 도구가 다른 connection을 열 수 있으므로 패치 검증을 생략하지 않는다. [WAL-reset 설명](https://www.sqlite.org/wal.html#the_wal_reset_bug), [3.51.3 릴리스](https://sqlite.org/releaselog/3_51_3.html)

SQLite 공식 소식에는 3.52.0 철회도 기록되어 있다. 단순히 버전 숫자가 `>=3.51.3`이면 모두 승인하는 규칙은 충분하지 않다. 검증한 릴리스 allowlist와 해당 릴리스의 회귀 결과를 남긴다. 확인일의 최신 나열 버전만 무조건 설치하라는 제안이 아니다. [SQLite 공식 소식](https://sqlite.org/news.html)

패키징한 앱에서 `SELECT sqlite_version()`으로 실제 라이브러리를 확인한다. 개발 PC의 sqlite CLI 버전이나 npm wrapper 버전만 보고 판단하지 않는다. 설치 후 outbox crash 복구·동시 읽기/쓰기·checkpoint·backup 복원·디스크 부족을 시험한다. 이 부록은 새 의존성을 설치하거나 기존 DB를 변경하지 않았다.

## 7. ER-05 — STT는 모델 이름보다 판매 정확도로 선택

**현재 코드에서 확인:** [stt_worker.py](../../server/stt_worker.py)는 이미 모델을 프로세스에 유지하고 VAD, CPU int8/GPU 경로, `beam_size=1` 등을 사용한다. 따라서 “VAD를 처음 추가하면 빨라진다”는 제안은 현재 상태를 잘못 설명한다.

**공식 근거:** faster-whisper는 CPU/GPU 양자화, batched transcription, VAD 옵션을 제공한다. 제공 프로젝트의 벤치마크는 특정 모델·GPU·beam 조건의 결과이며, 이 앱의 실시간 한국어 판매 성능과 같지 않다. [faster-whisper 공식 저장소](https://github.com/SYSTRAN/faster-whisper)

**제안:** `절전 CPU`, `균형`, `고정밀`처럼 사용자 목적에 맞는 제한된 프로필을 만든다. 각 프로필의 모델·compute type·VAD·thread 수·발화 경계 정책은 버전 manifest로 고정한다. GPU 이름만으로 추천하지 않고 짧은 로컬 시험에서 실제 모델 로딩과 추론 성공을 확인한다.

- 한국어 닉네임·상품번호·가격 축약·부정문·정정이 포함된 동의 받은 또는 합성 corpus를 준비한다.
- 발화 앞뒤 여유 구간과 VAD 임계값을 비교한다. 무음 제거가 닉네임 첫 음절을 자르면 비용 감소보다 오류가 크다.
- 여러 파일을 모으는 offline batch throughput과 실시간 발화 지연은 따로 측정한다. 사용자 발화가 batch를 채울 때까지 기다리는 구조를 만들지 않는다.
- OBS/TikTok Studio와 동시에 실행하여 VRAM·인코딩 frame drop·CPU·RTF를 본다. GPU 고갈 시 진행 중 모델을 반복 교체하지 않고 입력 상태와 fallback을 명확히 표시한다.
- 이미 loaded인 모델은 합리적으로 재사용하되, 휴면 상태의 유지 비용과 재개 지연을 함께 보고 유휴 해제 정책을 결정한다.

**합격:** 전사 CER/WER뿐 아니라 잘못된 구매자 확정, 가격 오류, 보류율, 최종 발화 지연을 모두 보고한다. 오판매가 늘어난 최적화는 채택하지 않는다.

## 8. ER-06 — 모든 준비를 앱 시작에 몰아넣지 않기

Electron 공식 성능 문서는 불필요하게 이른 모듈 초기화와 main/renderer의 동기 작업을 피하고, 실제 profile을 근거로 개선하도록 안내한다. [Electron 성능 가이드](https://www.electronjs.org/docs/latest/tutorial/performance)

**새로운 구체안:**

```text
필수 shell 표시
  → 인증 요약·DB migration·복구 확인
  → 사용자가 선택한 workspace의 최소 bootstrap
  → 방송 진입 시 댓글·오디오 준비
  → 로컬 STT 선택 시 검증된 runtime/model 준비
  → 정산·관리·AI 화면은 진입할 때 필요한 코드/자료 준비
```

초기 로그인 성공보다 먼저 금전성 command를 받아놓고 DB migration을 나중에 하는 방식은 허용하지 않는다. 화면을 빨리 보이는 것과 업무 준비 완료를 별도 상태로 표시한다.

모델은 선택한 엔진에 필요한 것부터 내려받는다. 다운로드 manifest에는 파일별 용량·hash·버전·의존 런타임을 둔다. 앱 업데이트 때문에 변경되지 않은 모델까지 매번 다시 받지 않도록 content hash로 재사용한다. 출처/해시가 맞지 않는 파일은 로드하지 않는다. 중단 파일·디스크 부족·정리 버튼·오프라인 설치 묶음도 제공한다.

**실험:** clean PC cold start와 warm start를 각각 기록하고, `창 표시`, `수동 판매 가능`, `댓글 준비`, `STT 준비`를 분리 측정한다. 전체 다운로드 바이트·첫 설치 실패율·다시 받은 모델 바이트·지원 문의 수까지 비교한다. 백그라운드로 옮긴 비용을 없어진 비용으로 보고하지 않는다.

## 9. ER-07 — 특정 앱의 소리만 받는 Windows 어댑터

Microsoft의 Application Loopback sample은 지정 프로세스와 자식 프로세스의 소리를 포함하거나 제외하는 Win32 경로를 보여 준다. sample의 명시 최소 조건은 Windows build 20348 이상이다. 프로세스 트리에 음성 재생이 없으면 무음이 들어올 수 있다. [Microsoft 공식 sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)

**기대 효과는 추론:** 판매자가 선택한 방송 프로그램으로 범위를 좁히면 다른 앱의 알림음·영상 소리가 STT에 섞이는 사례를 줄일 수 있다. 실제 지연·오판매 감소는 검증 전이다.

**제안:** Electron shell은 유지하고 별도 서명된 native audio worker에 `start(targetProcess)`, `stop`, `status`, 제한된 PCM channel만 제공한다. 프로세스가 종료·재생성되면 과거 PID를 새 프로그램에 조용히 재사용하지 않는다. 캡처 대상·범위를 사용자가 확인할 수 있어야 한다.

Chrome의 process tree가 탭 하나와 일치한다는 보장은 없다. 이 방식만으로 “외부 브라우저 탭 하나만 캡처”를 충족했다고 선언하지 않는다. 실제 탭 동등성이 필요하면 별도의 브라우저 연동 어댑터까지 검증하고 원본 WF-009 인수 조건을 통과해야 한다.

**판단:** Windows 11 초기 지원 환경에서 기술 검증할 가치가 있다. 앱 전체를 Rust/C#로 옮기는 선행조건으로 두지 않는다. x64/향후 ARM64, sleep/resume, 헤드셋 변경, OBS 동시 사용, 재생 종료, 다중 Chrome 프로필을 검증한 뒤 지원표에 넣는다.

## 10. ER-08 — 프레임워크 교체의 실제 비용 비교

Tauri는 Rust core와 WebView를 사용하고 Windows에서는 WebView2에 의존한다. 외부 sidecar를 동봉할 수 있지만 타깃별 바이너리 구성은 개발자가 관리해야 한다. [Tauri 구조](https://v2.tauri.app/concept/architecture/), [WebView 버전](https://v2.tauri.app/reference/webview-versions/), [sidecar 배포](https://v2.tauri.app/develop/sidecar/)

WinUI 3는 C#/C++ 및 XAML을 사용하는 Windows 네이티브 UI 선택지다. [Microsoft WinUI 3](https://learn.microsoft.com/en-us/windows/apps/winui/winui3/)

다음 비용·위험 평가는 이 프로젝트에 대한 추론이다. 보편적인 속도 순위가 아니다.

| 기준 | Electron 유지 | Tauri + React | WinUI 3 전면 UI |
|---|---|---|---|
| 기존 React 화면 | 직접 이전 용이 | UI 대부분 이전 가능, OS bridge 변경 | XAML 재작성 또는 WebView 혼합 설계 필요 |
| Node 댓글 수집 | 기존 자산과 맞음 | sidecar 유지 또는 Rust 재작성 필요 | 별도 실행자 또는 .NET/C++ 포팅 필요 |
| 기존 Electron 인쇄 | 계약·보안·큐 보완 후 재사용 | 인쇄 adapter 재구현/검증 | Windows 인쇄 adapter 재구현/검증 |
| STT runtime/model | 여전히 필요 | 여전히 필요 | 여전히 필요 |
| 브라우저 엔진 배포 | Electron 패키지의 일부 | WebView2 설치/업데이트 정책 검증 | 순수 native면 불필요, WebView 혼합이면 필요 |
| UI 품질 | 04의 구현·검수에 달림 | 04의 구현·검수에 달림 | 네이티브 제어 장점, 재작성 품질 검수 필요 |
| 이번 판단 | 기준안 유지 | 후속 비교 prototype 후보 | 전면 전환은 보류 |

프레임워크 소개 페이지의 작은 기본 앱 크기를 그대로 완성품 크기로 사용하지 않는다. 비교식은 `셸 + 댓글 런타임 + STT 런타임 + 선택 모델 + 자산 + 업데이트 차분`이다. 메모리도 UI 프로세스 하나가 아니라 모델·worker·WebView 프로세스 전체를 포함한다.

**재검토 조건:** Electron 기준안을 실제로 profile한 뒤에도 설치 크기·idle 메모리·전력 목표가 지속적으로 미달하고, 도메인/계약 분리가 충분해 같은 수동 판매→댓글→출력 시나리오를 Tauri로 비교할 수 있을 때다. 일단 41개 경로/67개 기능의 의미를 보존한 작은 비교 구현에서 총비용을 측정한다.

## 11. ER-09 — 인쇄 준비용 창 재사용 실험

[기존 main.cjs](../../desktop/comment-helper/main.cjs)의 출력 경로는 job마다 숨은 BrowserWindow를 만들고 전표를 로드·렌더·제출한 뒤 파괴한다. Electron은 webContents의 print 옵션과 결과 callback을 제공한다. [Electron print 계약](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback)

**제안:** 검증된 로컬 전표 template만 읽는 전용 숨은 창 1개를 제한된 기간 재사용하는 방식을 비교한다. job마다 payload hash·generation을 새로 바인딩하고 DOM·이미지·폰트 준비 ACK가 해당 job ID인지 확인한 뒤 제출한다. 동시에 두 job을 같은 창에 덮어쓰지 않는다. crash 또는 렌더 timeout이면 창을 폐기하고 기존 journal 정책으로 복구한다.

**위험:** 앞 주문의 닉네임·이미지가 다음 라벨에 남으면 속도 이득은 의미가 없다. 용지4종, 긴 한글, 연속100건, 빈 이미지, 전표 크기 변경에서 각 job과 출력 내용이 맞는지 확인한다. 최초/연속 준비시간·메모리를 따로 비교한다. spool 제출 성공과 종이 배출 성공은 계속 구분한다.

**보류한 대안:** 전체 출력을 즉시 raw ESC/POS로 전환하는 것은 폰트·한글 코드페이지·드라이버·A4 등 지원 조합을 크게 바꾼다. 명확히 지원할 프린터군과 실기기 이점이 확인될 때 별도 adapter로 검토한다. 이 판단은 프로젝트의 용지·한글 요구에 대한 위험 분석이다.

## 12. ER-10 — AI에는 필요한 증거만, 같은 요청은 한 번

이 항목은 특정 공급자의 요금 인하를 주장하는 외부 벤치마크가 아니라, [기존 보류 처리](../../src/services/pendingSalesService.ts)와 [새 AI 계약](../03_DATA_API_SYNC.md)의 구조에서 도출한 개선안이다.

규칙으로 해결한 건에는 AI task를 만들지 않는다. 동일한 `workspace + sale revision + evidence hash + applied settings version + prompt schema version`의 분석 결과를 제한된 기간 재사용한다. 구매자 후보와 근거는 해당 회차·시간 범위의 실제 ID로 묶고 무제한 전체 댓글 기록을 보내지 않는다.

비용 예측은 `분석 대상 건수 × 평균 호출 수 × 호출별 실제 비용`으로 기록한다. 재시도·fallback 비용과 예약 예산을 포함한다. 2개 AI 슬롯이 있다고 모든 주문을 두 모델에 동시에 보내는 것을 기본값으로 만들지 않는다. 근거나 설정이 바뀌면 이전 결과를 재적용하지 않는다.

**실험:** 같은 고정 주문 집합에서 총 호출 수·토큰/실행시간·실청구액·오판매율·보류 해결률을 비교한다. cache hit만 높이고 오래된 구매자/가격을 쓰는 결과는 실패다. 고객 정보 최소화와 권한 격리는 비용 절감과 별개의 필수 계약으로 유지한다.

## 13. 개발자가 바로 실행할 연구 작업 순서

| 연구 작업 | 선행 | 산출물 | 합격/중단 판단 |
|---|---|---|---|
| E00 측정 harness | P01/P03 기본 구현 | PC·OS·앱·엔진 버전, 합성 fixture, trace 기록법 | 같은 입력을 반복할 수 있음 |
| E01 오디오 A/B | P06 adapter | 기존/Worklet drop·지연·정확도 표 | 정확도 유지+측정한 경합 감소 |
| E02 목록 A/B | P05 read model | DOM·render·input p95·메모리 | 선택/접근성 보존, 06 목표 충족 |
| E03 동기화 A/B | WD-10/14 | 요청 수·지연·cursor 복구·권한회수 결과 | 최종 상태·삭제·권한 일치 |
| E04 저장/버전 | P03 SQLite 선택 | 실제 엔진 버전·batch·checkpoint·복구 결과 | 패치 확인, 내구성·복구 통과 |
| E05 STT 프로필 | corpus와 방송 환경 | 모델별 오류·지연·GPU 경합 표 | 오판매 증가 없음, 지원조합 명시 |
| E06 기동·패키지 | P08/P13 | 구간별 기동·다운로드·실패율 | 업무 준비 상태를 정확히 설명 |
| E07 선택 실험 | 필요성 확인 | native audio/인쇄 재사용/프레임워크 비교 | 기능 동등성·유지비까지 유리 |

결과에는 `기준안`, `변경안`, `같게 유지한 조건`, `바뀐 변수`, `실측`, `회귀`, `채택 여부`, `되돌릴 방법`을 기록한다. 한 번에 모델·UI·DB·네트워크를 전부 바꾼 뒤 하나의 속도 향상 수치만 제시하지 않는다.

## 14. 부록을 본 설계에 반영하는 방법

이 보고서의 **연구 권고**와 **개발 완료**는 다르다. 우선 ER-04의 버전 확인을 P03/G07/G10에 추가하고, ER-01/02/03/05/06의 실험을 관련 단계의 작업으로 등록한다. ER-07/08/09는 요구와 병목이 확인될 때 진행한다. ER-10은 AI가 실제 동작하는 P07 이후 비용 계측과 함께 검증한다.

채택한 변경은 WF·WD·T·G 식별자와 연결해 새 설계 버전으로 기록한다. 41개 경로·67개 기능 보존, 서버 권한, 금액 정합성, 출력/SMS 불명 상태, 아름답고 읽기 쉬운 UI라는 조건을 낮추어 효율을 얻지는 않는다.
