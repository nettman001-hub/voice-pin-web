package com.voicecap.deposit;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.*;

public class DepositUploadTest {
    @Test
    public void readsMatchStatusFromNewPayment() throws Exception {
        JSONObject response = new JSONObject("{\"ok\":true,\"duplicate\":false,\"payment\":{\"source\":\"NOTIFICATION\",\"match_status\":\"UNMATCHED\"},"
                + "\"match\":{\"status\":\"NEEDS_REVIEW\",\"candidateIds\":[\"inv-1\"]}}");
        assertEquals("NEEDS_REVIEW", DeviceLink.matchStatus(response));
    }

    @Test
    public void duplicateUsesStoredStatusOnlyFromTheNewServer() throws Exception {
        JSONObject newServer = new JSONObject("{\"ok\":true,\"duplicate\":true,\"payment\":{\"source\":\"NOTIFICATION\",\"match_status\":\"MATCHED\"}}");
        assertEquals("MATCHED", DeviceLink.matchStatus(newServer));
        // PR #9 배포 전 서버는 대조 없이 UNMATCHED만 저장하므로 결과로 보지 않는다.
        JSONObject oldServer = new JSONObject("{\"ok\":true,\"duplicate\":true,\"payment\":{\"match_status\":\"UNMATCHED\"}}");
        assertNull(DeviceLink.matchStatus(oldServer));
        JSONObject oldServerNew = new JSONObject("{\"ok\":true,\"duplicate\":false,\"payment\":{\"match_status\":\"UNMATCHED\"}}");
        assertNull(DeviceLink.matchStatus(oldServerNew));
    }

    @Test
    public void matchLabelsFollowTheDesign() {
        assertEquals("자동 확정", DepositLabels.matchLabel("MATCHED"));
        assertEquals("확인 필요", DepositLabels.matchLabel("NEEDS_REVIEW"));
        assertEquals("미확인", DepositLabels.matchLabel("UNMATCHED"));
        assertNull(DepositLabels.matchLabel(null));
        assertNull(DepositLabels.matchLabel("SOMETHING"));
    }

    @Test
    public void syncLabelsMatchMessageBadges() {
        assertTrue(DepositLabels.syncLabel(DepositDb.STATE_PENDING).startsWith("🟡"));
        assertTrue(DepositLabels.syncLabel(DepositDb.STATE_SYNCED).startsWith("🟢"));
        assertTrue(DepositLabels.syncLabel(DepositDb.STATE_FAILED).startsWith("🔴"));
        assertEquals("", DepositLabels.syncLabel(null));
        assertEquals("1,234,567원", DepositLabels.won(1234567));
    }
}
