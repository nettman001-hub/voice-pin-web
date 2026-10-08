package com.voicecap.sms;

import android.content.Context;
import android.content.SharedPreferences;

import com.google.android.gms.tasks.Tasks;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.concurrent.TimeUnit;

/**
 * FCM 토큰을 받아 device-pair register-push로 서버에 등록한다. 모든 호출은 백그라운드 스레드에서.
 * 구글 서비스가 없는 폰(토큰 발급 실패)이나 서버 미설정은 오류가 아니라 기존 15분 주기 동기화만 쓰는 상태다.
 */
public final class PushRegistration {
    private static final String NAME = "voicecap_push";
    private static final String CURRENT = "fcm_current";
    private static final String REGISTERED = "fcm_registered";
    private static final String SERVER_CONFIGURED = "server_configured";
    private static final String CHECKED_AT = "checked_at";
    private static final String UNAVAILABLE = "unavailable";
    private static final String ATTEMPTS = "attempts";
    private static final String NEXT_AT = "next_at";

    private PushRegistration() { }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    /** FirebaseMessagingService.onNewToken. */
    public static void onNewToken(Context context, String token) {
        prefs(context).edit().putString(CURRENT, token == null ? "" : token).putBoolean(UNAVAILABLE, false).putInt(ATTEMPTS, 0).putLong(NEXT_AT, 0).apply();
    }

    /** 현재 토큰을 Firebase에서 받아 저장한다. 실패하면 이 폰에서는 즉시 발송을 쓸 수 없다고 기록한다. */
    public static void refreshToken(Context context) {
        try {
            String token = Tasks.await(FirebaseMessaging.getInstance().getToken(), 10, TimeUnit.SECONDS);
            if (token == null || token.isEmpty()) throw new IllegalStateException("empty");
            if (!token.equals(prefs(context).getString(CURRENT, ""))) onNewToken(context, token);
            else prefs(context).edit().putBoolean(UNAVAILABLE, false).apply();
        } catch (Exception error) {
            prefs(context).edit().putBoolean(UNAVAILABLE, true).apply();
        }
    }

    /** 토큰 발급 후 서버 등록까지. 기기 연결 직후·앱 시작 때. */
    public static void refreshAndRegister(Context context) {
        refreshToken(context);
        ensureRegistered(context, true);
    }

    /**
     * 서버에 있어야 할 토큰과 등록한 토큰이 다르면 register-push를 부른다. 네트워크·서버 오류는 기존 백오프로 다시 시도.
     * @param force true면 백오프 대기 중이어도 바로 시도한다.
     */
    public static synchronized void ensureRegistered(Context context, boolean force) {
        SharedPreferences prefs = prefs(context);
        // 부팅 직후처럼 구글 서비스가 아직 준비되지 않아 토큰을 못 받았으면 동기화 때 다시 받아 본다.
        if (prefs.getBoolean(UNAVAILABLE, false) || prefs.getString(CURRENT, "").isEmpty()) refreshToken(context);
        boolean paired = BridgePreferences.configured(context);
        String desired = PushLogic.desiredToken(paired, BridgePreferences.hasDataTransferConsent(context), prefs.getString(CURRENT, ""));
        long now = System.currentTimeMillis();
        if (!PushLogic.needsRegistration(paired, desired, prefs.getString(REGISTERED, ""),
                prefs.getBoolean(SERVER_CONFIGURED, false), prefs.getLong(CHECKED_AT, 0), now)) return;
        long nextAt = prefs.getLong(NEXT_AT, 0);
        if (!force && nextAt > now) {
            SyncScheduler.scheduleRetry(context, nextAt - now);
            return;
        }
        BridgeClient.PushResult result = BridgeClient.registerPush(context, desired);
        if (result.result == BridgeClient.ReportResult.REPORTED) {
            prefs.edit().putString(REGISTERED, desired).putBoolean(SERVER_CONFIGURED, result.pushConfigured)
                    .putLong(CHECKED_AT, now).putInt(ATTEMPTS, 0).putLong(NEXT_AT, 0).apply();
            return;
        }
        int attempts = prefs.getInt(ATTEMPTS, 0) + 1;
        long delay = SyncBackoff.delayMillis(attempts);
        prefs.edit().putInt(ATTEMPTS, attempts).putLong(NEXT_AT, now + delay).apply();
        SyncScheduler.scheduleRetry(context, delay);
    }

    /** 연결 해제 직전: 기기 인증이 아직 살아 있을 때 빈 토큰으로 서버 등록을 지운다. 결과와 상관없이 로컬 기록은 비운다. */
    public static void unregister(Context context) {
        if (BridgePreferences.configured(context) && !prefs(context).getString(REGISTERED, "").isEmpty()) {
            BridgeClient.registerPush(context, "");
        }
        forgetRegistration(context);
    }

    /** 새 기기 행으로 다시 연결하면 그 행에는 아직 토큰이 없으므로 등록 기록을 비워 다시 등록하게 한다. */
    public static void forgetRegistration(Context context) {
        prefs(context).edit().remove(REGISTERED).remove(SERVER_CONFIGURED).remove(CHECKED_AT).remove(ATTEMPTS).remove(NEXT_AT).apply();
    }

    public static PushLogic.Status status(Context context) {
        SharedPreferences prefs = prefs(context);
        return PushLogic.status(prefs.getBoolean(UNAVAILABLE, false), prefs.getString(REGISTERED, ""), prefs.getBoolean(SERVER_CONFIGURED, false));
    }
}
