package com.voicecap.sms;

import java.util.Map;

/**
 * 웹 즉시 발송(FCM) 판단. Android API 없이 JVM 테스트로 확인한다.
 * 푸시는 "보낼 문자 있음" 신호일 뿐이고, 실제 발송 여부는 기존 규칙(동의·기본 문자앱·권한·서버 점유)이 정한다.
 */
public final class PushLogic {
    /** 서버가 아직 FCM 비밀값이 없다고 답했으면 이 간격마다 다시 물어본다. */
    static final long UNCONFIGURED_RECHECK_MILLIS = 6 * 60 * 60 * 1000L;

    public enum Status { ON, WAITING_SERVER, UNAVAILABLE, NOT_READY }

    private PushLogic() { }

    /** 서버 규격(fcm.ts outboxPushMessage): data.type == "OUTBOX"만 처리한다. 알림 표시용 메시지나 다른 형식은 무시. */
    public static boolean isOutboxMessage(Map<String, String> data) {
        return data != null && "OUTBOX".equals(data.get("type"));
    }

    /** 서버에 있어야 할 토큰. 연결이 없거나 전송 동의가 없으면 빈 토큰(등록 삭제). */
    public static String desiredToken(boolean paired, boolean consent, String currentToken) {
        if (!paired || !consent || currentToken == null) return "";
        return currentToken.trim();
    }

    /**
     * register-push를 불러야 하는지. 연결이 안 된 폰은 기기 인증을 못 하므로 부르지 않는다
     * (연결 해제는 해제 직전에 빈 토큰을 따로 보낸다). 토큰이 같아도 서버가 FCM 미설정이라고 답했으면 가끔 다시 묻는다.
     */
    public static boolean needsRegistration(boolean paired, String desired, String registered,
                                            boolean serverConfigured, long lastCheckedAt, long now) {
        if (!paired) return false;
        String want = desired == null ? "" : desired;
        String have = registered == null ? "" : registered;
        if (!want.equals(have)) return true;
        return !want.isEmpty() && !serverConfigured && now - lastCheckedAt >= UNCONFIGURED_RECHECK_MILLIS;
    }

    /** 설정 화면의 "즉시 발송" 한 줄. */
    public static Status status(boolean unavailable, String registered, boolean serverConfigured) {
        if (unavailable) return Status.UNAVAILABLE;
        if (registered == null || registered.isEmpty()) return Status.NOT_READY;
        return serverConfigured ? Status.ON : Status.WAITING_SERVER;
    }

    public static String label(Status status) {
        switch (status) {
            case ON: return "즉시 발송: 켜짐";
            case WAITING_SERVER: return "즉시 발송: 서버 설정 대기 (15분마다 확인)";
            case UNAVAILABLE: return "즉시 발송: 이 폰에서는 사용할 수 없음 (15분마다 확인)";
            default: return "즉시 발송: 휴대폰 연결·전송 동의 후 켜짐";
        }
    }
}
