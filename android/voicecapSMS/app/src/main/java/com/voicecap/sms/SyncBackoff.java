package com.voicecap.sms;

/** 서버 보고 재시도 간격: 1분 → 2분 → 5분 → 15분(상한). */
public final class SyncBackoff {
    private static final long MINUTE = 60_000L;

    private SyncBackoff() { }

    public static long delayMillis(int attempts) {
        if (attempts <= 1) return MINUTE;
        if (attempts == 2) return 2 * MINUTE;
        if (attempts == 3) return 5 * MINUTE;
        return 15 * MINUTE;
    }
}
