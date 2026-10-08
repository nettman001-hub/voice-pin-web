package com.voicecap.sms.deposit;

import com.voicecap.sms.LocalDb;

import java.util.List;

/**
 * 은행 알림과 은행 입금 문자를 둘 다 켜면 같은 입금이 banknoti:·banksms: 두 키로 두 번 올라간다. 뒤에 온 쪽을 로컬에서 거른다.
 * 같은 입금 = 같은 은행·같은 금액·몇 분 안, 그리고 (둘 다 잔액이 있으면) 같은 잔액, (아니면) 같은 입금자명.
 * 실제 이중 입금을 버리는 것이 중복 업로드보다 나쁘므로 애매하면(은행·입금자 모름, 잔액 다름) 올린다.
 * 한 건은 다른 경로의 한 건하고만 짝지어진다: 같은 사람이 같은 금액을 두 번 보내면 알림 2건·문자 2건이 각각 한 쌍씩 된다.
 */
public final class DepositDedupe {
    /** 은행 알림 시각과 문자 발송 시각 차이. 알림이 늦게 오거나 문자가 지연되는 경우를 덮는 정도. */
    public static final long CROSS_SOURCE_WINDOW_MILLIS = 5 * 60_000L;
    /** 짝지어져 올리지 않은 입금. deposits.state에 남겨 짝 세기에만 쓰고 피드에는 보이지 않는다. */
    public static final String STATE_LOCAL_DUPLICATE = "LOCAL_DUPLICATE";

    private DepositDedupe() { }

    /** 서로 다른 경로(알림·문자)의 두 입금이 같은 입금인지. */
    public static boolean sameDeposit(LocalDb.DepositRow a, LocalDb.DepositRow b) {
        if (a.source == null || b.source == null || a.source.equals(b.source)) return false;
        if (a.bank == null || a.bank.trim().isEmpty() || !a.bank.trim().equals(b.bank == null ? null : b.bank.trim())) return false;
        if (a.amount != b.amount) return false;
        if (Math.abs(a.paidAt - b.paidAt) > CROSS_SOURCE_WINDOW_MILLIS) return false;
        if (a.balance != null && b.balance != null) return a.balance.longValue() == b.balance.longValue();
        String payerA = normalizePayer(a.payer);
        return payerA != null && payerA.equals(normalizePayer(b.payer));
    }

    /**
     * 새 입금이 이미 기록된 다른 경로 입금의 짝인지. 같은 입금으로 보이는 다른 경로 건수가
     * 이미 짝을 맺은(또는 같은 경로로 따로 올린) 같은 경로 건수보다 많을 때만 짝으로 본다.
     * @param nearby 같은 은행·금액의 최근 입금(짝 표시된 것 포함)
     */
    public static boolean isDuplicate(LocalDb.DepositRow incoming, List<LocalDb.DepositRow> nearby) {
        int otherSource = 0;
        int sameSource = 0;
        for (LocalDb.DepositRow row : nearby) {
            if (row.externalId != null && row.externalId.equals(incoming.externalId)) continue;
            if (sameDeposit(incoming, row)) otherSource++;
            else if (incoming.source != null && incoming.source.equals(row.source) && looksAlike(incoming, row)) sameSource++;
        }
        return otherSource > sameSource;
    }

    /** 같은 경로의 두 입금이 다른 경로의 같은 한 건과 짝지어질 수 있는지 (짝 세기용). */
    private static boolean looksAlike(LocalDb.DepositRow a, LocalDb.DepositRow b) {
        LocalDb.DepositRow mirror = new LocalDb.DepositRow();
        mirror.source = "\u0000";
        mirror.bank = b.bank;
        mirror.amount = b.amount;
        mirror.paidAt = b.paidAt;
        mirror.balance = b.balance;
        mirror.payer = b.payer;
        return sameDeposit(a, mirror);
    }

    /** 공백 무시. 입금자명을 못 뽑은 경우(미확인)는 근거가 없으므로 null. */
    static String normalizePayer(String payer) {
        if (payer == null) return null;
        String value = payer.replaceAll("\\s+", "");
        if (value.isEmpty() || DepositParser.UNKNOWN_PAYER.equals(value)) return null;
        return value;
    }
}
