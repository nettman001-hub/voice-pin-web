package com.voicecap.sms.deposit;

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
    public static final class Rule {
        public final String packageName;
        public final String bank;
        /** 은행 SMS 발신번호 (Phase 6 은행 SMS 입금 문자용, 지금은 읽기만 함). */
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
    public final List<Rule> rules;

    private BankRules(int version, List<Rule> rules) {
        this.version = version;
        this.rules = Collections.unmodifiableList(rules);
    }

    public static BankRules parse(String json) throws Exception {
        JSONObject root = new JSONObject(json);
        int version = root.getInt("version");
        JSONArray array = root.getJSONArray("rules");
        List<Rule> rules = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = array.getJSONObject(index);
            String packageName = item.getString("package").trim();
            String bank = item.getString("bank").trim();
            if (packageName.isEmpty() || bank.isEmpty()) throw new IllegalArgumentException("rule " + index + ": package·bank 필요");
            List<Pattern> patterns = new ArrayList<>();
            for (String source : strings(item.optJSONArray("patterns"))) {
                if (!source.contains("(?<amount>")) throw new IllegalArgumentException("rule " + index + ": amount 그룹 없는 패턴");
                patterns.add(Pattern.compile(source));
            }
            if (patterns.isEmpty()) throw new IllegalArgumentException("rule " + index + ": patterns 필요");
            rules.add(new Rule(packageName, bank, strings(item.optJSONArray("senders")), strings(item.optJSONArray("require")),
                    strings(item.optJSONArray("exclude")), patterns, item.optBoolean("verified", false)));
        }
        return new BankRules(version, rules);
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
