package com.voicecap.sms;

import android.content.Context;

import org.json.JSONObject;

import java.util.List;

/**
 * MMS 다운로드가 실패해도 잃지 않게 한다. 알림(m-notification-ind)을 받으면 먼저 sync_items에
 * MMS_NOTICE 행(content-location·transaction id·만료·subId)으로 저장하고, 다운로드·문자함 저장에
 * 성공했을 때만 지운다. 실패하면 만료 전까지 백오프로 다시 받는다 (주기 작업·앱 열기·네트워크 복구).
 */
public final class MmsDownloads {
    /** 다운로드 결과가 이 시간 안에 오지 않으면 결과가 사라진 것으로 보고 다시 요청한다. */
    static final long DOWNLOAD_TIMEOUT_MILLIS = 10 * 60 * 1000L;
    private static final String DOWNLOADING_UNTIL = "downloadingUntil";

    private MmsDownloads() { }

    static String noticeId(String transactionId) { return "mms-notice-" + transactionId; }

    /** WAP Push로 MMS 알림을 받은 직후. */
    public static synchronized void onNotification(Context context, MmsPdu.NotificationInd ind, int subId) {
        LocalDb db = LocalDb.get(context);
        String id = noticeId(ind.transactionId);
        if (MmsStore.existsByTransactionId(context, ind.transactionId)) {
            // 이미 저장한 MMS의 알림이 다시 왔다: 앞서 보낸 수신 확인이 통신사에 닿지 않은 경우.
            db.delete(id);
            MmsDownloadReceiver.acknowledge(context, ind.transactionId, subId);
            return;
        }
        long now = System.currentTimeMillis();
        LocalDb.Item item = new LocalDb.Item();
        item.externalId = id;
        item.kind = LocalDb.KIND_MMS_NOTICE;
        item.origin = LocalDb.ORIGIN_DEVICE;
        item.state = LocalDb.STATE_PENDING;
        item.createdAt = now;
        try {
            item.payload = new JSONObject()
                    .put("transactionId", ind.transactionId)
                    .put("contentLocation", ind.contentLocation)
                    .put("from", ind.from)
                    .put("subId", subId)
                    .put("expiresAt", ind.expiresAtMillis(now));
        } catch (Exception error) {
            item.payload = new JSONObject();
        }
        db.insertIfAbsent(item);
        LocalDb.Item stored = db.find(id);
        if (stored != null && !downloading(stored, now)) start(context, stored, now);
    }

    /** 대기 중인 MMS를 다시 받는다. force면 백오프 중인 것도 바로 시도한다. */
    public static synchronized void retryDue(Context context, boolean force) {
        LocalDb db = LocalDb.get(context);
        long afterRowId = 0;
        while (true) {
            List<LocalDb.Item> page = db.page(LocalDb.KIND_MMS_NOTICE, LocalDb.STATE_PENDING, afterRowId, 20);
            if (page.isEmpty()) return;
            for (LocalDb.Item item : page) {
                afterRowId = item.rowId;
                long now = System.currentTimeMillis();
                if (now >= item.payload.optLong("expiresAt", Long.MAX_VALUE)) {
                    drop(context, item, "만료됨");
                    continue;
                }
                if (downloading(item, now)) continue;
                if (!force && item.nextAt > now) continue;
                start(context, item, now);
            }
        }
    }

    /** 다운로드 실패 또는 일시 오류(Retrieve-Status 0xC0~0xDF): 만료 전이면 백오프 뒤 다시 받는다. */
    static synchronized void retryLater(Context context, String transactionId, String error) {
        LocalDb db = LocalDb.get(context);
        LocalDb.Item item = db.find(noticeId(transactionId));
        if (item == null) return;
        long now = System.currentTimeMillis();
        if (now >= item.payload.optLong("expiresAt", Long.MAX_VALUE)) {
            drop(context, item, error);
            return;
        }
        item.payload.remove(DOWNLOADING_UNTIL);
        item.nextAt = now + SyncBackoff.delayMillis(item.attempts);
        item.lastError = error;
        db.update(item);
        SyncScheduler.scheduleRetry(context, item.nextAt - now);
    }

    /** 영구 오류(Retrieve-Status 0xE0 이상 등): 알리고 버린다. */
    static synchronized void giveUp(Context context, String transactionId, String error) {
        LocalDb.Item item = LocalDb.get(context).find(noticeId(transactionId));
        if (item != null) drop(context, item, error);
        else MessageNotifier.notifyMmsFailed(context, null);
    }

    /** 문자함 저장에 성공한 뒤에만 지운다. */
    static synchronized void stored(Context context, String transactionId) {
        LocalDb.get(context).delete(noticeId(transactionId));
    }

    private static boolean downloading(LocalDb.Item item, long now) {
        return item.payload.optLong(DOWNLOADING_UNTIL, 0) > now;
    }

    private static void start(Context context, LocalDb.Item item, long now) {
        LocalDb db = LocalDb.get(context);
        item.attempts++;
        item.nextAt = now + DOWNLOAD_TIMEOUT_MILLIS;
        try {
            item.payload.put(DOWNLOADING_UNTIL, now + DOWNLOAD_TIMEOUT_MILLIS);
        } catch (Exception ignored) { }
        db.update(item);
        try {
            MmsReceiver.download(context, item.payload.optString("transactionId"), item.payload.optString("contentLocation"),
                    item.payload.optString("from"), item.payload.optInt("subId", -1));
        } catch (Exception error) {
            android.util.Log.w("VoiceCAP", "MMS download request failed", error);
            item.payload.remove(DOWNLOADING_UNTIL);
            item.nextAt = now + SyncBackoff.delayMillis(item.attempts);
            item.lastError = "다운로드 요청 실패";
            db.update(item);
            SyncScheduler.scheduleRetry(context, item.nextAt - now);
        }
    }

    private static void drop(Context context, LocalDb.Item item, String reason) {
        android.util.Log.w("VoiceCAP", "MMS dropped: " + reason);
        MessageNotifier.notifyMmsFailed(context, item.payload.optString("from", null));
        LocalDb.get(context).delete(item.externalId);
    }
}
