package com.voicecap.deposit;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * assets/bank_rules.json을 읽은 은행별 규칙 묶음 (android API 없음, JVM 테스트 대상).
 * 제외 키워드는 은행 규칙의 exclude 안에만 있다. 전역 제외 목록과 범용 폴백 규칙은 일부러 두지 않는다.
 */
public final class BankRules {
    /** 은행 SMS 규칙의 packageName 자리 값: "sms:" + 규칙 id. 입금 피드·90초 창에서 은행 앱 알림과 구분한다. */
    public static final String SMS_KEY_PREFIX = "sms:";

    public static final class Rule {
        /** 알림 규칙은 은행 앱 패키지, SMS 규칙은 {@link #SMS_KEY_PREFIX} + id. */
        public final String packageName;
        public final String bank;
        /** 은행 SMS 발신번호 (숫자만). SMS 규칙에만 있다. */
        public final List<String> senders;
        /** 모두 들어 있어야 하는 낱말. */
        public final List<String> require;
        /** 하나라도 들어 있으면 버리는 낱말 (출금·결제·예정·광고 등). */
        public final List<String> exclude;
        /** named group: amount(필수), payer, balance, receiverFrom. 처음 맞는 패턴을 쓴다. */
        public final List<Pattern> patterns;
        public final boolean verified;

        Rule(String packageName, String bank, List<String> senders, List<String> require, List<String> exclude,
             List<Pattern> patterns, boolean verified) {
            this.packageName = packageName;
            this.bank = bank;
            this.senders = senders;
            this.require = require;
            this.exclude = exclude;
            this.patterns = patterns;
            this.verified = verified;
        }
    }

    public final int version;
    /** 은행 앱 알림 규칙 (package로 고름). */
    public final List<Rule> rules;
    /** 은행 SMS 입금 문자 규칙 (senders 발신번호로 고름). 알림과 글 모양이 달라 따로 둔다. */
    public final List<Rule> smsRules;

    private BankRules(int version, List<Rule> rules, List<Rule> smsRules) {
        this.version = version;
        this.rules = Collections.unmodifiableList(rules);
        this.smsRules = Collections.unmodifiableList(smsRules);
    }

    public static BankRules parse(String json) throws Exception {
        JSONObject root = new JSONObject(json);
        int version = root.getInt("version");
        JSONArray array = root.getJSONArray("rules");
        List<Rule> rules = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = array.getJSONObject(index);
            String packageName = item.getString("package").trim();
            if (packageName.isEmpty()) throw new IllegalArgumentException("rule " + index + ": package 필요");
            rules.add(rule(item, "rule " + index, packageName, new ArrayList<>()));
        }
        List<Rule> smsRules = new ArrayList<>();
        JSONArray smsArray = root.optJSONArray("smsRules");
        for (int index = 0; smsArray != null && index < smsArray.length(); index++) {
            JSONObject item = smsArray.getJSONObject(index);
            String id = item.getString("id").trim();
            List<String> senders = new ArrayList<>();
            for (String sender : strings(item.optJSONArray("senders"))) {
                String digits = BankSmsDepositDetector.normalizeSender(sender);
                if (!digits.isEmpty()) senders.add(digits);
            }
            if (id.isEmpty() || senders.isEmpty()) throw new IllegalArgumentException("smsRule " + index + ": id·senders 필요");
            smsRules.add(rule(item, "smsRule " + index, SMS_KEY_PREFIX + id, senders));
        }
        return new BankRules(version, rules, smsRules);
    }

    private static Rule rule(JSONObject item, String label, String key, List<String> senders) throws Exception {
        String bank = item.getString("bank").trim();
        if (bank.isEmpty()) throw new IllegalArgumentException(label + ": bank 필요");
        List<Pattern> patterns = new ArrayList<>();
        for (String source : strings(item.optJSONArray("patterns"))) {
            if (!source.contains("(?<amount>")) throw new IllegalArgumentException(label + ": amount 그룹 없는 패턴");
            patterns.add(Pattern.compile(source));
        }
        if (patterns.isEmpty()) throw new IllegalArgumentException(label + ": patterns 필요");
        return new Rule(key, bank, senders, strings(item.optJSONArray("require")),
                strings(item.optJSONArray("exclude")), patterns, item.optBoolean("verified", false));
    }

    /** 이 발신번호({@link BankSmsDepositDetector#normalizeSender}로 숫자만 남긴 값)에 해당하는 SMS 규칙들 (파일 순서). */
    public List<Rule> forSender(String normalizedSender) {
        List<Rule> result = new ArrayList<>();
        if (normalizedSender == null || normalizedSender.isEmpty()) return result;
        for (Rule rule : smsRules) if (rule.senders.contains(normalizedSender)) result.add(rule);
        return result;
    }

    /** 이 패키지에 해당하는 규칙들 (파일 순서). */
    public List<Rule> forPackage(String packageName) {
        List<Rule> result = new ArrayList<>();
        for (Rule rule : rules) if (rule.packageName.equals(packageName)) result.add(rule);
        return result;
    }

    public boolean hasRuleFor(String packageName) {
        for (Rule rule : rules) if (rule.packageName.equals(packageName)) return true;
        return false;
    }

    private static List<String> strings(JSONArray array) {
        List<String> result = new ArrayList<>();
        if (array == null) return result;
        for (int index = 0; index < array.length(); index++) {
            String value = array.optString(index, "").trim();
            if (!value.isEmpty()) result.add(value);
        }
        return result;
    }
}
