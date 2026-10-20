# STT 진단 로그

라이브 청취 홈의 **STT 진단 로그 저장**은 현재 회차의 진단 이벤트와 현재 판매·전사 기록을 JSON 파일 하나로 내려받는다. 운영 화면과 `/live-test`에서 같은 기능을 사용한다. 기록은 기능 적용 후 들어오는 새 이벤트부터 시작하며 과거 STT 응답을 복원하지 않는다.

## 기록 흐름

- `stt.response`: 공급자의 수신 JSON. Soniox 토큰·확정 여부·토큰 시각·종료 신호, Deepgram `is_final`·`speech_final`, 로컬 Whisper 및 Web Speech 결과를 보존한다. API 키가 있는 초기 송신 설정이나 바이너리 오디오는 기록하지 않는다.
- `stt.tokens.filtered`: Soniox 연결 교체 시 원본 토큰 중 실제 처리에 남은 토큰과 경계 시각.
- `stt.transcript`, `assembly.soniox.*`: 앱으로 전달한 문장·확정 토큰 증분, 업무 버퍼 이전 값, 문장부호/종료 신호/타임아웃에 의한 출력 및 제외 사유.
- `transaction.decision`: 조립 전후 거래, 원문 조각, 인식한 가격과 독립 가격 검증 결과, 캡처 여부, 새 판매 결과. 예: `NEUTRAL_TALK_NOT_APPENDED`, `CONTINUATION_REJECTED`, `SALE_FACTS_UNCHANGED`.
- `sale.evaluation`, `workflow.evaluation`: 일반/판매방식 모드의 판정 및 제외 사유. 단독 캡처와 판매에 연결된 캡처를 구분한다.
- `sale.proposed`, `sale.linked`, `sale.excluded`: 실제 판매 연결과 중복·구매 댓글 사용·수정/취소 등의 저장 제외 사유.
- `sale.queued`, `sale.save.started`, `sale.save.failed`, `sale.fallback.applied`, `sale.save.acknowledged`: 저장 대기열부터 저장소 확인 응답까지. `TEST`의 확인 응답은 테스트 DB 저장을 뜻하며 운영 서버 저장과 구별한다.
- `capture.*`, `listening.*`, `pipeline.failed`: 화면 캡처 결과·판매 연결, 청취 연결 상태, 처리 예외.

`responseId` → `eventId`/`sourceEventId` → `transactionId` → `saleId` 및 `operationId`로 같은 처리의 이벤트를 추적한다. 이벤트는 ISO 수신 시각과 페이지별 순번을 포함한다. JSON 최상위 `snapshots`는 다운로드 시점의 해당 회차 판매 및 전사 기록이다.

## 보관과 격리

전용 IndexedDB `voicecap-stt-diagnostics-v1`에 로컬 보관한다. 계정 작업공간·운영/테스트 모드·방송 회차로 구분하며 운영 API로 전송하지 않는다. 같은 회차를 새로고침한 뒤에도 보관된 로그를 합쳐 다운로드한다. 다운로드 도중 계정이 바뀌면 다운로드를 취소한다.

실시간 오디오 처리에 로그 저장 실패를 전파하지 않는다. 저장소가 실패하면 현재 메모리에 남은 기록을 내보내고 `warnings`에 실패를 명시한다. 각 페이지의 회차별 최근 128개 페이지(페이지당 100개 이벤트)를 보관하며 오래된 이벤트가 교체되면 `streams[].omittedEarlierEvents`와 `warnings`에 누락을 표시한다. 원본 응답과 문장들은 보관 범위 내에서 길이로 잘라내지 않는다. 장시간 재현은 문제 발생 직후 다운로드하는 것이 좋다.

파일 생성 전 API 키·인증 토큰·쿠키 등의 필드를 제거한다. 판매자 발화와 판매 정보는 원인 분석 자료로 포함된다. 이 기능은 판정 과정을 관찰하며 기존 판매 추출·가격·캡처 규칙은 바꾸지 않는다.
