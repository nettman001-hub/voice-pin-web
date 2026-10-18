package com.voicecap.deposit;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 은행 알림·은행 SMS 글자 → 입금 한 건. 그 패키지(발신번호) 규칙에 맞지 않으면 아무것도 만들지 않는다 (범용 폴백 없음). */
public final class DepositParser {
    /** 입금자명을 뽑지 못한 경우 서버로 보내는 값 (payment_receipts.payer_name NOT NULL). */
    public static final String UNKNOWN_PAYER = "미확인";
    private static final int MAX_PAYER_LENGTH = 100;
    private static final int MAX_RECEIVER_LENGTH = 200;
    private static final Pattern NON_DIGITS = Pattern.compile("[^0-9]");
    private static final Pattern SPACES = Pattern.compile("\\s+");
    /** 4자리 이상 이어진 숫자(별표·하이픈 포함) = 계좌번호로 보고 끝 4자리만 남긴다. */
    private static final Pattern ACCOUNT_LIKE = Pattern.compile("[0-9][0-9*\\-]{3,}[0-9*]");

    public enum Failure { NO_RULE, EXCLUDED, NO_MATCH }

    public static final class Deposit {
        public final String packageName;
        public final String bank;
        public final long amount;
        public final String payerName;
        /** 규칙이 잔액을 주지 않으면 null (이때만 90초 중복 창을 쓴다). */
        public final Long balance;
        /** 받는 계좌 별칭. 없으면 null. 계좌번호는 끝 4자리만 남긴다. */
        public final String receiverName;
        public final long postTime;
        public final boolean verifiedRule;

        Deposit(String packageName, String bank, long amount, String payerName, Long balance, String receiverName,
                long postTime, boolean verifiedRule) {
            this.packageName = packageName;
            this.bank = bank;
            this.amount = amount;
            this.payerName = payerName;
            this.balance = balance;
            this.receiverName = receiverName;
            this.postTime = postTime;
            this.verifiedRule = verifiedRule;
        }
    }

    public static final class Result {
        public final Deposit deposit;
        public final Failure failure;

        private Result(Deposit deposit, Failure failure) {
            this.deposit = deposit;
            this.failure = failure;
        }

        public boolean ok() { return deposit != null; }
    }

    private final BankRules rules;

    public DepositParser(BankRules rules) { this.rules = rules; }

    /** 알림에서 모은 글자 조각(제목·본문·큰 본문 등)을 중복 없이 줄바꿈으로 잇는다. */
    public static String joinParts(List<? extends CharSequence> parts) {
        Set<String> seen = new LinkedHashSet<>();
        for (CharSequence part : parts) {
            if (part == null) continue;
            String value = part.toString().trim();
            if (!value.isEmpty()) seen.add(value);
        }
        // 큰 본문이 짧은 본문을 그대로 포함하면 짧은 쪽은 빼서 같은 줄이 두 번 맞지 않게 한다.
        List<String> kept = new ArrayList<>();
        for (String value : seen) {
            boolean contained = false;
            for (String other : seen) if (other.length() > value.length() && other.contains(value)) contained = true;
            if (!contained) kept.add(value);
        }
        return String.join("\n", kept);
    }

    public Result parse(String packageName, List<? extends CharSequence> parts, long postTime) {
        return parse(packageName, joinParts(parts), postTime);
    }

    public Result parse(String packageName, String text, long postTime) {
        Result result = match(rules.forPackage(packageName), text, postTime);
        if (result.ok()) return result;
        return parseSmartFallback(packageName, text, postTime);
    }

    /**
     * 은행 SMS 입금 문자 (설계 4.5). 발신번호가 SMS 규칙의 senders에 있을 때만 읽는다. 결과 Deposit의 packageName은
     * "sms:&lt;규칙 id&gt;"(규칙 패턴이 못 읽어 스마트 폴백으로 읽었으면 "sms:&lt;발신번호&gt;").
     * 은행 번호가 아닌 발신자(고객·개인 문자)는 폴백으로도 읽지 않는다: 고객이 보낸 "홍길동 30,000원 입금했어요"가
     * 입금으로 올라가 자동 확정되거나 개인 문자가 샘플로 남지 않게. 규칙이 제외(출금·취소·예정 등)한 문자도 폴백으로 되살리지 않는다.
     */
    public Result parseSms(String sender, String body, long sentAt) {
        String safeBody = body == null ? "" : body;
        Result result = match(rules.forSender(BankSmsDepositDetector.normalizeSender(sender)), safeBody, sentAt);
        if (result.ok() || result.failure != Failure.NO_MATCH) return result;
        return parseSmartFallback("sms:" + sender, safeBody, sentAt);
    }

