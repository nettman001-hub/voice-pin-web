package com.voicecap.sms.deposit;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 샘플 내보내기용 가리기. 숫자는 모두 #으로, 낱말은 은행·입출금 용어만 남기고 ○로 바꾼다.
 * 이름을 정확히 알아낼 방법이 없으므로 모르는 낱말은 모두 가린다 (덜 가리는 것보다 더 가리는 쪽).
 * 규칙을 만들 때 필요한 것은 줄 구성·구분자·용어 위치이므로 이것만 남아도 된다.
 */
public final class SampleMasker {
    private static final Pattern WORD = Pattern.compile("[가-힣A-Za-z]+");
    private static final Pattern DIGIT = Pattern.compile("[0-9]");

    /** 그대로 남기는 낱말 (정확히 같을 때만). */
    private static final Set<String> KEEP = new HashSet<>(Arrays.asList(
            "Web", "발신", "KB", "국민", "국민은행", "KB국민", "KB국민은행", "신한", "신한은행", "SOL", "우리", "우리은행", "WON",
            "NH", "농협", "농협은행", "NH농협", "카카오뱅크", "카카오", "토스", "토스뱅크", "기업", "기업은행", "IBK", "IBK기업",
            "케이뱅크", "하나", "하나은행", "SC", "제일", "씨티", "새마을", "새마을금고", "우체국", "신협", "수협", "대구", "부산", "경남", "광주", "전북", "제주",
            "원", "님", "내", "에서", "으로", "로", "에게", "께", "이", "가", "을", "를", "의", "은", "는",
            "년", "월", "일", "시", "분", "초", "오전", "오후", "건", "총", "계좌", "통장", "카드", "체크", "알림", "안내", "거래", "받는", "보낸", "받은", "보내는",
            "명", "통", "나", "에", "와", "과", "누적", "합계", "금액", "입금자", "보낸분", "받는분", "메모", "적요"));

    /** 이 말로 시작하는 낱말은 남긴다 (입금되었습니다, 출금액 등). 이름이 이렇게 시작하는 경우는 드물다. */
    private static final List<String> STEMS = Arrays.asList(
            "입금", "출금", "입출금", "이체", "송금", "결제", "승인", "취소", "잔액", "예정", "자동", "환불", "충전", "이자", "수수료", "대출", "급여");

    private SampleMasker() { }

    /** @param knownPayer 규칙이 뽑은 입금자명. 있으면 먼저 그 글자를 통째로 가린다. */
    public static String mask(String raw, String knownPayer) {
        if (raw == null) return "";
        String text = raw;
        if (knownPayer != null && !knownPayer.isEmpty() && !DepositParser.UNKNOWN_PAYER.equals(knownPayer)) {
            text = text.replace(knownPayer, repeat('○', knownPayer.length()));
        }
        text = DIGIT.matcher(text).replaceAll("#");
        Matcher matcher = WORD.matcher(text);
        StringBuffer out = new StringBuffer();
        while (matcher.find()) {
            String word = matcher.group();
            matcher.appendReplacement(out, Matcher.quoteReplacement(keep(word) ? word : repeat('○', word.length())));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    static boolean keep(String word) {
        if (KEEP.contains(word)) return true;
        for (String stem : STEMS) if (word.startsWith(stem)) return true;
        return false;
    }

    private static String repeat(char value, int count) {
        char[] chars = new char[count];
        Arrays.fill(chars, value);
        return new String(chars);
    }
}
