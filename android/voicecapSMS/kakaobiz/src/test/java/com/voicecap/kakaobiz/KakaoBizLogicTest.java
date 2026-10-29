package com.voicecap.kakaobiz;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class KakaoBizLogicTest {
    @Test
    public void partnerCenterIsPickedByLabelOrPackage() {
        assertTrue(AppMatcher.isPartnerCenter("com.kakao.x", "파트너센터"));
        assertTrue(AppMatcher.isPartnerCenter("com.kakao.x", "카카오 비즈니스 파트너센터"));
        assertTrue(AppMatcher.isPartnerCenter("com.kakao.x", "카카오톡 채널 관리자"));
        assertTrue(AppMatcher.isPartnerCenter("com.kakao.partner", "?"));
        assertFalse(AppMatcher.isPartnerCenter("com.kakao.talk", "카카오톡"));
        assertFalse(AppMatcher.isPartnerCenter("com.kbstar.kbbank", "KB스타뱅킹"));
    }

    @Test
    public void jsonRoundTripAndFingerprint() throws Exception {
        CapturedNotification a = new CapturedNotification("k", 1L, "p", "l", "t", "x", "big", "s", "l1\nl2", "m", "a", "meta", "dump");
        CapturedNotification b = CapturedNotification.fromJson(a.toJson());
        assertEquals(a.fingerprint(), b.fingerprint());
        assertEquals("big", b.bigText);
        assertEquals(5, a.longestTextLength());
        CapturedNotification changed = new CapturedNotification("k", 1L, "p", "l", "t", "다른 글", "big", "s", "", "", "", "", "");
        assertFalse(a.fingerprint().equals(changed.fingerprint()));
    }
}
