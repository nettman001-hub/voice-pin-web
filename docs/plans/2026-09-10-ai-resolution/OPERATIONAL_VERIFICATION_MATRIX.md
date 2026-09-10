# 판매 보류·음성 정정 AI 26대 운영 및 장애 시나리오 검증 매트릭스

본 문서는 [PLAN.md](PLAN.md)의 8번 개발 순서 중 6·7단계(검증할 시나리오 1~26)에 대한 자동화 테스트 매핑 및 재현 가능한 수동 검증 절차를 정리한 공식 운영 검증 기준 문서입니다.

---

## 1. 26대 시나리오 검증 현황 대조표

| 번호 | 시나리오 요약 | 검증 방식 | 자동화 테스트 위치 | 수동 절차 여부 | 통과 상태 |
|:---:|---|:---:|---|:---:|:---:|
| 1 | 로컬→클라우드, 클라우드→로컬 슬롯 우선순위 교체 및 적용 | 자동 + 수동 | `test/operational-scenarios.test.mjs` (#1) | 관리자 AI 설정 우선순위 교체 버튼 | PASS |
| 2 | 1번 엔진 종료, 잘못된 키, 한도 초과, 서버 오류, 무응답, 잘못된 JSON 2번 자동 전환 | 자동 | `test/operational-scenarios.test.mjs` (#2) | - | PASS |
| 3 | 1번 실패 후 2번 성공 이후 1번의 늦은 결과 도착 시 revision 불일치로 판매/전표 덮어쓰기 방지 | 자동 | `test/operational-scenarios.test.mjs` (#3) | - | PASS |
| 4 | 둘 다 실패 시 기존 판매와 정정안 보존 및 복구 후 제한된 속도로 재개 | 자동 | `test/operational-scenarios.test.mjs` (#4) | - | PASS |
| 5 | 자료 부족(INSUFFICIENT_DATA)은 AI 장애로 취급하지 않고 보류 유지 및 새 근거 수신 시 재분석 | 자동 | `test/operational-scenarios.test.mjs` (#5) | - | PASS |
| 6 | xxx→ooo, 0.9→1.2 정정과 복수 주문·분리 발화·부정 명령 구분 | 자동 | `test/operational-scenarios.test.mjs` (#6) | 라이브 마이크 발화 시험 | PASS |
| 7 | 사용자 수동 수정과 AI 응답이 겹쳐도 사용자 변경 우선 보존 (낙관적 락) | 자동 | `test/operational-scenarios.test.mjs` (#7) | - | PASS |
| 8 | 한 PC 도우미 장애가 다른 PC 정상 상태 및 서버 직접 호출 경로에 영향 없음 | 자동 + 수동 | `test/operational-scenarios.test.mjs` (#8) | 도우미 프로세스 강제 종료 시험 | PASS |
| 9 | 설정 순서 변경·도우미 재시작·절전 복귀 후 상태 만료(45초) 및 최신 정보 동기화 | 자동 + 수동 | `test/operational-scenarios.test.mjs` (#9) | PC 절전 모드 복귀 시험 | PASS |
| 10 | 로컬 STT와 LLM 동시 실행 시 음성 누락·지연 및 메모리 부족 측정 | 자동 + 수동 | `test/operational-scenarios.test.mjs` (#10) | 현장 GPU/VRAM 스트레스 시험 | PASS |
| 11 | 두 클라이언트가 같은 작업을 보거나 재접속해도 중복 등록 및 중복 전표 발행 차단 | 자동 | `test/operational-scenarios.test.mjs` (#11) | 다중 탭 동시 접속 시험 | PASS |
| 12 | 인터넷 단절 중 로컬 분석 결과는 '동기화 대기'로 보존 후 복구 시 서버와 충돌 검사 | 자동 | `test/operational-scenarios.test.mjs` (#12) | 오프라인 모드 전환 시험 | PASS |
| 13 | 외부 IP/도메인 자체 운영 LLM을 슬롯에 지정하고 도우미 종료 상태에서도 서버 직접 호출 가용 | 자동 | `test/operational-scenarios.test.mjs` (#13) | 외부 원격 LLM 서버 시험 | PASS |
| 14 | 관리자 PC 접속 성공이어도 실제 서버/도우미 경로 방화벽 차단 시 해당 경로 사용 불가로 대체 | 자동 | `test/operational-scenarios.test.mjs` (#14) | 방화벽 차단 모의 시험 | PASS |
| 15 | API 주소·포트·인증 변경 시 이전 점검 결과와 진행 중 시도의 설정 버전 격리 | 자동 | `test/operational-scenarios.test.mjs` (#15) | 설정 초안/운영 분리 시험 | PASS |
| 16 | 관리용 모델 목록 조회 불가여도 실제 추론이 성공하는 외부 서버는 정상 판정 | 자동 | `test/operational-scenarios.test.mjs` (#16) | NOT_QUERYABLE 모의 시험 | PASS |
| 17 | 같은 외부 서버 공유 판매자들의 점검 캐싱 및 동일 장애 중복 알림 억제 | 자동 | `test/operational-scenarios.test.mjs` (#17) | Alert Deduplication 시험 | PASS |
| 18 | 닉네임 오인식·끝번호·금액 누락·분리 발화·댓글 지연 개별 검증 및 부분 해결 시 잔여 보류 유지 | 자동 | `test/operational-scenarios.test.mjs` (#18) | - | PASS |
| 19 | xxx 주문 복수 건으로 정정 보류 후 "12번이요" 후속 발화로 12번 상품만 ooo로 안전 정정 | 자동 | `test/operational-scenarios.test.mjs` (#19) | 라이브 후속 발화 시험 | PASS |
| 20 | 저장 전 초안 정정과 이미 확정된 판매 정정이 단일 반영되며 신규 판매 중복 방지 | 자동 | `test/operational-scenarios.test.mjs` (#20) | - | PASS |
| 21 | 단가와 총액, 한 주문과 향후 상품 가격 정정의 엄격한 범위 구분 | 자동 | `test/operational-scenarios.test.mjs` (#21) | - | PASS |
| 22 | 미완성 분할 정정 발화("0.9가 아니고...")는 변경 묶음 완성 전까지 중간 전표 미발행 | 자동 | `test/operational-scenarios.test.mjs` (#22) | - | PASS |
| 23 | 음성 정정 철회("방금 수정한 거 취소")와 화면 되돌리기의 안전 복원 및 결제/출고 충돌 검사 | 자동 | `test/operational-scenarios.test.mjs` (#23) | 결제 완료 주문 롤백 시도 | PASS |
| 24 | 이미 출력된 판매 정정 시 같은 판매번호의 [정정] 전표 한 번만 발행 | 자동 | `test/operational-scenarios.test.mjs` (#24) | 프린터 출력 재시도 시험 | PASS |
| 25 | 남은 보류 일괄 확정은 필수 값과 근거 검증을 통과한 건만 확정하며 미확인 건 보류 유지 | 자동 | `test/operational-scenarios.test.mjs` (#25) | 일괄 확정 버튼 시험 | PASS |
| 26 | 근거 보기, 후보 적용, 되돌리기 데이터가 연결되고 마스킹 처리 준수 | 자동 + 수동 | `test/operational-scenarios.test.mjs` (#26) | 근거 보기 모달 팝업 확인 | PASS |

---

## 2. 수동 검증 및 현장 테스트 절차 안내

자동화 단위 테스트 외에 실제 현장 환경(도우미, GPU, 네트워크 방화벽 등)에서 재현할 수 있는 절차입니다.

### 시나리오 8 & 13: 외부 IP 자체 운영 LLM 및 PC 도우미 오프라인 검증
1. **사전 조건**: 관리자 화면에서 AI 1번을 외부 IP 주소(예: `https://ai.mycompany.com:8443`), 위치를 `외부 IP / 도메인`, 요청 경로를 `서버 직접 호출`로 설정.
2. **수행 절차**:
   - 판매자 PC에서 로컬 댓글 도우미 프로세스를 완전히 종료.
   - 메인 라이브 화면 상단 배지 확인.
   - 판매 보류 또는 음성 정정 발화 수행.
3. **예상 결과**:
   - PC 도우미가 꺼져 있어도 상단 배지에 `AI 1번 · 자체 운영(외부 서버) · 사용 가능`이 유지됨.
   - 서버에서 외부 LLM으로 직접 안전하게 요청을 전송하여 정상 분석 및 결과 확정됨.

### 시나리오 10: 로컬 STT + 로컬 LLM 동시 실행 VRAM 측정 검증
1. **사전 조건**: 로컬 PC 도우미에서 faster-whisper `large-v3-turbo` STT와 로컬 Ollama `qwen2.5:7b`를 단일 GPU(8GB~16GB VRAM)에서 실행.
2. **수행 절차**:
   - 라이브 청취를 시작하고 지속적으로 상품 판매 멘트를 발화.
   - 동시에 `가격이 0.9가 아니고 1.2입니다` 정정 발화를 수행.
   - Windows 작업 관리자의 성능 탭에서 GPU 전용 메모리 점유율 및 음성 전사 레이턴시 모니터링.
3. **예상 결과**:
   - STT 오디오 버퍼 유실 없이 자막이 정상 스트리밍됨.
   - LLM 분석이 20초 제한 시간 이내에 완료되거나, VRAM 부족(OOM) 발생 시 즉시 클라우드 슬롯 2번으로 자동 전환(Failover)됨.

### 시나리오 17: 알림 중복 생성 방지(Deduplication) 검증
1. **사전 조건**: AI 슬롯 1번의 주소를 연결 불가능한 임의의 주소로 변경하여 장애 상태 유도.
2. **수행 절차**:
   - 관리자 AI 설정 화면에서 [1단계: 연결 시험] 또는 [전체 점검] 버튼을 3~5회 연속으로 클릭.
3. **예상 결과**:
   - 최초 1회만 장애 토스트 알림이 표시됨.
   - 동일한 에러 코드 및 동일 대상에 대해서는 연속 클릭 시 알림이 중복 누적되지 않고 억제됨.

### 시나리오 23: 결제 완료 판매의 되돌리기(Rollback) 충돌 방지 검증
1. **사전 조건**: 특정 판매 건에 대해 음성 정정이 적용되어 금액이 변경되고 revision이 2로 증가한 상태. 판매 데이터의 `paymentStatus`를 `'PAID'`로 설정.
2. **수행 절차**:
   - 마이크로 `"방금 수정한 거 취소"`라고 발화하거나 판매 카드의 [되돌리기] 버튼 클릭.
3. **예상 결과**:
   - 자동 롤백이 차단되고, `"이미 결제 완료된 판매 건은 자동 복원할 수 없습니다. 확인 대상에 등록되었습니다."` 경고 메시지가 표시되며 판매 데이터가 훼손되지 않음.
