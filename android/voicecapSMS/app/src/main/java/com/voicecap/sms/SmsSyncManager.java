package com.voicecap.sms;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;

import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class SmsSyncManager {
    /** 통신사 결과가 이 시간 안에 오지 않으면 문자함 상태로 결과를 확정한다. */
    private static final long STALE_SEND_MILLIS = 10 * 60 * 1000L;

    private SmsSyncManager() { }

    public static String syncNow(Context context) {
        if (!BridgePreferences.hasDataTransferConsent(context)) return "문자 정보 전송 동의가 필요합니다.";
        if (!SmsRoleUtils.isDefaultSmsApp(context)) return "기본 SMS 앱으로 설정되어 있지 않아 동기화를 중단했습니다.";
        if (!SmsRoleUtils.hasSmsPermissions(context)) return "SMS/MMS 권한이 없어 동기화를 중단했습니다.";
        if (!BridgePreferences.configured(context)) return "웹앱에서 만든 기기 연결 코드를 먼저 입력해 주세요.";
        BridgeClient.refreshBusinessContacts(context);
        int sent = syncRecentSms(context);
        sent += syncRecentMms(context);
        reconcileStaleSends(context);
        int queued = sendOutbox(context);
        reportOutboxResults(context);
        return "수신 " + sent + "건 업로드, 발송 " + queued + "건 요청";
    }

    public static int syncRecentSms(Context context) {
        int count = 0;
        LocalDb db = LocalDb.get(context);
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
                if (db.isSynced(externalId)) continue;
                boolean purchaseMessage = UploadFilter.isPurchaseMessage(body);
                if (!UploadFilter.shouldUpload(body, BusinessContactStore.contains(context, phone), SmsReceiver.isBlocked(context, phone))) continue;
                if (purchaseMessage) BusinessContactStore.register(context, phone);
                String category = purchaseMessage ? "PURCHASE_INFO" : "CUSTOMER_INQUIRY";
                if (BridgeClient.postIncoming(context, externalId, phone == null ? "알 수 없음" : phone, body == null ? "" : body, category, new ArrayList<>())) {
                    db.markSynced(externalId, LocalDb.KIND_SMS_IN); count++;
                }
            }
        } finally { cursor.close(); }
        return count;
    }

    public static int syncRecentMms(Context context) {
        int count = 0;
        LocalDb db = LocalDb.get(context);
        Cursor cursor = context.getContentResolver().query(Telephony.Mms.Inbox.CONTENT_URI,
                new String[]{"_id", "date", "sub"}, null, null, "date DESC LIMIT 30");
        if (cursor == null) return count;
        try {
            while (cursor.moveToNext()) {
                String id = cursor.getString(0);
                String externalId = "device-mms-" + id;
                if (db.isSynced(externalId)) continue;
                String phone = readMmsAddress(context, id);
                if (phone.isEmpty()) continue;
                String body = readMmsText(context, id, cursor.getString(2));
                boolean purchaseMessage = UploadFilter.isPurchaseMessage(body);
                if (!UploadFilter.shouldUpload(body, BusinessContactStore.contains(context, phone), SmsReceiver.isBlocked(context, phone))) continue;
                if (purchaseMessage) BusinessContactStore.register(context, phone);
                List<BridgeClient.ImageAttachment> images = readMmsImages(context, id);
                String category = purchaseMessage ? "PURCHASE_INFO" : "CUSTOMER_INQUIRY";
                if (BridgeClient.postIncoming(context, externalId, phone, body, category, images)) {
                    db.markSynced(externalId, LocalDb.KIND_MMS_IN); count++;
                }
            }
        } finally { cursor.close(); }
        return count;
    }

    /**
     * 웹 발송함의 문자를 보낸다. 결과는 통신사 콜백({@link SmsSentReceiver}) 뒤에
     * {@link #reportOutboxResults}가 보고한다. 이미 보낸 메시지가 다시 내려와도 중복 발송하지 않는다.
     */
    public static int sendOutbox(Context context) {
        int count = 0;
        LocalDb db = LocalDb.get(context);
        for (JSONObject message : BridgeClient.getOutbox(context)) {
            String id = message.optString("id");
            if (id.isEmpty() || db.exists(SmsSender.webExternalId(id))) continue;
            String phone = message.optString("phone_number", message.optString("phoneNumber"));
            try {
                String body = message.getString("body");
                BusinessContactStore.register(context, phone);
                SmsSender.send(context, phone, body, -1, LocalDb.ORIGIN_WEB, id);
                count++;
            } catch (Exception error) {
                if (!db.exists(SmsSender.webExternalId(id))) {
                    LocalDb.Item item = new LocalDb.Item();
                    item.externalId = SmsSender.webExternalId(id);
                    item.kind = LocalDb.KIND_SMS_OUT;
                    item.origin = LocalDb.ORIGIN_WEB;
                    item.serverId = id;
                    item.state = LocalDb.STATE_PENDING;
                    item.payload = new JSONObject();
                    try {
                        item.payload.put("phone", phone).put("status", "FAILED")
                                .put("error", error.getMessage() == null ? "SMS 발송 실패" : error.getMessage());
                    } catch (Exception ignored) { }
                    db.insert(item);
                }
            }
        }
        return count;
    }

    /** 확정된 웹 발송 결과(SENT/FAILED)를 서버에 보고한다. 네트워크 오류는 백오프 후 재시도. */
    public static void reportOutboxResults(Context context) {
        LocalDb db = LocalDb.get(context);
        long now = System.currentTimeMillis();
        for (LocalDb.Item item : db.list(LocalDb.KIND_SMS_OUT, LocalDb.ORIGIN_WEB, LocalDb.STATE_PENDING)) {
            if (item.nextAt > now) continue;
            String status = item.payload.optString("status", "FAILED");
            String error = "FAILED".equals(status) ? item.payload.optString("error", "SMS 발송 실패") : null;
            BridgeClient.ReportResult result = BridgeClient.updateOutboxStatus(context, item.serverId, status, error);
            if (result == BridgeClient.ReportResult.RETRY) {
                item.attempts++;
                item.nextAt = now + SyncBackoff.delayMillis(item.attempts);
                item.lastError = "서버 보고 실패";
            } else {
                item.state = LocalDb.STATE_SYNCED;
                item.lastError = result == BridgeClient.ReportResult.REJECTED ? "서버가 상태 보고를 거절함" : null;
            }
            db.update(item);
        }
    }

    /** 앱이 종료되어 통신사 결과를 못 받은 웹 발송분은 문자함 상태로 결과를 정한다. */
    static void reconcileStaleSends(Context context) {
        LocalDb db = LocalDb.get(context);
        long cutoff = System.currentTimeMillis() - STALE_SEND_MILLIS;
        for (LocalDb.Item item : db.list(LocalDb.KIND_SMS_OUT, LocalDb.ORIGIN_WEB, LocalDb.STATE_SENDING)) {
            if (item.createdAt > cutoff) continue;
            boolean sent = item.providerUri != null && readSmsType(context, item.providerUri) == Telephony.Sms.MESSAGE_TYPE_SENT;
            SmsSentReceiver.finish(context, item.externalId, sent, sent ? null : "통신사 전송 결과를 확인하지 못했습니다.");
        }
    }

    private static int readSmsType(Context context, String providerUri) {
        try (Cursor cursor = context.getContentResolver().query(Uri.parse(providerUri), new String[]{Telephony.Sms.TYPE}, null, null, null)) {
            return cursor != null && cursor.moveToFirst() ? cursor.getInt(0) : -1;
        } catch (RuntimeException ignored) {
            return -1;
        }
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
}
