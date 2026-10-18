package com.voicecap.deposit;

import org.junit.Test;

import java.util.Arrays;

import static org.junit.Assert.*;

public class DepositLogicTest {
    private static final long T = 1_791_354_180_000L; // 분 경계

    private static BankRules rules(String json) throws Exception {
        return BankRules.parse(json);
    }

    @Test
    public void externalIdHasPrefixPackageAnd24Chars() {
        String id = DepositIds.externalId("com.kbstar.kbbank", 50000, "홍길동", 1234567L, T);
        assertTrue(id.startsWith("banknoti:com.kbstar.kbbank:"));
        String hash = id.substring("banknoti:com.kbstar.kbbank:".length());
        assertEquals(24, hash.length());
        assertTrue(hash.matches("[0-9a-f]{24}"));
    }

    @Test
    public void sameNotificationUpdatedWithinTheMinuteKeepsTheSameId() {
        String first = DepositIds.externalId("pkg.bank", 50000, "홍길동", 1234567L, T + 1_000);
        String repost = DepositIds.externalId("pkg.bank", 50000, "홍길동", 1234567L, T + 59_000);
        assertEquals(first, repost);
    }

    @Test
    public void consecutiveSameAmountDepositsDifferByBalance() {
        String first = DepositIds.externalId("pkg.bank", 50000, "홍길동", 1_000_000L, T);
        String second = DepositIds.externalId("pkg.bank", 50000, "홍길동", 1_050_000L, T);
        assertNotEquals(first, second);
    }

    @Test
    public void idChangesWithPackageAmountPayerAndMinute() {
        String base = DepositIds.externalId("pkg.bank", 50000, "홍길동", null, T);
        assertNotEquals(base, DepositIds.externalId("pkg.other", 50000, "홍길동", null, T));
        assertNotEquals(base, DepositIds.externalId("pkg.bank", 50001, "홍길동", null, T));
        assertNotEquals(base, DepositIds.externalId("pkg.bank", 50000, "김민지", null, T));
        assertNotEquals(base, DepositIds.externalId("pkg.bank", 50000, "홍길동", null, T + 60_000));
        // 잔액 없음과 잔액 0은 다르다.
        assertNotEquals(base, DepositIds.externalId("pkg.bank", 50000, "홍길동", 0L, T));
    }

    @Test
    public void duplicateWindowOnlyWithoutBalance() throws Exception {
        BankRules withBalance = rules("{\"version\":1,\"rules\":[{\"package\":\"p.a\",\"bank\":\"A\",\"require\":[\"입금\"],"
                + "\"patterns\":[\"입금 (?<amount>[0-9,]+) (?<payer>\\\\S+) 잔액 (?<balance>[0-9,]+)\"]}]}");
        BankRules noBalance = rules("{\"version\":1,\"rules\":[{\"package\":\"p.b\",\"bank\":\"B\",\"require\":[\"입금\"],"
                + "\"patterns\":[\"입금 (?<amount>[0-9,]+) (?<payer>\\\\S+)\"]}]}");
        DepositParser.Deposit a = new DepositParser(withBalance).parse("p.a", "입금 1,000 홍길동 잔액 5,000", T).deposit;
        DepositParser.Deposit b = new DepositParser(noBalance).parse("p.b", "입금 1,000 홍길동", T).deposit;
        assertFalse(DepositIds.usesDuplicateWindow(a));
        assertTrue(DepositIds.usesDuplicateWindow(b));
        assertTrue(DepositIds.withinWindow(T, T + 90_000));
        assertTrue(DepositIds.withinWindow(T + 30_000, T));
        assertFalse(DepositIds.withinWindow(T, T + 90_001));
    }

    @Test
    public void missingPayerBecomesUnknownAndReceiverMayBeNull() throws Exception {
        BankRules onlyAmount = rules("{\"version\":2,\"rules\":[{\"package\":\"p.c\",\"bank\":\"C\",\"require\":[\"입금\"],"
                + "\"patterns\":[\"(?<amount>[0-9,]+)원 입금\"],\"verified\":true}]}");
        DepositParser.Result result = new DepositParser(onlyAmount).parse("p.c", "12,300원 입금되었습니다", T);
        assertTrue(result.ok());
        assertEquals(12300, result.deposit.amount);
        assertEquals(DepositParser.UNKNOWN_PAYER, result.deposit.payerName);
        assertNull(result.deposit.balance);
        assertNull(result.deposit.receiverName);
        assertTrue(result.deposit.verifiedRule);
    }

