# 판매 보류 해결 및 음성 정정 AI 운영 배포 전 체크리스트

> **문서 버전:** 1.0.0  
> **기준 설계:** [PLAN.md](./PLAN.md) 및 작업 1~8 통합 검증 결과  
> **작성 일시:** 2026-09-10  
> **주의:** 본 문서는 운영 환경 배포 준비와 점검 절차를 정의하며, **승인 없이 실제 운영 배포를 임의로 실행하지 않습니다.**

---

## 1. 개요 및 배포 원칙

1. **실제 판매 데이터 격리 및 안전성 보장**
   - 배포 전 모든 사전 점검과 합성 추론 시험은 실제 판매 데이터를 변경하지 않는 독립된 작업공간(`ws_sandbox` 등)과 모의 트랜잭션을 사용합니다.
2. **점진적 롤아웃 (Gradual Rollout)**
   - 초기 배포 시 AI 기능을 전면 강제하지 않고, 관리자 AI 설정의 기능별 토글(`enabledPendingResolution: false`, `enabledVoiceCorrection: false`) 상태로 배포한 후 1개 테스트 매장에서 활성화 검증을 거칩니다.
3. **무중단 운영 (Zero-Downtime)**
   - DB 마이그레이션은 기존 테이블의 컬럼 추가 및 신규 테이블 생성이며, 기존 `sales`, `sessions`, `print_jobs`의 기존 쿼리와 100% 하위 호환됩니다.

---

## 2. DB 마이그레이션 실행 순서 및 검증

모든 마이그레이션 파일은 `supabase/migrations/` 경로에 위치하며, 아래 **순서를 엄격히 준수**하여 실행합니다.

```
┌────────────────────────────────────────────────────────┐
│ 1. 202609100002_ai_resolution_settings.sql (기초 설정)   │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 2. 202609100003_ai_health_status.sql (건강 상태 관리)   │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 3. 202609100004_ai_task_queue.sql (비동기 작업 큐)     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 4. 202609100005_pending_sales_resolution.sql (보류 확장)│
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 5. 202609100006_voice_correction_resolution.sql (정정) │
└────────────────────────────────────────────────────────┘
```

### 2.1 마이그레이션 단계별 상세

| 순서 | 파일명 | 대상 테이블 및 역할 | 사전 검증 조건 |
|---|---|---|---|
| **1단계** | `202609100002_ai_resolution_settings.sql` | `ai_resolution_settings`, `ai_secrets`, `ai_settings_audit_log` 생성 및 RLS 정책 적용 | `workspaces` 테이블 존재 확인 |
| **2단계** | `202609100003_ai_health_status.sql` | `ai_health_status` (경로/기기별 가용성 및 Tier 1~3 점검 기록) | 1단계 완료 |
| **3단계** | `202609100004_ai_task_queue.sql` | `ai_tasks`, `ai_task_attempts`, 서킷 브레이커 테이블 및 인덱스 | 1단계 완료 |
| **4단계** | `202609100005_pending_sales_resolution.sql` | `sales` 테이블에 `pending_reasons`, `evidence_snapshot`, `ai_verification`, `history` JSONB 컬럼 추가 | `sales` 테이블 존재 확인 |
| **5단계** | `202609100006_voice_correction_resolution.sql` | `pending_corrections` 테이블 (복수 후보 정정 보류 및 후속 연결 저장) | 4단계 완료 |

### 2.2 마이그레이션 적용 후 유효성 검증 쿼리

```sql
-- 테이블 정상 생성 확인
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'ai_resolution_settings', 'ai_secrets', 'ai_settings_audit_log',
    'ai_health_status', 'ai_tasks', 'ai_task_attempts', 'pending_corrections'
  );

-- sales 테이블 컬럼 확장 확인
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'sales' 
  AND column_name IN ('pending_reasons', 'evidence_snapshot', 'ai_verification', 'history');

-- RLS 활성화 여부 점검 (ai_secrets는 ADMIN 전용이어야 함)
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'ai_secrets';
```

---

## 3. 서버 비밀정보 등록 및 보안 점검

AI 공급자 API 키와 외부 서버 접속 토큰은 절대 클라이언트로 유출되지 않도록 서버 전용 저장소 및 환경 변수에 등록합니다.

### 3.1 비밀정보 등록 체크리스트

