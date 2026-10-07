package com.voicecap.sms;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/** 기본 문자앱이 맡아야 하는 새 문자·전송 실패 알림. (바로 답장·읽음 처리는 Phase 1) */
public final class MessageNotifier {
    private static final String CHANNEL_MESSAGES = "incoming_messages";
    private static final String CHANNEL_ALERTS = "message_alerts";

    private MessageNotifier() { }

    public static void notifyIncoming(Context context, String address, String body) {
        show(context, CHANNEL_MESSAGES, ("in:" + BusinessContactStore.normalize(address)).hashCode(),
                address == null || address.isEmpty() ? "새 문자" : address, body == null ? "" : body);
    }

    public static void notifyMmsFailed(Context context, String address) {
        show(context, CHANNEL_ALERTS, ("mms-fail:" + address).hashCode(),
                "멀티미디어 문자를 받지 못했습니다", (address == null || address.isEmpty() ? "" : address + " · ") + "데이터 연결을 확인해 주세요.");
    }

    public static void notifySendFailed(Context context, String address) {
        show(context, CHANNEL_ALERTS, ("send-fail:" + address).hashCode(),
                "문자 전송 실패", (address == null ? "" : address + " · ") + "통신사로 보내지 못했습니다.");
    }

    private static void show(Context context, String channelId, int id, String title, String text) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        ensureChannels(manager);
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setContentIntent(content)
                .setAutoCancel(true)
                .build();
        manager.notify(id, notification);
    }

    private static void ensureChannels(NotificationManager manager) {
        if (manager.getNotificationChannel(CHANNEL_MESSAGES) == null) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL_MESSAGES, "새 문자", NotificationManager.IMPORTANCE_HIGH));
        }
        if (manager.getNotificationChannel(CHANNEL_ALERTS) == null) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL_ALERTS, "문자 오류", NotificationManager.IMPORTANCE_DEFAULT));
        }
    }
}
