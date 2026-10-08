package com.voicecap.sms;

import org.junit.Test;

import java.util.Arrays;
import java.util.Calendar;
import java.util.TimeZone;

import static org.junit.Assert.*;

public class SmsPhase2LogicTest {
    private static final TimeZone SEOUL = TimeZone.getTimeZone("Asia/Seoul");

    private static long at(int year, int month, int day, int hour, int minute) {
        Calendar calendar = Calendar.getInstance(SEOUL);
        calendar.clear();
        calendar.set(year, month - 1, day, hour, minute);
        return calendar.getTimeInMillis();
    }

    @Test
    public void sentExternalIdUsesProviderId() {
        assertEquals("device-sms-sent-123", ConversationLogic.sentExternalId("123"));
    }

    @Test
    public void migratesPhase0SendPrefix() {
        assertEquals("device-sms-sent-42", ConversationLogic.migrateLegacyExternalId("device-send-42"));
        assertEquals("device-sms-7", ConversationLogic.migrateLegacyExternalId("device-sms-7"));
        assertEquals("web-out-abc", ConversationLogic.migrateLegacyExternalId("web-out-abc"));
        assertNull(ConversationLogic.migrateLegacyExternalId(null));
    }

    @Test
    public void uploadsOnlyBusinessSendsFromThePhone() {
        assertTrue(ConversationLogic.shouldUploadOutgoing(LocalDb.ORIGIN_DEVICE, true, false));
        // 개인 문자는 올리지 않는다 (배지 없음).
        assertFalse(ConversationLogic.shouldUploadOutgoing(LocalDb.ORIGIN_DEVICE, false, false));
        assertFalse(ConversationLogic.shouldUploadOutgoing(LocalDb.ORIGIN_DEVICE, true, true));
        // 웹 발송분은 outbox-status로 이미 서버에 있으므로 업무 번호여도 절대 다시 올리지 않는다.
        assertFalse(ConversationLogic.shouldUploadOutgoing(LocalDb.ORIGIN_WEB, true, false));
    }

    @Test
    public void unsupportedOutgoingIsRetryLaterNotFailure() {
        assertEquals(BridgeClient.ReportResult.UNSUPPORTED, ConversationLogic.classifyOutgoing(false, 400, "지원하지 않는 요청입니다."));
        assertEquals(BridgeClient.ReportResult.REJECTED, ConversationLogic.classifyOutgoing(false, 400, "externalId, phoneNumber, body가 필요합니다."));
        assertEquals(BridgeClient.ReportResult.REPORTED, ConversationLogic.classifyOutgoing(true, 201, null));
        assertEquals(BridgeClient.ReportResult.REPORTED, ConversationLogic.classifyOutgoing(true, 200, null));
        assertEquals(BridgeClient.ReportResult.RETRY, ConversationLogic.classifyOutgoing(false, 503, null));
        assertEquals(BridgeClient.ReportResult.REJECTED, ConversationLogic.classifyOutgoing(false, 401, "unauthorized"));
    }

    @Test
    public void badgesFollowSyncState() {
        assertEquals(ConversationLogic.Badge.PENDING, ConversationLogic.badge(LocalDb.STATE_PENDING));
        assertEquals(ConversationLogic.Badge.PENDING, ConversationLogic.badge(LocalDb.STATE_SENDING));
        assertEquals(ConversationLogic.Badge.SYNCED, ConversationLogic.badge(LocalDb.STATE_SYNCED));
        assertEquals(ConversationLogic.Badge.FAILED, ConversationLogic.badge(LocalDb.STATE_FAILED));
        assertEquals(ConversationLogic.Badge.NONE, ConversationLogic.badge(LocalDb.STATE_SKIPPED));
        assertEquals(ConversationLogic.Badge.NONE, ConversationLogic.badge(null));
        assertEquals("🟢 VoiceCAP 저장 완료", ConversationLogic.badgeLabel(ConversationLogic.Badge.SYNCED));
        assertEquals("", ConversationLogic.badgeLabel(ConversationLogic.Badge.NONE));
    }

    @Test
    public void parsesAndDedupesRecipients() {
        assertEquals(Arrays.asList("010-1234-5678", "01099998888"),
                ConversationLogic.parseRecipients("010-1234-5678, 01099998888; +82 10 1234 5678\n홍길동"));
        assertTrue(ConversationLogic.parseRecipients(null).isEmpty());
        assertTrue(ConversationLogic.parseRecipients(" , ;").isEmpty());
    }

    @Test
    public void searchMatchesNameBodyAndDigits() {
        assertTrue(ConversationLogic.matchesSearch("", null, null, null));
        assertTrue(ConversationLogic.matchesSearch("성훈", "성훈맘", "01012345678", ""));
        assertTrue(ConversationLogic.matchesSearch("입금", null, "01012345678", "입금했어요"));
        assertTrue(ConversationLogic.matchesSearch("1234-5678", null, "01012345678", ""));
        assertTrue(ConversationLogic.matchesSearch("010 1234", null, "+82 10-1234-5678", ""));
        assertFalse(ConversationLogic.matchesSearch("9999", "성훈맘", "01012345678", "안녕하세요"));
    }

    @Test
    public void picksRememberedThenDefaultThenFirstSim() {
        assertEquals(-1, ConversationLogic.pickSubscription(new int[0], 2, 1));
        assertEquals(2, ConversationLogic.pickSubscription(new int[]{1, 2}, 2, 1));
        assertEquals(1, ConversationLogic.pickSubscription(new int[]{1, 2}, 9, 1));
        assertEquals(3, ConversationLogic.pickSubscription(new int[]{3, 4}, -1, -1));
    }

    @Test
    public void formatsDividerAndTimes() {
        long morning = at(2026, 10, 8, 9, 5);
        long evening = at(2026, 10, 8, 21, 30);
        long nextDay = at(2026, 10, 9, 0, 1);
        assertTrue(ConversationLogic.sameDay(morning, evening, SEOUL));
        assertFalse(ConversationLogic.sameDay(evening, nextDay, SEOUL));
        assertEquals("2026년 10월 8일 목요일", ConversationLogic.dayLabel(morning, SEOUL));
        assertEquals("오전 9:05", ConversationLogic.timeLabel(morning, SEOUL));
        assertEquals("오후 9:30", ConversationLogic.timeLabel(evening, SEOUL));
        assertEquals("오후 12:00", ConversationLogic.timeLabel(at(2026, 10, 8, 12, 0), SEOUL));
        assertEquals("오전 12:01", ConversationLogic.timeLabel(nextDay, SEOUL));
        assertEquals("오후 9:30", ConversationLogic.listTimeLabel(evening, evening + 1000, SEOUL));
        assertEquals("10월 8일", ConversationLogic.listTimeLabel(morning, nextDay, SEOUL));
        assertEquals("2025. 12. 31.", ConversationLogic.listTimeLabel(at(2025, 12, 31, 10, 0), nextDay, SEOUL));
        assertEquals("", ConversationLogic.listTimeLabel(0, nextDay, SEOUL));
    }
}