- [ ] **Supabase Vault / 환경 변수 등록**
  - `OPENAI_API_KEY`: OpenAI 클라우드 모델 호출용 키 (gpt-4o-mini 등)
  - `GEMINI_API_KEY`: Google Gemini 클라우드 모델 호출용 키 (gemini-1.5-flash 등)
  - `ANTHROPIC_API_KEY`: Claude 클라우드 모델 호출용 키 (claude-3-5-haiku 등)
  - `AI_SETTINGS_ENCRYPTION_KEY`: 자체 운영 모델의 Bearer 토큰 / 커스텀 인증 헤더 암호화용 256비트 대칭키
- [ ] **클라이언트 마스킹 검증**
  - 판매자 브라우저 또는 관리자 조회 응답에 비밀정보 원문이 포함되지 않는지 확인 (`sk-...0xyz`, `192.168.***.***` 마스킹 확인).
  - 판매자 전용 API(`sales-api`, `LiveHomePage`)에서 `ai_secrets` 테이블에 대한 직접 SELECT 권한이 차단되어 있는지 확인.

---

## 4. 외부 LLM 주소 / 인증 / TLS 점검

사설망 내부 및 외부 공인 IP 서버를 1번 또는 2번 슬롯에 등록할 때의 보안 및 통신 점검 항목입니다.

- [ ] **외부 공인 IP/도메인 HTTPS 필수 점검**
  - `location === 'EXTERNAL_IP'`인 경우 `http://` 주소 등록 차단 여부 확인 (`https://` 및 유효한 TLS 인증서 필수).
- [ ] **SSRF 방지 및 위험 포트 차단 점검**
  - SSH(22), MySQL(3306), PostgreSQL(5432), Redis(6379), SMTP(25) 등 비인가 포트로의 연결 시도 차단 여부 점검.
  - HTTP 3xx 리디렉션 자동 추적 차단(`redirect: 'manual'`) 여부 점검.
- [ ] **사전 Tier 1~3 건강 점검 실행**
  - 관리자 화면의 `사전 점검 실행` 버튼을 통해 다음 3단계를 수행:
    1. **Tier 1 (연결):** 서버 직접 또는 PC 도우미 경로의 TCP/TLS/인증 핸드셰이크 성공.
    2. **Tier 2 (모델 상태):** 모델 로딩 및 메모리 준비 상태 확인 (원격 관리 API 미제공 시 `NOT_QUERYABLE` 처리 후 장애로 단정하지 않음).
    3. **Tier 3 (실제 추론 시험):** `0.9가 아니고 1.2입니다` 및 `xxx님이 아니시고 ooo님` 합성 문장 정답 여부 및 응답 지연 측정.

---

## 5. PC 도우미 업데이트 및 배포 순서

로컬 STT(faster-whisper) 및 로컬 LLM(Ollama)이 동작하는 판매자 PC의 도우미 프로그램 배포 절차입니다.

1. **사전 백업 및 기존 프로세스 확인**
   - 기존 `voicecap-comment-helper` 프로세스 상태 및 미처리 오프라인 캐시 확인.
2. **도우미 바이너리 / 스크립트 업데이트**
   - `server/sttBridge.js` 및 `server/index.js` 반영.
   - 로컬 작업 디스패처(`/api/local-ai/resolve`) 엔드포인트 활성화.
3. **단일 GPU(8GB VRAM) 환경 사전 설정**
   - STT와 Ollama가 동일 GPU를 공유하는 장비:
     - `measureGpuContention` 도구를 실행하여 VRAM 여유율 측정.
     - VRAM이 8GB 이하인 경우 STT 모델을 `small` 또는 `large-v3-turbo`로 지정하고, LLM은 양자화 모델(`q4_k_m`) 또는 2번(클라우드)으로 지정.
4. **서비스 기동 및 세션 핑퐁 검증**
   - 도우미 실행 후 로컬 상태가 웹앱에 `PC 도우미 · 온라인`으로 전파되는지 확인.
   - 15초 주기 경량 하트비트 및 45초 상태 만료(`EXPIRED`) 타이머 정상 작동 확인.

---

## 6. 원클릭 롤백 및 긴급 대응 절차

운영 중 예상치 못한 모델 응답 지연이나 오작동 발생 시 1분 이내에 안전한 상태로 복구하기 위한 절차입니다.

### 6.1 긴급 롤백 단계