    private Result match(List<BankRules.Rule> candidates, String text, long postTime) {
        if (candidates.isEmpty()) return new Result(null, Failure.NO_RULE);
        Failure failure = Failure.NO_MATCH;
        for (BankRules.Rule rule : candidates) {
            if (!containsAll(text, rule.require)) continue;
            if (containsAny(text, rule.exclude)) {
                failure = Failure.EXCLUDED;
                continue;
            }
            for (Pattern pattern : rule.patterns) {
                Matcher matcher = pattern.matcher(text);
                if (!matcher.find()) continue;
                Long amount = number(group(matcher, "amount"));
                if (amount == null || amount <= 0) continue;
                String payer = cleanPayer(group(matcher, "payer"));
                Long balance = number(group(matcher, "balance"));
                String receiver = cleanReceiver(group(matcher, "receiverFrom"));
                return new Result(new Deposit(rule.packageName, rule.bank, amount, payer, balance, receiver, postTime, rule.verified), null);
            }
        }
        return new Result(null, failure);
    }

    /**
     * 규칙 매칭이 실패한 경우에도 한국 주요 은행 입금 알림(토스, 카카오뱅크, 시중은행 등)의
     * "입금", "보냈", 금액 숫자 패턴을 인식해 유연하게 입금을 복원하는 스마트 폴백
     */
    private Result parseSmartFallback(String packageName, String text, long postTime) {
        if (text == null || text.trim().isEmpty()) return new Result(null, Failure.NO_MATCH);

        // 출금, 승인, 취소, 체크카드 등 명확한 지출/취소 알림은 즉시 제외
        java.util.List<String> excludes = java.util.Arrays.asList("출금", "카드승인", "체크카드", "결제완료", "취소완료", "자동이체출금");
        if (containsAny(text, excludes)) {
            return new Result(null, Failure.EXCLUDED);
        }

        // 입금 관련 핵심 키워드 검사 ("입금", "보냈", "송금")
        boolean hasDepositKeyword = text.contains("입금") || text.contains("보냈") || text.contains("송금");
        if (!hasDepositKeyword) {
            return new Result(null, Failure.NO_MATCH);
        }

        // 1. 금액 추출
        Long amount = null;
        // 패턴 A: 10,000원 또는 10000원
        Matcher amountMatcher = Pattern.compile("([0-9][0-9,]*)\\s*원").matcher(text);
        if (amountMatcher.find()) {
            amount = number(amountMatcher.group(1));
        }
        // 패턴 B: 입금 10,000 또는 입금: 10,000
        if (amount == null || amount <= 0) {
            Matcher altAmount = Pattern.compile("입금[\\s:]*([0-9][0-9,]+)").matcher(text);
            if (altAmount.find()) {
                amount = number(altAmount.group(1));
            }
        }

        if (amount == null || amount <= 0) {
            return new Result(null, Failure.NO_MATCH);
        }

        // 2. 은행명 추론
        String bank = "은행";
        BankPresets.Preset preset = BankPresets.find(packageName);
        if (preset != null) {
            bank = preset.name;
        } else if (packageName.contains("kakaobank")) {
            bank = "카카오뱅크";
        } else if (packageName.contains("toss")) {
            bank = "토스";
        } else if (packageName.contains("kb") || packageName.contains("star")) {
            bank = "KB국민은행";
        } else if (packageName.contains("shinhan")) {
            bank = "신한은행";
        } else if (packageName.contains("nh") || packageName.contains("nonghyup")) {
            bank = "NH농협은행";
        } else if (packageName.contains("woori")) {
            bank = "우리은행";
        } else if (packageName.contains("ibk")) {
            bank = "IBK기업은행";
        } else if (packageName.contains("hana")) {
            bank = "하나은행";
        } else if (packageName.contains("kbank")) {
            bank = "케이뱅크";
        }

        // 3. 입금자명 추론
        String payer = UNKNOWN_PAYER;
        // 패턴 A: "홍길동님이 10,000원을 보냈어요" -> 홍길동
        Matcher senderMatcher = Pattern.compile("([^\\n\\s]+)님이\\s+[0-9]").matcher(text);
        if (senderMatcher.find()) {
            payer = cleanPayer(senderMatcher.group(1));
        } else {
            // 패턴 B: "홍길동 -> 내계좌" -> 홍길동
            Matcher arrowMatcher = Pattern.compile("([^→\\-\\n\\s]+?)\\s*(?:→|->)").matcher(text);
            if (arrowMatcher.find()) {
                payer = cleanPayer(arrowMatcher.group(1));
            } else {
                // 패턴 C: "입금 10,000원 홍길동"
                Matcher tailMatcher = Pattern.compile("(?:입금|보냈음|송금)\\s*[0-9,]*원?\\s+([가-힣a-zA-Z0-9_]{2,10})").matcher(text);
                if (tailMatcher.find()) {
                    payer = cleanPayer(tailMatcher.group(1));
                } else {
                    // 패턴 D: "홍길동 10,000원 입금"
                    Matcher headMatcher = Pattern.compile("([가-힣a-zA-Z0-9_]{2,10})\\s+[0-9,]*원?\\s*입금").matcher(text);
                    if (headMatcher.find()) {
                        payer = cleanPayer(headMatcher.group(1));
                    }
                }
            }
        }

        // 잔액 추출 시도
        Long balance = null;
        Matcher balanceMatcher = Pattern.compile("잔액\\s*([0-9][0-9,]*)").matcher(text);
        if (balanceMatcher.find()) {
            balance = number(balanceMatcher.group(1));
        }

        return new Result(new Deposit(packageName, bank, amount, payer, balance, null, postTime, false), null);
    }

