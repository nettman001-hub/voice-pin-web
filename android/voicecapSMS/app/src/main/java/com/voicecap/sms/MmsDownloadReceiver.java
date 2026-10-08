package com.voicecap.sms;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.telephony.SmsManager;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MMS 다운로드 완료 → PDU 해석 → Retrieve-Status 확인 → 문자함 저장 → 수신 확인 → 알림 → 업로드 큐.
 * 실패하면 {@link MmsDownloads}가 만료 전까지 다시 받거나(일시 오류) 알리고 버린다(영구 오류).
 */
public final class MmsDownloadReceiver extends BroadcastReceiver {
    static final String ACTION_DOWNLOADED = "com.voicecap.sms.MMS_DOWNLOADED";
    static final String EXTRA_FILE = "file";
    static final String EXTRA_TRANSACTION_ID = "transaction_id";
    static final String EXTRA_CONTENT_LOCATION = "content_location";
    static final String EXTRA_FROM = "from";
    static final String EXTRA_SUB_ID = "sub_id";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override public void onReceive(Context context, Intent intent) {
        if (!ACTION_DOWNLOADED.equals(intent.getAction())) return;
        int resultCode = getResultCode();
        boolean ok = resultCode == Activity.RESULT_OK;
        String fileName = intent.getStringExtra(EXTRA_FILE);
        // 수신 확인·중복 판정은 항상 알림(m-notification-ind)의 transaction id로 한다 (AOSP NotificationTransaction과 같음).
        String notificationTransactionId = intent.getStringExtra(EXTRA_TRANSACTION_ID);
        String contentLocation = intent.getStringExtra(EXTRA_CONTENT_LOCATION);
        String from = intent.getStringExtra(EXTRA_FROM);
        int subId = intent.getIntExtra(EXTRA_SUB_ID, -1);
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            File file = fileName == null ? null : new File(MmsFileProvider.directory(app), fileName);
            String noticeTransactionId = notificationTransactionId == null ? "" : notificationTransactionId;
            try {
                MmsPdu.RetrieveConf conf = null;
                if (ok && file != null && file.length() > 0) conf = MmsPdu.parseRetrieveConf(Files.readAllBytes(file.toPath()));
                if (conf == null) {
                    android.util.Log.w("VoiceCAP", "MMS download failed, result=" + resultCode);
                    MmsDownloads.retryLater(app, noticeTransactionId, "다운로드 실패 (결과 " + resultCode + ")");
                    return;
                }
                String status = "Retrieve-Status 0x" + Integer.toHexString(conf.retrieveStatus);
                MmsPdu.RetrieveOutcome outcome = MmsPdu.retrieveOutcome(conf.retrieveStatus);
                if (outcome == MmsPdu.RetrieveOutcome.RETRY) {
                    MmsDownloads.retryLater(app, noticeTransactionId, "통신사 일시 오류 (" + status + ")");
                    return;
                }
                if (outcome == MmsPdu.RetrieveOutcome.DROP) {
                    MmsDownloads.giveUp(app, noticeTransactionId, "통신사 오류 (" + status + ")");
                    return;
                }
                conf.transactionId = MmsPdu.resolveTransactionId(notificationTransactionId, conf.transactionId);
                if (conf.from.isEmpty() && from != null) conf.from = from;
                if (!MmsStore.existsByTransactionId(app, conf.transactionId)) {
                    Uri uri = MmsStore.insertInbox(app, conf, contentLocation, subId);
                    String preview = conf.bodyText();
                    UploadQueue.enqueueIncoming(app, LocalDb.KIND_MMS_IN, ContentUris.parseId(uri), conf.from, preview, System.currentTimeMillis());
                    if (!SmsReceiver.isBlocked(app, conf.from)) {
                        MessageNotifier.notifyIncoming(app, conf.from, preview.isEmpty() ? "(사진 문자)" : preview, subId);
                    }
                }
                MmsDownloads.stored(app, noticeTransactionId);
                acknowledge(app, conf.transactionId, subId);
                SyncScheduler.scheduleNow(app);
            } catch (Exception error) {
                android.util.Log.e("VoiceCAP", "MMS store failed", error);
                MmsDownloads.retryLater(app, noticeTransactionId, "문자함 저장 실패");
            } finally {
                if (file != null && file.exists() && !file.delete()) android.util.Log.w("VoiceCAP", "mms file not deleted");
                pending.finish();
            }
        });
    }

    /**
     * m-notifyresp-ind(Retrieved) 전송. 문자함 저장에 성공했을 때만 보낸다. 실패해도 저장에는 영향 없음
     * (통신사가 알림을 다시 보내면 transaction id로 중복 저장을 막고 확인을 다시 보낸다).
     */
    @SuppressWarnings("deprecation")
    static void acknowledge(Context context, String transactionId, int subId) {
        if (transactionId == null || transactionId.isEmpty()) return;
        try {
            File file = new File(MmsFileProvider.directory(context), "ack-" + UUID.randomUUID() + ".pdu");
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(MmsPdu.buildNotifyRespInd(transactionId));
            }
            SmsManager manager = subId < 0 ? context.getSystemService(SmsManager.class)
                    : Build.VERSION.SDK_INT >= 31 ? context.getSystemService(SmsManager.class).createForSubscriptionId(subId)
                    : SmsManager.getSmsManagerForSubscriptionId(subId);
            manager.sendMultimediaMessage(context, MmsFileProvider.uriFor(context, file), null, null, null);
        } catch (Exception error) {
            android.util.Log.w("VoiceCAP", "MMS acknowledge failed", error);
        }
    }
}