    @Test
    public void excludeListsAreScopedToEachRule() throws Exception {
        // A 은행만 "이체"를 제외해도 B 은행의 "이체입금" 알림은 받는다.
        BankRules two = rules("{\"version\":1,\"rules\":["
                + "{\"package\":\"p.a\",\"bank\":\"A\",\"exclude\":[\"이체\"],\"patterns\":[\"입금 (?<amount>[0-9,]+)\"]},"
                + "{\"package\":\"p.b\",\"bank\":\"B\",\"patterns\":[\"입금 (?<amount>[0-9,]+)\"]}]}");
        DepositParser parser = new DepositParser(two);
        assertFalse(parser.parse("p.a", "이체입금 입금 1,000", T).ok());
        assertTrue(parser.parse("p.b", "이체입금 입금 1,000", T).ok());
    }

    @Test
    public void zeroAmountIsNotADeposit() throws Exception {
        BankRules r = rules("{\"version\":1,\"rules\":[{\"package\":\"p.a\",\"bank\":\"A\",\"patterns\":[\"입금 (?<amount>[0-9,]+)\"]}]}");
        assertFalse(new DepositParser(r).parse("p.a", "입금 0", T).ok());
    }

    @Test(expected = IllegalArgumentException.class)
    public void patternWithoutAmountGroupIsRejected() throws Exception {
        rules("{\"version\":1,\"rules\":[{\"package\":\"p.a\",\"bank\":\"A\",\"patterns\":[\"입금 (?<payer>\\\\S+)\"]}]}");
    }

    @Test
    public void joinPartsDropsDuplicatesAndContainedParts() {
        String joined = DepositParser.joinParts(Arrays.asList("제목", "짧은 본문", "짧은 본문\n둘째 줄", null, "  ", "제목"));
        assertEquals("제목\n짧은 본문\n둘째 줄", joined);
    }

    @Test
    public void receiverAccountNumbersKeepOnlyTheLastFourDigits() {
        assertEquals("****3456", DepositParser.maskAccounts("110-***-123456"));
        assertEquals("주거래 ****6789", DepositParser.maskAccounts("주거래 123456**789"));
        assertEquals("가게 통장", DepositParser.maskAccounts("가게 통장"));
    }

    @Test
    public void maskerHidesDigitsAndUnknownWords() {
        String masked = SampleMasker.mask("[KB]10/07 14:23\n123456**789\n홍길동\n입금\n50,000\n잔액1,234,567", null);
        assertEquals("[KB]##/## ##:##\n######**###\n○○○\n입금\n##,###\n잔액#,###,###", masked);
    }

    @Test
    public void maskerHidesTheParsedPayerEvenInsideKeptWords() {
        String masked = SampleMasker.mask("입금 1,000원 입금홍길동", "입금홍길동");
        assertFalse(masked.contains("홍길동"));
        assertTrue(masked.startsWith("입금 #,###원 "));
    }

    @Test
    public void maskerKeepsStructuralWords() {
        // 이름에 조사가 붙은 낱말은 통째로 가린다 (이름만 떼어 낼 방법이 없음).
        assertEquals("신한 SOL ○○○○○ #,###원 입금했어요",SampleMasker.mask("신한 SOL 김민지님이 1,000원 입금했어요", null));
    }

    @Test
    public void kakaoBankNotificationParsesDepositWithAccountAndBalance() throws Exception {
        BankRules bankRules = BankRules.parse(new String(java.nio.file.Files.readAllBytes(new java.io.File("src/main/assets/bank_rules.json").toPath()), java.nio.charset.StandardCharsets.UTF_8));
        DepositParser parser = new DepositParser(bankRules);
        String text = DepositParser.joinParts(Arrays.asList("입금 1원", "정학현 → 입출금통장(6936) 잔액 39,012원", "정학현 → 입출금통장(6936)\n잔액 39,012원"));
        DepositParser.Result res = parser.parse("com.kakaobank.channel", text, T);
        assertTrue("failed with " + res.failure, res.ok());
        assertEquals("카카오뱅크", res.deposit.bank);
        assertEquals(1L, res.deposit.amount);
        assertEquals("정학현", res.deposit.payerName);
        assertEquals(Long.valueOf(39012L), res.deposit.balance);
        assertEquals("입출금통장(6936)", res.deposit.receiverName);
    }
}