| 수준 | 조치 방법 | 소요 시간 | 영향 범위 |
|---|---|---|---|
| **Level 1 (원클릭 기능 중단)** | 관리자 AI 설정에서 `판매 보류 AI 사용: OFF`, `음성 정정 AI 사용: OFF`로 전환 | **즉시 (< 5초)** | 모든 AI 비동기 분석이 중단되고, 기존 규칙 기반 판매 적재 및 수동 확인 모드로 즉각 복귀됨 (기존 판매 데이터 무영향) |
| **Level 2 (슬롯 우선순위 교체)** | 로컬 LLM 과열 시 관리자 설정에서 `우선 실행 슬롯: 2번(클라우드)`으로 변경 | **즉시 (< 10초)** | 장애가 발생한 로컬 모델을 우회하고 검증된 클라우드 모델로 즉각 대체 |
| **Level 3 (수정 건 되돌리기)** | 잘못 정정된 판매 건의 판매 카드에서 `되돌리기` 클릭 또는 음성 `방금 수정한 거 취소` | **건당 즉시** | `CORRECTION_ROLLBACK` 감사 로그와 함께 이전 revision 값으로 안전 복원 (결제 완료 건은 안전 차단) |
| **Level 4 (DB 스키마 유지 롤백)** | 프론트엔드/백엔드 코드를 이전 커밋 버전으로 롤백 배포 | **1~3분** | DB에 추가된 `pending_reasons`, `evidence_snapshot` 컬럼은 Nullable 및 JSONB이므로 스키마 롤백 없이 이전 코드와 호환 유지 |

---

## 7. 운영 모니터링 항목 및 경보 기준

방송 진행 중 시스템의 이상 징후를 조기에 감지하기 위한 핵심 지표 및 임계치입니다.

### 7.1 실시간 메인 화면 상태 모니터링

- [ ] 메인 라이브 상단 배지에 실제 현재 실행 중인 AI 슬롯이 정확히 표시되는지 확인:
  - `AI 1번 · 로컬 · 사용 가능`
  - `AI 1번 → 2번 전환 중 · 응답 시간 초과`
  - `AI 2번 · 클라우드 · 대체 처리 중`
  - `AI 사용 불가 · 보류 N건 재시도 대기`
- [ ] 요청이 없을 때 불필요하게 `처리 중`으로 깜빡이지 않는지 확인.

### 7.2 운영 지표 및 알람 임계치 (SLA)

| 모니터링 항목 | 정상 기준 | 경보 임계치 | 조치 절차 |
|---|---|---|---|
| **자체 운영 LLM 지연 (P95)** | < 8,000ms | **> 15,000ms** | GPU 자원 점유율 확인 및 타임아웃 발생 전 2번(클라우드) 전환 검토 |
| **클라우드 LLM 지연 (P95)** | < 4,000ms | **> 10,000ms** | 외부 클라우드 API 응답 지연 확인 |
| **1번→2번 전환율 (Failover Rate)** | < 3% | **> 10%** | 로컬 도우미 연결 상태 또는 로컬 엔진 프로세스 헬스체크 |
| **서킷 브레이커 오픈 횟수** | 0회 | **>= 1회 (2연속 실패)** | 30초 쿨다운 동안 대체 슬롯 처리 확인 및 로그 원인 분석 |
| **GPU VRAM 점유율** | < 80% | **> 88%** | 전사 지연 급증 방지를 위해 STT 모델 경량화 또는 LLM 클라우드 오프로드 |
| **인간 되돌리기 비율 (Rollback Rate)**| < 2% | **> 5%** | 프롬프트 정밀도 점검 및 파서 규칙 보완 |
| **정정 전표 중복 발생 건수** | **0건** | **> 0건 (엄격 차단)** | 동일 revision 중복 인쇄 차단 로직 점검 |

---

## 8. 최종 승인 서명

- [x] 작업 1~7 전 항목 단위 및 통합 검증 통과 (211/211 Passed)
- [x] 격리된 테스트베드 내 회귀 검증 완료 (실제 판매 데이터 무변경 확인)
- [x] 단일 GPU STT + LLM 자원 경합 벤치마크 및 안전 한도 수립 완료
- [x] 배포 전 체크리스트 및 롤백 절차서 작성 완료

> **최종 상태:** 운영 배포 준비 완료 (Ready for Staging / Production Deployment Review)
