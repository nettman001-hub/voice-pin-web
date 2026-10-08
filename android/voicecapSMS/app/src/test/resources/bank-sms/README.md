# 은행 SMS 입금 문자 fixture

`bank_rules.json`의 `smsRules`(은행 SMS 입금 문자, 선택 기능·기본 꺼짐)를 검사하는 JVM 테스트 입력이다 (`BankSmsFixtureTest`).

- **여기 있는 문자는 모두 지어낸 예시다.** 실제 은행 문자를 받아 본 것이 아니다. 각 은행 입출금 SMS로 알려진 모양을
  흉내 낸 합성 예시이고(`"synthetic": true`), 이름·금액·계좌번호·시각도 모두 지어낸 값이다.
- **발신번호(`senders`)도 확인되지 않은 추정이다.** 은행 대표번호를 넣어 두었을 뿐, 실제 입금 문자가 그 번호로 오는지는
  실기기로 확인해야 한다. 그래서 규칙은 모두 `verified: false`다.
- 실제 문자를 확인하면: 발신번호를 고치고, 숫자·이름을 가린 문자를 그럴듯한 값으로 다시 채워 여기에 추가한 뒤
  `"synthetic": false`, `"source": "masked-sample"`로 표시하고 규칙을 `verified: true`로 바꾼다.
- 케이스 형식: `sender`(발신번호, 화면에 보이는 그대로), `body`(분할 문자는 합친 뒤의 전체 본문), `sentAt`(epoch ms), `expect`.
  `expect`가 `null`이면 입금으로 올리면 안 되는 문자(출금·결제·은행 번호가 아닌 발신자 등)다.
