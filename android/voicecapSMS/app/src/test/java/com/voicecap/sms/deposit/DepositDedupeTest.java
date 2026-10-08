package com.voicecap.sms.deposit;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.voicecap.sms.LocalDb;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;

/** 은행 알림(banknoti:)과 은행 입금 문자(banksms:)를 둘 다 켰을 때의 같은 입금 판단. 애매하면 올린다. */
public class DepositDedupeTest {
    private static final long T = 1_800_000_000_000L;
    private static final String NOTI = DepositRecorder.SOURCE_NOTIFICATION;
    private static final String SMS = DepositRecorder.SOURCE_SMS;
    private static int ids;

    private static LocalDb.DepositRow row(String source, String bank, long amount, String payer, Long balance, long paidAt) {
        LocalDb.DepositRow row = new LocalDb.DepositRow();
        row.externalId = source + ":" + (ids++);
        row.source = source;
        row.bank = bank;
        row.amount = amount;
        row.payer = payer;
        row.balance = balance;
        row.paidAt = paidAt;
        return row;
    }

    /** 순서대로 기록하며 올린 건/짝으로 거른 건을 나눈다 (LocalDb.recordDeposit과 같은 규칙: 거른 건도 짝 세기용으로 남김). */
    private static List<Boolean> replay(LocalDb.DepositRow... rows) {
        List<LocalDb.DepositRow> stored = new ArrayList<>();
        List<Boolean> uploaded = new ArrayList<>();
        for (LocalDb.DepositRow incoming : rows) {
            uploaded.add(!DepositDedupe.isDuplicate(incoming, stored));
            stored.add(incoming);
        }
        return uploaded;
    }

    @Test public void sameBalanceAcrossSourcesIsOneDeposit() {
        assertTrue(DepositDedupe.sameDeposit(row(NOTI, "KB국민은행", 30000, "홍길동", 130000L, T), row(SMS, "KB국민은행", 30000, "홍길*", 130000L, T + 40_000)));
        assertFalse(replay(row(NOTI, "KB국민은행", 30000, "홍길동", 130000L, T), row(SMS, "KB국민은행", 30000, "홍길동", 130000L, T + 40_000)).get(1));
        // 문자가 먼저 와도 같다.
        assertFalse(replay(row(SMS, "KB국민은행", 30000, "홍길동", 130000L, T), row(NOTI, "KB국민은행", 30000, "홍길동", 130000L, T + 40_000)).get(1));
    }

    @Test public void differentBalanceIsARealSecondDeposit() {
        assertFalse(DepositDedupe.sameDeposit(row(NOTI, "KB국민은행", 30000, "홍길동", 130000L, T), row(SMS, "KB국민은행", 30000, "홍길동", 160000L, T + 30_000)));
    }

    @Test public void withoutBothBalancesThePayerMustMatch() {
        assertTrue(DepositDedupe.sameDeposit(row(NOTI, "신한은행", 50000, "김 영희", null, T), row(SMS, "신한은행", 50000, "김영희", 200000L, T + 60_000)));
        assertFalse(DepositDedupe.sameDeposit(row(NOTI, "신한은행", 50000, "김영희", null, T), row(SMS, "신한은행", 50000, "이철수", null, T + 60_000)));
        // 입금자명을 못 뽑았으면 근거가 없으므로 올린다.
        assertFalse(DepositDedupe.sameDeposit(row(NOTI, "신한은행", 50000, DepositParser.UNKNOWN_PAYER, null, T), row(SMS, "신한은행", 50000, DepositParser.UNKNOWN_PAYER, null, T)));
    }

    @Test public void differentBankAmountSourceOrTimeIsNotTheSame() {
        LocalDb.DepositRow base = row(NOTI, "NH농협은행", 10000, "박민수", null, T);
        assertFalse(DepositDedupe.sameDeposit(base, row(SMS, "KB국민은행", 10000, "박민수", null, T)));
        assertFalse(DepositDedupe.sameDeposit(base, row(SMS, "NH농협은행", 10001, "박민수", null, T)));
        assertFalse(DepositDedupe.sameDeposit(base, row(SMS, "NH농협은행", 10000, "박민수", null, T + DepositDedupe.CROSS_SOURCE_WINDOW_MILLIS + 1)));
        assertTrue(DepositDedupe.sameDeposit(base, row(SMS, "NH농협은행", 10000, "박민수", null, T + DepositDedupe.CROSS_SOURCE_WINDOW_MILLIS)));
        // 같은 경로끼리는 여기서 거르지 않는다 (기존 externalId·90초 창 담당).
        assertFalse(DepositDedupe.sameDeposit(base, row(NOTI, "NH농협은행", 10000, "박민수", null, T)));
        assertFalse(DepositDedupe.sameDeposit(row(NOTI, null, 10000, "박민수", null, T), row(SMS, null, 10000, "박민수", null, T)));
    }

    @Test public void realDoubleDepositWithoutBalanceIsUploadedTwice() {
        // 같은 사람이 같은 금액을 3분 간격으로 두 번 보냄. 알림·문자가 각각 2건씩 오면 정확히 2건만 올라가야 한다.
        List<Boolean> uploaded = replay(
                row(NOTI, "신한은행", 20000, "최지은", null, T),
                row(SMS, "신한은행", 20000, "최지은", null, T + 20_000),
                row(NOTI, "신한은행", 20000, "최지은", null, T + 180_000),
                row(SMS, "신한은행", 20000, "최지은", null, T + 200_000));
        assertTrue(Arrays.asList(true, false, true, false).equals(uploaded));
    }

    @Test public void realDoubleDepositWhenOnlyOneSourceArrivedIsKept() {
        // 알림 2건(실제 두 번 입금)에 문자는 1건만 온 경우: 문자 1건만 짝으로 걸러지고 알림 2건은 모두 올라간다.
        List<Boolean> uploaded = replay(
                row(NOTI, "신한은행", 20000, "최지은", null, T),
                row(NOTI, "신한은행", 20000, "최지은", null, T + 120_000),
                row(SMS, "신한은행", 20000, "최지은", null, T + 130_000));
        assertTrue(Arrays.asList(true, true, false).equals(uploaded));
        // 문자 2건이 먼저, 알림 1건이 뒤에 와도 두 건이 남는다.
        uploaded = replay(
                row(SMS, "신한은행", 20000, "최지은", null, T),
                row(SMS, "신한은행", 20000, "최지은", null, T + 120_000),
                row(NOTI, "신한은행", 20000, "최지은", null, T + 130_000));
        assertTrue(Arrays.asList(true, true, false).equals(uploaded));
    }

    @Test public void balancesKeepDoubleDepositsApartEvenWithMixedSources() {
        List<Boolean> uploaded = replay(
                row(NOTI, "KB국민은행", 30000, "홍길동", 130000L, T),
                row(SMS, "KB국민은행", 30000, "홍길동", 130000L, T + 10_000),
                row(NOTI, "KB국민은행", 30000, "홍길동", 160000L, T + 60_000),
                row(SMS, "KB국민은행", 30000, "홍길동", 160000L, T + 70_000));
        assertTrue(Arrays.asList(true, false, true, false).equals(uploaded));
    }
}
