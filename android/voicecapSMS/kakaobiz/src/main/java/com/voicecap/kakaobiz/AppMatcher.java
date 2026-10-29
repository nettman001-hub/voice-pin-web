package com.voicecap.kakaobiz;

/** 어떤 앱의 알림을 자동으로 고를지. 카카오비즈 파트너센터(옛 이름 카카오톡 채널 관리자)만 자동 선택한다. */
final class AppMatcher {
    private AppMatcher() { }

    static boolean isPartnerCenter(String pkg, String label) {
        String l = label == null ? "" : label.replace(" ", "").toLowerCase();
        String p = pkg == null ? "" : pkg.toLowerCase();
        if (l.contains("파트너센터") || l.contains("채널관리자") || l.contains("카카오비즈") || l.contains("kakaobusiness")) return true;
        return p.startsWith("com.kakao") && (p.contains("biz") || p.contains("partner") || p.contains("plusfriend") || p.contains("channel"));
    }
}
