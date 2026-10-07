package com.voicecap.sms;

import java.util.Locale;

/** 서버로 올려도 되는 문자인지 판정한다. 구매정보 문자 또는 등록된 업무 고객 번호만 허용 (Play 선언과 동일). */
public final class UploadFilter {
    private UploadFilter() { }

    public static boolean shouldUpload(String body, boolean businessNumber, boolean blocked) {
        if (blocked) return false;
        return businessNumber || isPurchaseMessage(body);
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
