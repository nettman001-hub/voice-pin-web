package com.voicecap.sms;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.RemoteInput;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.provider.Telephony;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** 기본 문자앱이 맡아야 하는 새 문자 알림(바로 답장·읽음 처리)과 전송 실패 알림. */
public final class MessageNotifier {
    private static final String CHANNEL_MESSAGES = "incoming_messages";
    private static final String CHANNEL_ALERTS = "message_alerts";
    static final String KEY_REPLY = "reply_text";
    /** 알림에 함께 보여 줄 안 읽은 문자 수 (대화별). */
    private static final int MAX_LINES = 6;

    private MessageNotifier() { }

    /** 대화(발신 번호)별 알림 id. 답장·읽음 처리 후 같은 id로 지운다. */
    static int conversationId(String address) {
        return ("in:" + BusinessContactStore.normalize(address)).hashCode();
    }

    public static void notifyIncoming(Context context, String address, String body, int subId) {
        String title = address == null || address.isEmpty() ? "새 문자" : address;
        String text = body == null ? "" : body;
        int id = conversationId(address);
        Notification.Builder builder = builder(context, CHANNEL_MESSAGES, title, text);
        if (address != null && !address.isEmpty()) {
            // 알림을 누르면 그 대화방을 연다.
            Intent chat = ChatActivity.intent(context, -1, address).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            builder.setContentIntent(PendingIntent.getActivity(context, id, chat, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            List<String> unread = unreadBodies(context, address);
            if (unread.isEmpty() || !unread.get(unread.size() - 1).equals(text)) unread.add(text);
            if (Build.VERSION.SDK_INT >= 28) {
                Person me = new Person.Builder().setName("나").build();
                Person sender = new Person.Builder().setName(title).setKey(BusinessContactStore.normalize(address)).build();
                Notification.MessagingStyle style = new Notification.MessagingStyle(me);
                long now = System.currentTimeMillis();
                int from = Math.max(0, unread.size() - MAX_LINES);
                for (int index = from; index < unread.size(); index++) {
                    style.addMessage(unread.get(index), now - (unread.size() - 1 - index), sender);
                }
                builder.setStyle(style);
            }
            builder.addAction(replyAction(context, address, subId, id));
            builder.addAction(markReadAction(context, address, id));
        }
        post(context, id, builder);
    }

    public static void notifyMmsFailed(Context context, String address) {
        post(context, ("mms-fail:" + address).hashCode(), builder(context, CHANNEL_ALERTS,
                "멀티미디어 문자를 받지 못했습니다", (address == null || address.isEmpty() ? "" : address + " · ") + "데이터 연결을 확인해 주세요."));
    }

    public static void notifySendFailed(Context context, String address) {
        post(context, ("send-fail:" + address).hashCode(), builder(context, CHANNEL_ALERTS,
                "문자 전송 실패", (address == null ? "" : address + " · ") + "통신사로 보내지 못했습니다."));
    }

    static void cancel(Context context, int id) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(id);
    }

    /** 이 번호와의 대화에서 안 읽은 SMS·MMS를 읽음으로 표시한다. */
    static void markConversationRead(Context context, String address) {
        long threadId;
        try {
            threadId = Telephony.Threads.getOrCreateThreadId(context, address);
        } catch (RuntimeException error) {
            return;
        }
        ContentValues values = new ContentValues();
        values.put(Telephony.Sms.READ, 1);
        values.put(Telephony.Sms.SEEN, 1);
        String[] args = {String.valueOf(threadId)};
        try {
            context.getContentResolver().update(Telephony.Sms.Inbox.CONTENT_URI, values, Telephony.Sms.THREAD_ID + "=? AND " + Telephony.Sms.READ + "=0", args);
            context.getContentResolver().update(Telephony.Mms.Inbox.CONTENT_URI, values, Telephony.Mms.THREAD_ID + "=? AND " + Telephony.Mms.READ + "=0", args);
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "mark read failed", error);
        }
    }

    /** 대화의 안 읽은 SMS 본문 (오래된 것부터). 기본 문자앱이 아니면 빈 목록. */
    private static List<String> unreadBodies(Context context, String address) {
        List<String> bodies = new ArrayList<>();
        try {
            long threadId = Telephony.Threads.getOrCreateThreadId(context, address);
            try (Cursor cursor = context.getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI, new String[]{Telephony.Sms.BODY},
                    Telephony.Sms.THREAD_ID + "=? AND " + Telephony.Sms.READ + "=0", new String[]{String.valueOf(threadId)},
                    Telephony.Sms.DATE + " DESC LIMIT " + MAX_LINES)) {
                while (cursor != null && cursor.moveToNext()) bodies.add(cursor.getString(0) == null ? "" : cursor.getString(0));
            }
        } catch (RuntimeException ignored) { }
        Collections.reverse(bodies);
        return bodies;
    }

    private static Notification.Action replyAction(Context context, String address, int subId, int notificationId) {
        Intent intent = new Intent(context, MessageActionReceiver.class)
                .setAction(MessageActionReceiver.ACTION_REPLY)
                .putExtra(MessageActionReceiver.EXTRA_ADDRESS, address)
                .putExtra(MessageActionReceiver.EXTRA_SUB_ID, subId)
                .putExtra(MessageActionReceiver.EXTRA_NOTIFICATION_ID, notificationId);
        // 시스템이 입력한 답장을 인텐트에 채워 넣으므로 MUTABLE이어야 한다. 대상은 앱 내부 리시버로 고정.
        PendingIntent pending = PendingIntent.getBroadcast(context, notificationId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0));
        RemoteInput input = new RemoteInput.Builder(KEY_REPLY).setLabel("답장 입력").build();
        Notification.Action.Builder action = new Notification.Action.Builder(
                Icon.createWithResource(context, R.drawable.ic_launcher), "답장", pending)
                .addRemoteInput(input)
                .setAllowGeneratedReplies(true);
        if (Build.VERSION.SDK_INT >= 28) action.setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY);
        return action.build();
    }

    private static Notification.Action markReadAction(Context context, String address, int notificationId) {
        Intent intent = new Intent(context, MessageActionReceiver.class)
                .setAction(MessageActionReceiver.ACTION_MARK_READ)
                .putExtra(MessageActionReceiver.EXTRA_ADDRESS, address)
                .putExtra(MessageActionReceiver.EXTRA_NOTIFICATION_ID, notificationId);
        PendingIntent pending = PendingIntent.getBroadcast(context, notificationId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Action.Builder action = new Notification.Action.Builder(
                Icon.createWithResource(context, R.drawable.ic_launcher), "읽음", pending);
        if (Build.VERSION.SDK_INT >= 28) action.setSemanticAction(Notification.Action.SEMANTIC_ACTION_MARK_AS_READ);
        return action.build();
    }

    private static Notification.Builder builder(Context context, String channelId, String title, String text) {
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setContentIntent(content)
                .setAutoCancel(true);
    }

    private static void post(Context context, int id, Notification.Builder builder) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        ensureChannels(manager);
        manager.notify(id, builder.build());
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