    static boolean containsAll(String text, List<String> words) {
        for (String word : words) if (!text.contains(word)) return false;
        return true;
    }

    static boolean containsAny(String text, List<String> words) {
        String sanitized = text.replace("입출금", "");
        for (String word : words) {
            if ("출금".equals(word)) {
                if (sanitized.contains("출금")) return true;
            } else {
                if (text.contains(word)) return true;
            }
        }
        return false;
    }

    /** 패턴에 없는 그룹이면 null. */
    private static String group(Matcher matcher, String name) {
        try {
            return matcher.group(name);
        } catch (IllegalArgumentException missing) {
            return null;
        }
    }

    static Long number(String value) {
        if (value == null) return null;
        String digits = NON_DIGITS.matcher(value).replaceAll("");
        if (digits.isEmpty() || digits.length() > 15) return null;
        return Long.parseLong(digits);
    }

    static String cleanPayer(String value) {
        if (value == null) return UNKNOWN_PAYER;
        String cleaned = SPACES.matcher(value).replaceAll(" ").trim();
        if (cleaned.isEmpty()) return UNKNOWN_PAYER;
        return cleaned.length() > MAX_PAYER_LENGTH ? cleaned.substring(0, MAX_PAYER_LENGTH) : cleaned;
    }

    static String cleanReceiver(String value) {
        if (value == null) return null;
        String cleaned = SPACES.matcher(value).replaceAll(" ").trim();
        if (cleaned.isEmpty()) return null;
        cleaned = maskAccounts(cleaned);
        return cleaned.length() > MAX_RECEIVER_LENGTH ? cleaned.substring(0, MAX_RECEIVER_LENGTH) : cleaned;
    }

    /** 123-456-789012 → ****9012 처럼 계좌번호 모양은 끝 4자리만 남긴다. */
    static String maskAccounts(String value) {
        Matcher matcher = ACCOUNT_LIKE.matcher(value);
        StringBuffer out = new StringBuffer();
        while (matcher.find()) {
            String digits = NON_DIGITS.matcher(matcher.group()).replaceAll("");
            String tail = digits.length() > 4 ? digits.substring(digits.length() - 4) : digits;
            matcher.appendReplacement(out, Matcher.quoteReplacement("****" + tail));
        }
        matcher.appendTail(out);
        return out.toString();
    }
}
