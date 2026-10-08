# 은행 알림 fixture

`bank_rules.json` 규칙을 검사하는 JVM 테스트 입력이다 (`DepositRulesFixtureTest`).

- 지금 있는 파일은 모두 **실제 알림이 아니다.** 각 은행의 입출금 SMS 형식을 본떠 만든 합성 예시이고(`"synthetic": true`),
  이름·금액·계좌번호도 지어낸 값이다. 규칙이 `verified: false`인 이유와 같다.
- 실제 샘플은 앱의 입금확인 탭 → 샘플 수집 모드로 모은 뒤, **가린 샘플만** 내보내 여기에 추가한다.
  가린 숫자(#)는 사람이 그럴듯한 값으로 다시 채우고 `"synthetic": false`, `"source": "masked-sample"`로 표시한다.
- 케이스 형식: `package`, `title`, `text`, `bigText`, `textLines`(배열), `postTime`(epoch ms), `expect`.
  `expect`가 `null`이면 업로드하면 안 되는 알림(출금·결제·예정·광고 등)이다.
