package com.voicecap.sms;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;
import android.telephony.SmsManager;

import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class SmsSyncManager {
    private SmsSyncManager() { }

    public static String syncNow(Context context) {
        if (!BridgePreferences.configured(context)) return "서버 URL과 판매자 ID를 먼저 저장해 주세요.";
        int sent = syncRecentSms(context);
        sent += syncRecentMms(context);
        int queued = sendOutbox(context);
        return "수신 " + sent + "건 업로드, 발송 " + queued + "건 요청";
    }

    public static int syncRecentSms(Context context) {
        int count = 0;
        Cursor cursor = context.getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI,
                new String[]{Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE},
                null, null, Telephony.Sms.DATE + " DESC LIMIT 100");
        if (cursor == null) return count;
        try {
            while (cursor.moveToNext()) {
                String id = cursor.getString(0);
                String phone = cursor.getString(1);
                String body = cursor.getString(2);
                String externalId = "device-sms-" + id;
                if (isUploaded(context, externalId)) continue;
                if (BridgeClient.postIncoming(context, externalId, phone == null ? "알 수 없음" : phone, body == null ? "" : body, new ArrayList<>())) {
                    markUploaded(context, externalId); count++;
                }
            }
        } finally { cursor.close(); }
        return count;
    }

    public static int syncRecentMms(Context context) {
        int count = 0;
        Cursor cursor = context.getContentResolver().query(Telephony.Mms.Inbox.CONTENT_URI,
                new String[]{"_id", "date", "sub"}, null, null, "date DESC LIMIT 30");
        if (cursor == null) return count;
        try {
            while (cursor.moveToNext()) {
                String id = cursor.getString(0);
                String externalId = "device-mms-" + id;
                if (isUploaded(context, externalId)) continue;
                List<BridgeClient.ImageAttachment> images = readMmsImages(context, id);
                String body = readMmsText(context, id, cursor.getString(2));
                String phone = readMmsAddress(context, id);
                if (phone.isEmpty()) continue;
                if (BridgeClient.postIncoming(context, externalId, phone, body, images)) {
                    markUploaded(context, externalId); count++;
                }
            }
        } finally { cursor.close(); }
        return count;
    }

    public static int sendOutbox(Context context) {
        int count = 0;
        for (JSONObject message : BridgeClient.getOutbox(context)) {
            String id = message.optString("id");
            try {
                String phone = message.getString("phoneNumber");
                String body = message.getString("body");
                SmsManager manager = context.getSystemService(SmsManager.class);
                ArrayList<String> parts = manager.divideMessage(body);
                BridgeClient.updateOutboxStatus(context, id, "SENDING", null);
                if (parts.size() > 1) manager.sendMultipartTextMessage(phone, null, parts, null, null);
                else manager.sendTextMessage(phone, null, body, null, null);
                BridgeClient.updateOutboxStatus(context, id, "SENT", null);
                count++;
            } catch (Exception error) {
                BridgeClient.updateOutboxStatus(context, id, "FAILED", error.getMessage());
            }
        }
        return count;
    }

    private static String readMmsAddress(Context context, String messageId) {
        Uri uri = Uri.parse("content://mms/" + messageId + "/addr");
        Cursor cursor = context.getContentResolver().query(uri, new String[]{"address", "type"}, null, null, null);
        if (cursor == null) return "";
        try {
            while (cursor.moveToNext()) {
                if (cursor.getInt(1) == 137) return cursor.getString(0);
            }
        } finally { cursor.close(); }
        return "";
    }

    private static String readMmsText(Context context, String messageId, String fallback) {
        Cursor cursor = context.getContentResolver().query(Uri.parse("content://mms/part"),
                new String[]{"_id", "ct", "text", "_data"}, "mid=?", new String[]{messageId}, null);
        if (cursor == null) return fallback == null ? "" : fallback;
        StringBuilder result = new StringBuilder(fallback == null ? "" : fallback);
        try {
            while (cursor.moveToNext()) {
                if (!"text/plain".equals(cursor.getString(1))) continue;
                String text = cursor.getString(2);
                if (text != null) result.append('\n').append(text);
                else try (InputStream input = context.getContentResolver().openInputStream(Uri.parse("content://mms/part/" + cursor.getString(0)))) {
                    if (input != null) result.append('\n').append(new String(BridgeClient.readLimited(input), StandardCharsets.UTF_8));
                } catch (Exception ignored) { }
            }
        } finally { cursor.close(); }
        return result.toString().trim();
    }

    private static List<BridgeClient.ImageAttachment> readMmsImages(Context context, String messageId) {
        List<BridgeClient.ImageAttachment> images = new ArrayList<>();
        Cursor cursor = context.getContentResolver().query(Uri.parse("content://mms/part"), new String[]{"_id", "ct"}, "mid=?", new String[]{messageId}, null);
        if (cursor == null) return images;
        try {
            while (cursor.moveToNext() && images.size() < 8) {
                String mime = cursor.getString(1);
                if (mime == null || !mime.startsWith("image/")) continue;
                String partId = cursor.getString(0);
                try (InputStream input = context.getContentResolver().openInputStream(Uri.parse("content://mms/part/" + partId))) {
                    if (input != null) images.add(new BridgeClient.ImageAttachment("mms-" + partId, mime, BridgeClient.readLimited(input)));
                } catch (Exception ignored) { }
            }
        } finally { cursor.close(); }
        return images;
    }

    private static boolean isUploaded(Context context, String id) { return BridgePreferences.get(context).getBoolean("uploaded_" + id, false); }
    private static void markUploaded(Context context, String id) { BridgePreferences.get(context).edit().putBoolean("uploaded_" + id, true).apply(); }
}
