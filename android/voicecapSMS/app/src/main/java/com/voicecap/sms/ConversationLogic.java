package com.voicecap.sms;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/** 대화 화면과 폰 발신 업로드가 같이 쓰는 순수 로직 (android API 없음, JVM 테스트 대상). */
final class ConversationLogic {
    /** 폰에서 직접 보낸 문자의 서버 externalId 접두어. 뒤에 문자함(content://sms) id가 붙는다. */
    static final String SENT_PREFIX = "device-sms-sent-";
    static final String MMS_SENT_PREFIX = "device-mms-sent-";
    /** Phase 0이 쓰던 접두어. LocalDb 업그레이드 때 {@link #SENT_PREFIX}로 바꾼다. */
    static final String LEGACY_SENT_PREFIX = "device-send-";
    /** PR #9 배포 전 서버가 outgoing 액션에 돌려주는 400 오류 문구. */
    static final String UNSUPPORTED_ACTION_ERROR = "지원하지 않는 요청입니다.";
    /** 여러 명에게 보낼 때 수신자 사이 간격. */
    static final long MULTI_SEND_GAP_MILLIS = 1000L;

    enum Badge { NONE, PENDING, SYNCED, FAILED }

    private ConversationLogic() { }

    /** MMS snippets can contain byte values stored as Latin-1; SMS snippets are already Unicode (charset 0). */
    static String decodeSnippet(String raw, int charset) {
        if (raw == null) return "";
        if (raw.isEmpty() || charset == 0) return raw;
        // Never replace real Korean, emoji or other Unicode characters with '?' while recovering bytes.
        for (int i = 0; i < raw.length(); i++) {
            if (raw.charAt(i) > 0xFF) return raw;
        }
        try {
            return MmsPdu.charsetFor(charset).newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(raw.getBytes(StandardCharsets.ISO_8859_1))).toString();
        } catch (CharacterCodingException ignored) {
            // Providers may truncate a preview in the middle of a multibyte character.
            return raw;
        }
    }

    static String sentExternalId(String providerId) { return SENT_PREFIX + providerId; }

    /** 폰에서 보낸 MMS: device-mms-sent-&lt;문자함 id&gt;. */
    static String mmsSentExternalId(String providerId) { return MMS_SENT_PREFIX + providerId; }

    /** device-send-123 → device-sms-sent-123. 다른 id는 그대로. */
    static String migrateLegacyExternalId(String externalId) {
        if (externalId == null || !externalId.startsWith(LEGACY_SENT_PREFIX)) return externalId;
        return SENT_PREFIX + externalId.substring(LEGACY_SENT_PREFIX.length());
    }

    /**
     * 폰에서 보낸 문자를 서버에 올릴지. 웹 발송분(origin=WEB)은 outbox-status로 이미 서버에 있으므로 절대 올리지 않고
     * (같은 문자 2건 방지), 010 번호이거나 업무 고객 번호(구매정보 문자를 보낸 번호·등록 번호)에게 보낸 문자만 올린다.
     */
    static boolean shouldUploadOutgoing(String origin, String phone, boolean businessNumber, boolean blocked) {
        if (LocalDb.ORIGIN_WEB.equals(origin)) return false;
        if (blocked) return false;
        if (UploadFilter.is010Number(phone)) return true;
        return businessNumber;
    }

    static boolean shouldUploadOutgoing(String origin, boolean businessNumber, boolean blocked) {
        return shouldUploadOutgoing(origin, null, businessNumber, blocked);
    }

    /**
     * outgoing 응답 분류. PR #9가 배포되기 전 서버는 400 "지원하지 않는 요청입니다."를 돌려주는데,
     * 이것은 거절이 아니라 "나중에 다시"로 본다 (PENDING 유지, 백오프).
     */
    static BridgeClient.ReportResult classifyOutgoing(boolean ok, int httpCode, String error) {
        if (ok) return BridgeClient.ReportResult.REPORTED;
        if (httpCode == 400 && error != null && error.contains(UNSUPPORTED_ACTION_ERROR)) return BridgeClient.ReportResult.UNSUPPORTED;
        if (httpCode == 409) return BridgeClient.ReportResult.CONFLICT;
        return httpCode >= 400 && httpCode < 500 ? BridgeClient.ReportResult.REJECTED : BridgeClient.ReportResult.RETRY;
    }

    /** sync_items 상태 → 말풍선 배지. SKIPPED(개인 문자)와 행 없음은 배지 없음. */
    static Badge badge(String state) {
        if (state == null) return Badge.NONE;
        switch (state) {
            case LocalDb.STATE_PENDING:
            case LocalDb.STATE_SENDING:
                return Badge.PENDING;
            case LocalDb.STATE_SYNCED:
                return Badge.SYNCED;
            case LocalDb.STATE_FAILED:
                return Badge.FAILED;
            default:
                return Badge.NONE;
        }
    }

    static String badgeLabel(Badge badge) {
        switch (badge) {
            case PENDING: return "🟡 VoiceCAP 업로드 대기";
            case SYNCED: return "🟢 VoiceCAP 저장 완료";
            case FAILED: return "🔴 업로드 실패 · 눌러서 다시 시도";
            default: return "";
        }
    }

    /** 쉼표·세미콜론·줄바꿈으로 나눈 번호 목록. 숫자가 없는 칸은 버리고, 같은 번호(정규화 기준)는 한 번만. */
    static List<String> parseRecipients(String raw) {
        Map<String, String> unique = new LinkedHashMap<>();
        if (raw == null) return new ArrayList<>();
        for (String piece : raw.split("[,;\\n]")) {
            String value = piece.trim();
            String normalized = BusinessContactStore.normalize(value);
            if (normalized.isEmpty()) continue;
            if (!unique.containsKey(normalized)) unique.put(normalized, value);
        }
        return new ArrayList<>(unique.values());
    }

    /** 검색: 이름·본문은 부분 일치(대소문자 무시), 번호는 숫자만 비교 (010-1234 ↔ 0101234). */
    static boolean matchesSearch(String query, String name, String address, String body) {
        if (query == null || query.trim().isEmpty()) return true;
        String needle = query.trim().toLowerCase(Locale.ROOT);
        if (contains(name, needle) || contains(address, needle) || contains(body, needle)) return true;
        String digits = needle.replaceAll("[^0-9]", "");
        if (digits.length() < 2 || address == null) return false;
        return BusinessContactStore.normalize(address).contains(BusinessContactStore.normalize(digits))
                || address.replaceAll("[^0-9]", "").contains(digits);
    }

    private static boolean contains(String value, String needle) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(needle);
    }

    /**
     * 듀얼 SIM에서 보낼 SIM. 마지막으로 고른 SIM이 아직 켜져 있으면 그것, 아니면 시스템 기본 SMS SIM,
     * 그것도 없으면 첫 번째 SIM. SIM이 없으면 -1(시스템에 맡김).
     */
    static int pickSubscription(int[] activeSubIds, int remembered, int systemDefault) {
        if (activeSubIds == null || activeSubIds.length == 0) return -1;
        for (int id : activeSubIds) if (id == remembered) return id;
        for (int id : activeSubIds) if (id == systemDefault) return id;
        return activeSubIds[0];
    }

    static boolean sameDay(long a, long b, TimeZone zone) {
        Calendar first = Calendar.getInstance(zone);
        first.setTimeInMillis(a);
        Calendar second = Calendar.getInstance(zone);
        second.setTimeInMillis(b);
        return first.get(Calendar.YEAR) == second.get(Calendar.YEAR)
                && first.get(Calendar.DAY_OF_YEAR) == second.get(Calendar.DAY_OF_YEAR);
    }

    /** 날짜 구분선: "2026년 10월 8일 목요일". */
    static String dayLabel(long millis, TimeZone zone) {
        Calendar calendar = Calendar.getInstance(zone);
        calendar.setTimeInMillis(millis);
        String[] days = {"일", "월", "화", "수", "목", "금", "토"};
        return calendar.get(Calendar.YEAR) + "년 " + (calendar.get(Calendar.MONTH) + 1) + "월 "
                + calendar.get(Calendar.DAY_OF_MONTH) + "일 " + days[calendar.get(Calendar.DAY_OF_WEEK) - 1] + "요일";
    }

    /** 말풍선 시각: "오후 3:05". */
    static String timeLabel(long millis, TimeZone zone) {
        Calendar calendar = Calendar.getInstance(zone);
        calendar.setTimeInMillis(millis);
        int hour = calendar.get(Calendar.HOUR_OF_DAY);
        int display = hour % 12 == 0 ? 12 : hour % 12;
        return (hour < 12 ? "오전 " : "오후 ") + display + ":" + String.format(Locale.ROOT, "%02d", calendar.get(Calendar.MINUTE));
    }

    /** 대화 목록 시각: 오늘이면 시각, 올해면 "10월 8일", 그 전이면 "2025. 10. 8.". */
    static String listTimeLabel(long millis, long now, TimeZone zone) {
        if (millis <= 0) return "";
        if (sameDay(millis, now, zone)) return timeLabel(millis, zone);
        Calendar calendar = Calendar.getInstance(zone);
        calendar.setTimeInMillis(millis);
        Calendar today = Calendar.getInstance(zone);
        today.setTimeInMillis(now);
        int month = calendar.get(Calendar.MONTH) + 1;
        int day = calendar.get(Calendar.DAY_OF_MONTH);
        if (calendar.get(Calendar.YEAR) == today.get(Calendar.YEAR)) return month + "월 " + day + "일";
        return calendar.get(Calendar.YEAR) + ". " + month + ". " + day + ".";
    }
}
