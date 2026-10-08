package com.voicecap.sms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

public class PushLogicTest {
    private static final long NOW = 1_800_000_000_000L;

    @Test public void onlyOutboxMessagesAreHandled() {
        assertTrue(PushLogic.isOutboxMessage(Collections.singletonMap("type", "OUTBOX")));
        Map<String, String> extra = new HashMap<>();
        extra.put("type", "OUTBOX");
        extra.put("other", "x");
        assertTrue(PushLogic.isOutboxMessage(extra));
        assertFalse(PushLogic.isOutboxMessage(Collections.singletonMap("type", "outbox")));
        assertFalse(PushLogic.isOutboxMessage(Collections.singletonMap("type", "PAYMENT")));
        assertFalse(PushLogic.isOutboxMessage(Collections.singletonMap("kind", "OUTBOX")));
        assertFalse(PushLogic.isOutboxMessage(Collections.emptyMap()));
        assertFalse(PushLogic.isOutboxMessage(null));
    }

    @Test public void desiredTokenIsEmptyWithoutPairingOrConsent() {
        assertEquals("tok", PushLogic.desiredToken(true, true, " tok "));
        assertEquals("", PushLogic.desiredToken(false, true, "tok"));
        assertEquals("", PushLogic.desiredToken(true, false, "tok"));
        assertEquals("", PushLogic.desiredToken(true, true, null));
    }

    @Test public void registersWhenTokenChanges() {
        assertTrue(PushLogic.needsRegistration(true, "new", "", true, NOW, NOW));
        assertTrue(PushLogic.needsRegistration(true, "new", "old", true, NOW, NOW));
        assertFalse(PushLogic.needsRegistration(true, "same", "same", true, 0, NOW));
    }

    @Test public void consentWithdrawalSendsEmptyToken() {
        String desired = PushLogic.desiredToken(true, false, "tok");
        assertEquals("", desired);
        assertTrue(PushLogic.needsRegistration(true, desired, "tok", true, NOW, NOW));
        // 등록한 적이 없으면 지울 것도 없다.
        assertFalse(PushLogic.needsRegistration(true, "", "", false, 0, NOW));
    }

    @Test public void unpairedPhoneNeverCallsServer() {
        assertFalse(PushLogic.needsRegistration(false, "", "tok", true, 0, NOW));
        assertFalse(PushLogic.needsRegistration(false, "tok", "", true, 0, NOW));
    }

    @Test public void serverNotConfiguredIsRecheckedOccasionally() {
        assertFalse(PushLogic.needsRegistration(true, "tok", "tok", false, NOW - 60_000, NOW));
        assertTrue(PushLogic.needsRegistration(true, "tok", "tok", false, NOW - PushLogic.UNCONFIGURED_RECHECK_MILLIS, NOW));
    }

    @Test public void noGoogleServicesMeansNoRegistrationAndUnavailableStatus() {
        // getToken 실패: 현재 토큰이 비어 있으므로 등록할 것이 없다.
        String desired = PushLogic.desiredToken(true, true, "");
        assertFalse(PushLogic.needsRegistration(true, desired, "", false, 0, NOW));
        assertEquals(PushLogic.Status.UNAVAILABLE, PushLogic.status(true, "", false));
    }

    @Test public void statusLine() {
        assertEquals(PushLogic.Status.ON, PushLogic.status(false, "tok", true));
        assertEquals(PushLogic.Status.WAITING_SERVER, PushLogic.status(false, "tok", false));
        assertEquals(PushLogic.Status.NOT_READY, PushLogic.status(false, "", true));
        assertTrue(PushLogic.label(PushLogic.Status.ON).contains("켜짐"));
        assertTrue(PushLogic.label(PushLogic.Status.WAITING_SERVER).contains("서버 설정 대기"));
        assertTrue(PushLogic.label(PushLogic.Status.UNAVAILABLE).contains("이 폰에서는 사용할 수 없음"));
    }
}
