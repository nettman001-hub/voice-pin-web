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

/**
 * 받은 SMS/MMS의 서버 업로드 큐 (sync_items).
 * 수신하자마자 모든 문자에 행을 만든다: 업무 대상(구매정보 문자·업무 고객 번호)이면 PENDING, 아니면 SKIPPED.
 * PENDING 행은 attempts·next_at 백오프로 올리고, 최근 문자함 스캔은 하루 한 번 누락 복구용으로만 쓴다.
 */
public final class UploadQueue {
    private static final long RECOVERY_SCAN_INTERVAL_MILLIS = 24L * 60 * 60 * 1000;
    private static final String LAST_RECOVERY_SCAN = "last_recovery_scan_at";
    private static final int PAGE_SIZE = 50;
    /** 연속으로 이만큼 실패하면 서버·네트워크 문제로 보고 이번 회차를 멈춘다 (항목마다 타임아웃을 기다리지 않게). */
    private static final int MAX_CONSECUTIVE_RETRIES = 3;
    private static final int ADDRESS_FROM = 137;

    private UploadQueue() { }

    public static String smsExternalId(long id) { return "device-sms-" + id; }
    public static String mmsExternalId(long id) { return "device-mms-" + id; }
    public static String smsProviderUri(long id) { return "content://sms/" + id; }
    public static String mmsProviderUri(long id) { return "content://mms/" + id; }

    /** 문자함에 저장한 직후 호출한다. 이미 행이 있으면 그대로 둔다. */
    public static void enqueueIncoming(Context context, String kind, long providerId, String phone, String body, long receivedAtMillis) {
        boolean mms = LocalDb.KIND_MMS_IN.equals(kind);
        boolean blocked = SmsReceiver.isBlocked(context, phone);
        boolean qualifies = UploadFilter.shouldUpload(body, BusinessContactStore.contains(context, phone), blocked);
        if (qualifies && UploadFilter.isPurchaseMessage(body)) BusinessContactStore.register(context, phone);

        LocalDb.Item item = new LocalDb.Item();
        item.externalId = mms ? mmsExternalId(providerId) : smsExternalId(providerId);
        item.kind = kind;
        item.origin = LocalDb.ORIGIN_DEVICE;
        item.providerUri = mms ? mmsProviderUri(providerId) : smsProviderUri(providerId);
        item.state = qualifies ? LocalDb.STATE_PENDING : LocalDb.STATE_SKIPPED;
        item.payload = new JSONObject();
        try {
            item.payload.put("receivedAt", receivedAtMillis);
        } catch (Exception ignored) { }
        LocalDb.get(context).insertIfAbsent(item);
    }

    /** 업로드 대기 행을 올린다. force면 백오프 중인 행도 바로 시도한다. 올린 건수를 돌려준다. */
    public static int uploadPending(Context context, boolean force) {
        LocalDb db = LocalDb.get(context);
        int uploaded = 0;
        int consecutiveRetries = 0;
        for (String kind : new String[]{LocalDb.KIND_SMS_IN, LocalDb.KIND_MMS_IN}) {
            long afterRowId = 0;
            while (true) {
                List<LocalDb.Item> page = db.page(kind, LocalDb.STATE_PENDING, afterRowId, PAGE_SIZE);
                if (page.isEmpty()) break;
                for (LocalDb.Item item : page) {
                    afterRowId = item.rowId;
                    long now = System.currentTimeMillis();
                    if (!force && item.nextAt > now) continue;
                    BridgeClient.ReportResult result = upload(context, item);
                    if (result == BridgeClient.ReportResult.REPORTED) {
                        item.state = LocalDb.STATE_SYNCED;
                        item.lastError = null;
                        uploaded++;
                        consecutiveRetries = 0;
                    } else if (result == BridgeClient.ReportResult.RETRY) {
                        item.attempts++;
                        item.nextAt = now + SyncBackoff.delayMillis(item.attempts);
                        item.lastError = "업로드 실패 (네트워크·서버), 다시 시도 예정";
                        consecutiveRetries++;
                    } else if (result != null) {
                        item.state = LocalDb.STATE_FAILED;
                        item.lastError = "서버가 업로드를 거절함";
                        consecutiveRetries = 0;
                    }
                    db.update(item);
                    if (consecutiveRetries >= MAX_CONSECUTIVE_RETRIES) return uploaded;
                }
            }
        }
        return uploaded;
    }

    /** 한 건 업로드. 문자함에서 지워졌으면 SKIPPED로 바꾸고 null을 돌려준다. */
    private static BridgeClient.ReportResult upload(Context context, LocalDb.Item item) {
        boolean mms = LocalDb.KIND_MMS_IN.equals(item.kind);
        Message message = item.providerUri == null ? null
                : mms ? readMms(context, Uri.parse(item.providerUri).getLastPathSegment()) : readSms(context, item.providerUri);
        if (message == null) {
            item.state = LocalDb.STATE_SKIPPED;
            item.lastError = "문자함에서 삭제됨";
            return null;
        }
        boolean purchase = UploadFilter.isPurchaseMessage(message.body);
        if (purchase) BusinessContactStore.register(context, message.phone);
        List<BridgeClient.ImageAttachment> images = mms ? readMmsImages(context, message.id) : new ArrayList<>();
        long receivedAt = item.payload.optLong("receivedAt", message.dateMillis);
        return BridgeClient.postIncoming(context, item.externalId, message.phone.isEmpty() ? "알 수 없음" : message.phone,
                message.body, purchase ? "PURCHASE_INFO" : "CUSTOMER_INQUIRY", receivedAt, images);
    }

