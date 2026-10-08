package com.voicecap.sms.deposit;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.*;

/** assets/bank_rules.json을 test/resources/bank-noti/의 fixture로 검사한다. */
public class DepositRulesFixtureTest {
    private static final File RULES = new File("src/main/assets/bank_rules.json");
    private static final File FIXTURES = new File("src/test/resources/bank-noti");

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
                List<String> parts = new ArrayList<>();
                parts.add(item.optString("title", ""));
                parts.add(item.optString("text", ""));
                parts.add(item.optString("bigText", ""));
                JSONArray lines = item.optJSONArray("textLines");
                if (lines != null) for (int line = 0; line < lines.length(); line++) parts.add(lines.getString(line));
                DepositParser.Result result = parser.parse(item.getString("package"), parts, item.getLong("postTime"));
                JSONObject expect = item.optJSONObject("expect");
                if (expect == null) {
                    assertFalse(label + ": 올리면 안 되는 알림이 입금으로 잡힘", result.ok());
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
                    assertEquals(label, item.getLong("postTime"), deposit.postTime);
                }
                checked++;
            }
        }
        assertTrue(checked >= 10);
    }

    @Test
    public void shippedRulesAreUnverifiedAndHaveNoGlobalOrFallbackRule() throws Exception {
        BankRules rules = shippedRules();
        assertTrue(rules.version >= 1);
        assertFalse(rules.rules.isEmpty());
        for (BankRules.Rule rule : rules.rules) {
            // 실제 알림 샘플로 확인하기 전에는 모두 미검증.
            assertFalse(rule.packageName + " 규칙이 verified", rule.verified);
            assertTrue("범용 규칙 금지: " + rule.packageName, rule.packageName.contains("."));
            assertFalse(rule.packageName.contains("*"));
            // 잔액·이체는 대부분의 입금 알림에 들어 있으므로 제외 키워드로 쓰지 않는다.
            assertFalse(rule.exclude.contains("잔액"));
            assertFalse(rule.exclude.contains("이체"));
            assertFalse(rule.exclude.contains("입금"));
        }
        assertFalse(new JSONObject(read(RULES)).has("exclude"));
    }

    @Test
    public void unknownPackageNeverParses() throws Exception {
        DepositParser parser = new DepositParser(shippedRules());
        DepositParser.Result result = parser.parse("com.example.unknown", "입금\n50,000\n잔액 1,000", 0);
        assertFalse(result.ok());
        assertEquals(DepositParser.Failure.NO_RULE, result.failure);
    }

    @Test
    public void excludedWordReportsExcluded() throws Exception {
        DepositParser parser = new DepositParser(shippedRules());
        DepositParser.Result result = parser.parse("com.kbstar.kbbank", "홍길동\n출금\n50,000\n잔액 1,000\n입금", 0);
        assertEquals(DepositParser.Failure.EXCLUDED, result.failure);
    }
}
