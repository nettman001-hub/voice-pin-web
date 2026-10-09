package com.voicecap.sms;

import java.util.Locale;

/**
 * 서버로 올려도 되는 문자인지 판정한다.
 * - 발신번호 앞자리가 010으로 시작하는 문자 전체 허용
 * - 구매정보 문자 또는 등록된 업무 고객 번호 허용
 * - 차단 번호는 거절
 */
public final class UploadFilter {
    private UploadFilter() { }

    /** 전화번호 앞자리가 010으로 시작하는지 판정한다 (국가번호 +82, 하이픈 등 정규화 반영). */
    public static boolean is010Number(String phone) {
        if (phone == null) return false;
        String normalized = BusinessContactStore.normalize(phone);
        return normalized.startsWith("010");
    }

    public static boolean shouldUpload(String phone, String body, boolean businessNumber, boolean blocked) {
        if (blocked) return false;
        if (is010Number(phone)) return true;
        return businessNumber || isPurchaseMessage(body);
    }

    public static boolean shouldUpload(String body, boolean businessNumber, boolean blocked) {
        return shouldUpload(null, body, businessNumber, blocked);
    }

    public static boolean isPurchaseMessage(String body) {
        if (body == null) return false;
        String compact = body.replace(" ", "").toLowerCase(Locale.ROOT);
        boolean hasNickname = compact.contains("닉네임") || compact.contains("구매자") || compact.contains("buyer");
        boolean hasAddress = compact.contains("주소") || compact.contains("배송지") || compact.contains("address");
        boolean hasOrder = compact.contains("상품") || compact.contains("제품") || compact.contains("가격") || compact.contains("금액") || compact.contains("price");
        return hasNickname && hasAddress && hasOrder;
    }
}
