package com.voicecap.sms.deposit;

import com.voicecap.sms.SmsAssembler;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.*;

/** 은행 SMS 입금 문자 (Phase 6, 설계 4.5): smsRules를 test/resources/bank-sms/의 지어낸 fixture로 검사한다. */
public class BankSmsFixtureTest {
    private static final File RULES = new File("src/main/assets/bank_rules.json");
    private static final File FIXTURES = new File("src/test/resources/bank-sms");

    private static String read(File file) throws Exception {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    private static BankRules shippedRules() throws Exception {
        return BankRules.parse(read(RULES));
    }

    @Test
    public void everyFixtureCaseMatchesItsExpectation() throws Exception {
        DepositParser parser = new DepositParser(shippedRules());
        File[] files = FIXTURES.listFiles((dir, name) -> name.endsWith(".json"));
        assertNotNull(files);
        assertTrue("fixture 파일이 없음", files.length > 0);
        Arrays.sort(files);
        int checked = 0;
        for (File file : files) {
            JSONArray cases = new JSONObject(read(file)).getJSONArray("cases");
            for (int index = 0; index < cases.length(); index++) {
                JSONObject item = cases.getJSONObject(index);
                String label = file.getName() + " / " + item.getString("name");
                assertTrue(label + ": 지어낸 예시는 synthetic 표시", item.getBoolean("synthetic"));
                DepositParser.Result result = BankSmsDepositDetector.detect(true, parser, item.getString("sender"),
                        item.getString("body"), item.getLong("sentAt"));
                assertNotNull(label, result);
                JSONObject expect = item.optJSONObject("expect");
                if (expect == null) {
                    assertFalse(label + ": 올리면 안 되는 문자가 입금으로 잡힘", result.ok());
                } else {
                    assertTrue(label + ": 입금을 못 읽음 (" + result.failure + ")", result.ok());
                    DepositParser.Deposit deposit = result.deposit;
                    assertEquals(label, expect.getString("bank"), deposit.bank);
                    assertEquals(label, expect.getLong("amount"), deposit.amount);
                    assertEquals(label, expect.getString("payer"), deposit.payerName);
                    if (expect.isNull("balance")) assertNull(label, deposit.balance);
                    else assertEquals(label, Long.valueOf(expect.getLong("balance")), deposit.balance);
                    if (expect.isNull("receiverName")) assertNull(label, deposit.receiverName);
                    else assertEquals(label, expect.getString("receiverName"), deposit.receiverName);
                    assertEquals(label, item.getLong("sentAt"), deposit.postTime);
                    assertTrue(label, deposit.packageName.startsWith(BankRules.SMS_KEY_PREFIX));
                }
                checked++;
            }
        }
        assertTrue(checked >= 8);
    }

    @Test
    public void smsRulesAreSeparateUnverifiedAndHaveSenders() throws Exception {
        BankRules rules = shippedRules();
        assertTrue(rules.version >= 2);
        assertFalse(rules.smsRules.isEmpty());
        for (BankRules.Rule rule : rules.smsRules) {
            assertFalse(rule.packageName + " SMS 규칙이 verified", rule.verified);
            assertTrue(rule.packageName.startsWith(BankRules.SMS_KEY_PREFIX));
            assertFalse("발신번호 없는 SMS 규칙 금지(범용 규칙): " + rule.packageName, rule.senders.isEmpty());
            for (String sender : rule.senders) assertTrue(sender.matches("[0-9]{4,}"));
            assertFalse(rule.exclude.contains("잔액"));
            assertFalse(rule.exclude.contains("이체"));
            assertFalse(rule.exclude.contains("입금"));
        }
        // 알림 규칙과 SMS 규칙은 섞이지 않는다.
        for (BankRules.Rule rule : rules.rules) assertTrue(rule.senders.isEmpty());
        assertTrue(rules.forPackage(BankRules.SMS_KEY_PREFIX + "kb").isEmpty());
    }

    @Test
    public void switchOffDoesNothingEvenForABankDepositText() throws Exception {
        DepositParser parser = new DepositParser(shippedRules());
        String body = "[KB]10/08 14:23\n123456**789\n홍길동\n전자금융입금\n50,000\n잔액1,234,567";
        assertTrue(BankSmsDepositDetector.detect(true, parser, "1588-9999", body, 0).ok());
        assertNull(BankSmsDepositDetector.detect(false, parser, "1588-9999", body, 0));
    }

    @Test
    public void switchNeedsConsent() {
        assertFalse(BankSmsDepositDetector.enabled(false, false));
        assertFalse(BankSmsDepositDetector.enabled(true, false)); // 동의 철회 = 꺼짐
        assertFalse(BankSmsDepositDetector.enabled(false, true));  // 기본 꺼짐
        assertTrue(BankSmsDepositDetector.enabled(true, true));
    }

    @Test
    public void unknownSenderNeverParses() throws Exception {
        DepositParser parser = new DepositParser(shippedRules());
        DepositParser.Result result = parser.parseSms("010-1234-5678", "입금\n50,000\n잔액 1,000", 0);
        assertFalse(result.ok());
        assertEquals(DepositParser.Failure.NO_RULE, result.failure);
        assertEquals(DepositParser.Failure.NO_RULE, parser.parseSms(null, "입금 50,000", 0).failure);
        assertEquals(DepositParser.Failure.NO_RULE, parser.parseSms("", "입금 50,000", 0).failure);
    }

    @Test
    public void senderNormalization() {
        assertEquals("15889999", BankSmsDepositDetector.normalizeSender("1588-9999"));
        assertEquals("15889999", BankSmsDepositDetector.normalizeSender(" 1588 9999 "));
        assertEquals("15889999", BankSmsDepositDetector.normalizeSender("+8215889999"));
        assertEquals("01012345678", BankSmsDepositDetector.normalizeSender("+82 10-1234-5678"));
        assertEquals("", BankSmsDepositDetector.normalizeSender(null));
        assertEquals("", BankSmsDepositDetector.normalizeSender("KB국민은행"));
    }

    @Test
    public void bankSmsIdsAreStableAndSeparateFromNotifications() {
        long sentAt = 1791440580000L;
        String first = DepositIds.smsExternalId("sms:kb", 50000, "홍길동", 1234567L, sentAt);
        assertTrue(first.startsWith("banksms:"));
        assertEquals("banksms:".length() + 24, first.length());
        // 같은 문자를 다시 읽음(같은 분) → 같은 id
        assertEquals(first, DepositIds.smsExternalId("sms:kb", 50000, "홍길동", 1234567L, sentAt + 30_000L));
        // 같은 사람·같은 금액 연속 입금 → 잔액이 달라 다른 id
        assertNotEquals(first, DepositIds.smsExternalId("sms:kb", 50000, "홍길동", 1284567L, sentAt));
        // 다른 은행 규칙 → 다른 id
        assertNotEquals(first, DepositIds.smsExternalId("sms:nh", 50000, "홍길동", 1234567L, sentAt));
        // 은행 앱 알림 id와 접두어가 달라 서버에서 겹치지 않는다.
        assertTrue(DepositIds.externalId("com.kbstar.kbbank", 50000, "홍길동", 1234567L, sentAt).startsWith("banknoti:"));
    }

    @Test
    public void splitBankSmsIsJudgedAfterJoining() throws Exception {
        DepositParser parser = new DepositParser(shippedRules());
        List<SmsAssembler.Message> joined = SmsAssembler.assemble(Arrays.asList(
                new SmsAssembler.Segment("1588-9999", "[Web발신]\n[KB]10/08 14:23\n123456**789\n홍길", 1791440580000L),
                new SmsAssembler.Segment("1588-9999", "동\n전자금융입금\n50,000\n잔액1,234,567", 1791440580000L)));
        assertEquals(1, joined.size());
        // 조각만으로는 읽히지 않는다.
        assertFalse(parser.parseSms("1588-9999", "[Web발신]\n[KB]10/08 14:23\n123456**789\n홍길", 0).ok());
        DepositParser.Result result = BankSmsDepositDetector.detect(true, parser, joined.get(0).address, joined.get(0).body, joined.get(0).sentAtMillis);
        assertTrue(result.ok());
        assertEquals("홍길동", result.deposit.payerName);
        assertEquals(50000, result.deposit.amount);
        assertEquals(DepositIds.smsExternalId(result.deposit),
                DepositIds.smsExternalId("sms:kb", 50000, "홍길동", 1234567L, 1791440580000L));
    }
}
