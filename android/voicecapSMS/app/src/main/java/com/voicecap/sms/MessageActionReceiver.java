package com.voicecap.sms;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 새 문자 알림의 "답장"·"읽음" 버튼. 답장은 {@link SmsSender}로 실제 발송하고 보낸편지함에 기록한다
 * (통신사 결과는 {@link SmsSentReceiver}가 확정). 답장하거나 읽음을 누르면 대화를 읽음 처리하고 알림을 지운다.
 */
public final class MessageActionReceiver extends BroadcastReceiver {
    static final String ACTION_REPLY = "com.voicecap.sms.NOTIFICATION_REPLY";
    static final String ACTION_MARK_READ = "com.voicecap.sms.NOTIFICATION_MARK_READ";
    static final String EXTRA_ADDRESS = "address";
    static final String EXTRA_SUB_ID = "sub_id";
    static final String EXTRA_NOTIFICATION_ID = "notification_id";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String address = intent.getStringExtra(EXTRA_ADDRESS);
        if (address == null || address.isEmpty()) return;
        int notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, MessageNotifier.conversationId(address));
        int subId = intent.getIntExtra(EXTRA_SUB_ID, -1);
        String reply = null;
        if (ACTION_REPLY.equals(action)) {
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence text = results == null ? null : results.getCharSequence(MessageNotifier.KEY_REPLY);
            reply = text == null ? "" : text.toString().trim();
            if (reply.isEmpty()) {
                MessageNotifier.cancel(context, notificationId);
                return;
            }
        } else if (!ACTION_MARK_READ.equals(action)) {
            return;
        }
        Context app = context.getApplicationContext();
        String body = reply;
        PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            try {
                if (body != null) send(app, address, body, subId);
                MessageNotifier.markConversationRead(app, address);
                MessageNotifier.cancel(app, notificationId);
            } finally {
                pending.finish();
            }
        });
    }

    private static void send(Context context, String address, String body, int subId) {
        if (!SmsRoleUtils.isDefaultSmsApp(context)) {
            // 기본 문자앱이 아니면 보낸편지함에 기록할 수 없으므로 보내지 않는다.
            MessageNotifier.notifySendFailed(context, address);
            return;
        }
        try {
            SmsSender.send(context, address, body, subId, LocalDb.ORIGIN_DEVICE, null);
        } catch (Exception error) {
            android.util.Log.e("VoiceCAP", "notification reply failed", error);
            MessageNotifier.notifySendFailed(context, address);
        }
    }
}
