package com.voicecap.deposit;

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

/** 입금 피드 표시 문구 (android API 없음, JVM 테스트 대상). */
public final class DepositLabels {
    private DepositLabels() { }

    /** 서버 대조 결과 → 피드 표시. 서버가 아직 대조하지 않았으면 null (표시 없음). */
    public static String matchLabel(String matchState) {
        if (matchState == null) return null;
        switch (matchState) {
            case "MATCHED": return "자동 확정";
            case "NEEDS_REVIEW": return "확인 필요";
            case "UNMATCHED": return "미확인";
            default: return null;
        }
    }

    /** sync_items 상태 → 업로드 배지 (문자 말풍선 배지와 같은 뜻). 행이 없으면 빈 문자열. */
    public static String syncLabel(String syncState) {
        if (syncState == null) return "";
        switch (syncState) {
            case "PENDING":
            case "SENDING":
                return "🟡 업로드 대기";
            case "SYNCED":
                return "🟢 VoiceCAP 저장 완료";
            case "FAILED":
                return "🔴 업로드 실패 · 눌러서 다시 시도";
            default:
                return "";
        }
    }

    public static String won(long amount) {
        return new DecimalFormat("#,##0", DecimalFormatSymbols.getInstance(Locale.KOREA)).format(amount) + "원";
    }
}
