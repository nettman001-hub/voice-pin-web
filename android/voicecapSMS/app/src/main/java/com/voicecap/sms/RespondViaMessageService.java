package com.voicecap.sms;

import android.app.Service;
import android.content.Intent;
import android.net.Uri;
import android.os.IBinder;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 전화 거절 시 "문자로 답장"을 실제로 보낸다 (기본 문자앱 필수 동작). */
public final class RespondViaMessageService extends Service {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String phone = intent == null ? null : recipient(intent.getData());
        String body = intent == null ? null : intent.getStringExtra(Intent.EXTRA_TEXT);
        if (phone == null || body == null || body.isEmpty()) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        int subId = SmsReceiver.subscriptionId(intent);
        EXECUTOR.execute(() -> {
            try {
                SmsSender.send(getApplicationContext(), phone, body, subId, LocalDb.ORIGIN_DEVICE, null);
            } catch (Exception error) {
                android.util.Log.e("VoiceCAP", "respond via message failed", error);
                MessageNotifier.notifySendFailed(getApplicationContext(), phone);
            } finally {
                stopSelf(startId);
            }
        });
        return START_NOT_STICKY;
    }

    /** smsto:010-1234-5678 또는 sms:01012345678;01099998888 형태에서 첫 번호를 꺼낸다. */
    static String recipient(Uri uri) {
        if (uri == null) return null;
        String value = uri.getSchemeSpecificPart();
        if (value == null) return null;
        int query = value.indexOf('?');
        if (query >= 0) value = value.substring(0, query);
        String first = value.split("[,;]")[0].trim();
        return first.isEmpty() ? null : first;
    }
}
