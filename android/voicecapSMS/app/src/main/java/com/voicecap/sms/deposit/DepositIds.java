package com.voicecap.sms.deposit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * 은행 알림 입금의 중복 방지 (설계 4.4). sbn.getKey()는 은행앱이 알림 id를 재사용하면 두 번째 입금을 버리므로 쓰지 않는다.
 * - 같은 알림의 갱신·재게시 → 같은 내용·같은 분 → 같은 externalId
 * - 같은 사람·같은 금액 연속 입금 → 잔액이 달라 → 다른 externalId
 * - 잔액을 주지 않는 은행만 90초 로컬 창으로 재게시를 거른다.
 */
public final class DepositIds {
    public static final String PREFIX = "banknoti:";
    public static final long DUPLICATE_WINDOW_MILLIS = 90_000L;
    private static final int HASH_CHARS = 24;

    private DepositIds() { }

    /** banknoti:&lt;package&gt;: + SHA-256(package|amount|payer|balance|postTime 분 단위 내림) 앞 24자. */
    public static String externalId(String packageName, long amount, String payer, Long balance, long postTimeMillis) {
        long minute = Math.floorDiv(postTimeMillis, 60_000L);
        String key = packageName + "|" + amount + "|" + payer + "|" + (balance == null ? "" : balance) + "|" + minute;
        return PREFIX + packageName + ":" + sha256Hex(key).substring(0, HASH_CHARS);
    }

    public static String externalId(DepositParser.Deposit deposit) {
        return externalId(deposit.packageName, deposit.amount, deposit.payerName, deposit.balance, deposit.postTime);
    }

    /** 90초 창은 잔액이 없을 때만. 잔액이 있으면 실제 이중 입금을 버리지 않도록 창을 쓰지 않는다. */
    public static boolean usesDuplicateWindow(DepositParser.Deposit deposit) {
        return deposit.balance == null;
    }

    /** 앞서 받은 같은 패키지·금액·입금자의 입금 시각과 90초 안이면 같은 입금으로 본다. */
    public static boolean withinWindow(long previousPaidAt, long paidAt) {
        return Math.abs(paidAt - previousPaidAt) <= DUPLICATE_WINDOW_MILLIS;
    }

    static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte item : digest) hex.append(Character.forDigit((item >> 4) & 0xf, 16)).append(Character.forDigit(item & 0xf, 16));
            return hex.toString();
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }
}