    /**
     * 누락 복구: 하루 한 번 최근 SMS 100건·MMS 30건 중 sync_items에 없는 문자만 큐에 넣는다.
     * (수신 때 행을 만들지 못한 경우 대비. 업로드 자체는 {@link #uploadPending}이 한다.)
     */
    public static void recoveryScanIfDue(Context context) {
        long now = System.currentTimeMillis();
        long last = BridgePreferences.get(context).getLong(LAST_RECOVERY_SCAN, 0);
        if (last > 0 && now - last < RECOVERY_SCAN_INTERVAL_MILLIS && now >= last) return;
        LocalDb db = LocalDb.get(context);
        try (Cursor cursor = context.getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI,
                new String[]{Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE},
                null, null, Telephony.Sms.DATE + " DESC LIMIT 100")) {
            while (cursor != null && cursor.moveToNext()) {
                long id = cursor.getLong(0);
                if (db.exists(smsExternalId(id))) continue;
                enqueueIncoming(context, LocalDb.KIND_SMS_IN, id, cursor.getString(1), cursor.getString(2), cursor.getLong(3));
            }
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "SMS recovery scan failed", error);
        }
        try (Cursor cursor = context.getContentResolver().query(Telephony.Mms.Inbox.CONTENT_URI,
                new String[]{"_id", "date", "sub"}, null, null, "date DESC LIMIT 30")) {
            while (cursor != null && cursor.moveToNext()) {
                long id = cursor.getLong(0);
                if (db.exists(mmsExternalId(id))) continue;
                String messageId = String.valueOf(id);
                String phone = readMmsAddress(context, messageId);
                if (phone.isEmpty()) continue;
                enqueueIncoming(context, LocalDb.KIND_MMS_IN, id, phone, readMmsText(context, messageId, cursor.getString(2)), cursor.getLong(1) * 1000L);
            }
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "MMS recovery scan failed", error);
        }
        BridgePreferences.get(context).edit().putLong(LAST_RECOVERY_SCAN, now).apply();
    }

    private static final class Message {
        String id;
        String phone;
        String body;
        long dateMillis;
    }

    private static Message readSms(Context context, String providerUri) {
        try (Cursor cursor = context.getContentResolver().query(Uri.parse(providerUri),
                new String[]{Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE}, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            Message message = new Message();
            message.id = cursor.getString(0);
            message.phone = cursor.getString(1) == null ? "" : cursor.getString(1);
            message.body = cursor.getString(2) == null ? "" : cursor.getString(2);
            message.dateMillis = cursor.getLong(3);
            return message;
        } catch (RuntimeException error) {
            return null;
        }
    }

    private static Message readMms(Context context, String messageId) {
        if (messageId == null) return null;
        try (Cursor cursor = context.getContentResolver().query(Uri.parse("content://mms/" + messageId),
                new String[]{"_id", "date", "sub"}, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            Message message = new Message();
            message.id = messageId;
            message.phone = readMmsAddress(context, messageId);
            message.body = readMmsText(context, messageId, cursor.getString(2));
            message.dateMillis = cursor.getLong(1) * 1000L;
            return message;
        } catch (RuntimeException error) {
            return null;
        }
    }

    static String readMmsAddress(Context context, String messageId) {
        Uri uri = Uri.parse("content://mms/" + messageId + "/addr");
        try (Cursor cursor = context.getContentResolver().query(uri, new String[]{"address", "type"}, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) {
                if (cursor.getInt(1) == ADDRESS_FROM) return cursor.getString(0) == null ? "" : cursor.getString(0);
            }
        } catch (RuntimeException ignored) { }
        return "";
    }

    static String readMmsText(Context context, String messageId, String fallback) {
        StringBuilder result = new StringBuilder(fallback == null ? "" : fallback);
        try (Cursor cursor = context.getContentResolver().query(Uri.parse("content://mms/part"),
                new String[]{"_id", "ct", "text", "_data"}, "mid=?", new String[]{messageId}, null)) {
            while (cursor != null && cursor.moveToNext()) {
                if (!"text/plain".equals(cursor.getString(1))) continue;
                String text = cursor.getString(2);
                if (text != null) result.append('\n').append(text);
                else try (InputStream input = context.getContentResolver().openInputStream(Uri.parse("content://mms/part/" + cursor.getString(0)))) {
                    if (input != null) result.append('\n').append(new String(BridgeClient.readLimited(input), StandardCharsets.UTF_8));
                } catch (Exception ignored) { }
            }
        } catch (RuntimeException ignored) { }
        return result.toString().trim();
    }

    private static List<BridgeClient.ImageAttachment> readMmsImages(Context context, String messageId) {
        List<BridgeClient.ImageAttachment> images = new ArrayList<>();
        try (Cursor cursor = context.getContentResolver().query(Uri.parse("content://mms/part"), new String[]{"_id", "ct"}, "mid=?", new String[]{messageId}, null)) {
            while (cursor != null && cursor.moveToNext() && images.size() < 8) {
                String mime = cursor.getString(1);
                if (mime == null || !mime.startsWith("image/")) continue;
                String partId = cursor.getString(0);
                try (InputStream input = context.getContentResolver().openInputStream(Uri.parse("content://mms/part/" + partId))) {
                    if (input != null) images.add(new BridgeClient.ImageAttachment("mms-" + partId, mime, BridgeClient.readLimited(input)));
                } catch (Exception ignored) { }
            }
        } catch (RuntimeException ignored) { }
        return images;
    }
}
