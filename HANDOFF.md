# VoiceCAP 개발·운영 인계인수서 (Handover)

> **문서 버전:** 2.0.0  
> **기준 시각:** 2026-09-10 20:55 KST  
> **기준 브랜치:** `main` (최신 커밋: `3e328a0`)  
> **이 문서의 역할:** 새 PC로 작업 환경을 이전하거나 다른 개발자가 이어서 작업할 때 필요한 **단일 기준 인계 문서**입니다.

---

## 1. 프로젝트 기준 정보

| 항목 | 현재 값 / 링크 |
| --- | --- |
| **GitHub Repository** | `https://github.com/nettman001-hub/voice-pin-web.git` |
| **운영 브랜치** | `main` (모든 변경사항 커밋 & 푸시 완료) |
| **운영 웹 URL** | `https://www.voicecap.shop` |
| **호스팅 환경** | Vercel (`main` 브랜치 푸시 시 자동 배포) |
| **Supabase Project** | `ymegrhxpbeanvxwdzfym` ([Supabase 대시보드](https://supabase.com/dashboard/project/ymegrhxpbeanvxwdzfym)) |
| **Supabase Edge Functions** | `sales-api`, `voicecap-onboard`, `device-pair`, `sms-bridge` |
| **댓글 도우미 (Windows)** | `v1.3.7` ([다운로드 직링크](https://github.com/nettman001-hub/voice-pin-web/releases/download/comment-helper-v1.3.7/VoiceCAP-Comment-Helper-Setup.exe)) |
| **Android SMS Bridge** | `v1.3.3` (versionCode `7`, package `shop.voicecap.smsbridge`) |
| **테스트 상태** | **213 tests passing (0 fail)** (`npm test`) |
| **빌드 상태** | **Production Build Pass** (`npm run build`) |

---

## 2. 최근 완료된 작업 요약

### 2.1 판매 보류 해결 및 음성 정정 AI 시스템 (PLAN.md 작업 1~8 완료)
1. **공통 LLM 어댑터 및 요청/응답 규격 (작업 1·2)**
   - **자체 운영 LLM**: 같은 PC (`127.0.0.1`), 내부망 (`192.168.x.x`), 외부 공인 IP/도메인 서버 지원.
   - **호출 경로 분리**: `PC_HELPER` (PC 도우미 경유) vs `SERVER_DIRECT` (서버 직접 호출 - 외부 IP/클라우드는 도우미 없이 직접 호출).
   - **클라우드 LLM**: OpenAI (`gpt-4o-mini`), Gemini (`gemini-1.5-flash`), Claude 지원. 서버 전용 시크릿으로 브라우저에 API 키 미노출.
   - **보안 검증**: 외부 IP는 HTTPS 강제, 위험 포트(22, 3306 등) 차단, SSRF 및 3xx 리디렉션 차단.
2. **3단계 건강 점검 및 8가지 상태 전파 (작업 3)**
   - **Tier 1 (연결/인증)** ➜ **Tier 2 (모델 로딩/메모리 - 원격 관리 미제공 시 장애 미단정)** ➜ **Tier 3 (합성 추론 시험: `0.9가 아니고 1.2`, `xxx님이 아니시고 ooo님`)**.
   - 상태: `UNCONFIGURED`, `CHECKING`, `PREPARING`, `AVAILABLE`, `DEGRADED`, `UNAVAILABLE`, `RECOVERING`, `EXPIRED`.
3. **서버 중심 AI 작업 대기열 & 슬롯 1 ➜ 2 자동 전환 (작업 4)**
   - 비동기 작업 큐(`ai_tasks`), 시도 관리(`ai_task_attempts`), 서킷 브레이커(`ai_circuit_breaker`).
   - 슬롯 1 실패(도우미 종료, 타임아웃, 모델 로딩 실패 등) 시 동일 작업을 슬롯 2로 자동 전환.
   - `expectedRevision` 충돌 검사로 늦게 도착한 AI 응답의 덮어쓰기 방지.
4. **자동 적재 판매 보류 원인 구조화 및 해결 (작업 5)**
   - 6가지 보류 사유: 닉네임 오인식, 끝번호 유일 일치, 금액 누락, 분리 발화, 지연 댓글, 복수 후보 충돌.
   - 원본 발화/상품/댓글/캡처 불변 근거 스냅샷 보존, 규칙 우선 해결 후 미해결 건만 AI 작업 생성.
   - AI 제안 닉네임이 실제 방송 댓글/구매자에 없으면 서버에서 엄격히 거부.
5. **음성 정정 및 정정 보류 해결 (작업 6)**
   - 정정 키워드(`아니고`, `아니시고`, `정정`, `잘못 말씀드렸네요` 등) 분석 및 부정 명령(`~하지 마세요`)/질문 필터링.
   - 정정 보류 후 "12번이요" 등 후속 발화 연결, 단가/총액 일관성 유지, 결제 전 판매 되돌리기(`CORRECTION_ROLLBACK`).
6. **판매자·관리자 화면 및 운영 연동 (작업 7)**
   - 라이브 홈 상단 `AI 1번 · 로컬 · 사용 가능` 등 상태 배지, 판매 카드별 AI 확인 상태/근거 모달/되돌리기.
   - 관리자 대시보드 및 AI 설정 화면에서 3단계 점검, 슬롯 설정, 합성 시험, 비상 원클릭 OFF 토글.
7. **운영 전 사전 통합 검증 (작업 8)**
   - 26개 실전 운영 시나리오 및 동시 실행 GPU(8GB) 부하 검증 완료, [PRE_DEPLOYMENT_CHECKLIST.md](file:///c:/dev/voice-pin-web/docs/plans/2026-09-10-ai-resolution/PRE_DEPLOYMENT_CHECKLIST.md) 작성.

### 2.2 댓글 도우미 프로그램 다운로드 404 오류 수정
- **원인**: 안드로이드 릴리스(`android-v1.3.3`) 업로드로 인해 GitHub의 `latest` 포인터가 변경되어 `/releases/latest/download/...` 접근 시 404 발생.
- **수정**: `src/types/comment.ts`와 `LiveHomePage.tsx`에 `comment-helper-v1.3.5` 태그 다운로드 직링크 적용 및 회귀 방지 테스트(`test/comment-helper-download.test.mjs`) 추가.

---

## 3. 새 컴퓨터에서 세팅 및 시작하는 방법

### 3.1 프로젝트 내려받기 및 환경 설정
```powershell
# 1. 저장소 클론
git clone https://github.com/nettman001-hub/voice-pin-web.git
cd voice-pin-web

# 2. 의존성 설치
npm install

# 3. 전체 테스트 검증 (213개 통과 확인)
npm test

# 4. 빌드 검증
npm run build

# 5. 로컬 개발 서버 실행 (http://localhost:5173)
npm run dev
```

### 3.2 필요 도구 설치 (로컬 AI / STT 테스트 환경 시)
- **Node.js**: v20 이상 권장
- **댓글 도우미**: [VoiceCAP-Comment-Helper-Setup.exe](https://github.com/nettman001-hub/voice-pin-web/releases/download/comment-helper-v1.3.5/VoiceCAP-Comment-Helper-Setup.exe) 설치 및 실행
- **Ollama (로컬 LLM 사용 시)**: `ollama run qwen2.5:7b` (기본 포트 11434)

---

## 4. 새 컴퓨터에서 이어서 진행할 작업 (TODO)

### 📌 작업 1: Supabase DB 마이그레이션 적용 (우선순위 1)
브라우저에서 **[Supabase 대시보드 SQL Editor](https://supabase.com/dashboard/project/ymegrhxpbeanvxwdzfym/sql/new)**로 접속하여 아래 5개 파일의 SQL을 순서대로 실행합니다:

1. `supabase/migrations/202609100002_ai_resolution_settings.sql` (AI 기초 설정 및 RLS)
2. `supabase/migrations/202609100003_ai_health_status.sql` (건강 상태 관리)
3. `supabase/migrations/202609100004_ai_task_queue.sql` (비동기 작업 큐 및 서킷 브레이커)
4. `supabase/migrations/202609100005_pending_sales_resolution.sql` (sales 테이블 보류/근거 컬럼 확장)
5. `supabase/migrations/202609100006_voice_correction_resolution.sql` (정정 보류 테이블)

#### 마이그레이션 적용 확인 쿼리:
```sql
-- 1. 신규 테이블 7개 생성 확인
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'ai_settings', 'ai_secrets', 'ai_settings_history',
    'ai_health_status', 'ai_tasks', 'ai_task_attempts', 'ai_circuit_breaker', 'pending_corrections'
  );

-- 2. sales 테이블 확장 컬럼 4개 확인
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'sales' 
  AND column_name IN ('pending_reasons', 'evidence_snapshot', 'ai_verification', 'history');
```

---

### 📌 작업 2: 클라우드 LLM API 키 등록 (Supabase Vault / Secrets)
관리자 페이지(`AdminAiSettingsPage.tsx`) 또는 Supabase Edge Function 환경 변수에 클라우드 키 등록:
- `OPENAI_API_KEY`: `gpt-4o-mini` 호출용
- `GEMINI_API_KEY`: `gemini-1.5-flash` 호출용

---

### 📌 작업 3: 관리자 AI 사전 점검 실행 및 단계별 활성화
1. 새 컴퓨터 브라우저에서 `https://www.voicecap.shop/admin/ai-settings` 접속
2. `사전 점검 실행` 버튼을 눌러 Tier 1 (연결), Tier 2 (모델), Tier 3 (합성 추론 시험) 성공 확인
3. `판매 보류 AI 사용: ON`, `음성 정정 AI 사용: ON` 토글하여 실제 방송 적용

---

## 5. 비상 대응 및 롤백 가이드

| 상황 | 조치 방법 | 소요 시간 |
|---|---|---|
| **모델 응답 지연 / 오작동** | 관리자 AI 설정에서 `판매 보류 AI: OFF`, `음성 정정 AI: OFF` 토글 | **즉시 (< 5초)** |
| **로컬 GPU 과열 / 도우미 종료** | 시스템이 자동으로 슬롯 2(클라우드)로 전환 (또는 수동으로 2번 우선 지정) | **자동 / < 10초** |
| **잘못 정정된 판매 건 발생** | 판매 카드에서 `되돌리기` 클릭 또는 `방금 수정한 거 취소` 음성 발화 | **건당 즉시** |
