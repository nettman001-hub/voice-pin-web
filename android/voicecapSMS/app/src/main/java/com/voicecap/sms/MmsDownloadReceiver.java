package com.voicecap.sms;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.telephony.SmsManager;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** MMS 다운로드 완료 → PDU 해석 → 문자함 저장 → 수신 확인 → 알림 → 동기화 예약. */
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
        boolean ok = getResultCode() == Activity.RESULT_OK;
        String fileName = intent.getStringExtra(EXTRA_FILE);
        String transactionId = intent.getStringExtra(EXTRA_TRANSACTION_ID);
        String contentLocation = intent.getStringExtra(EXTRA_CONTENT_LOCATION);
        String from = intent.getStringExtra(EXTRA_FROM);
        int subId = intent.getIntExtra(EXTRA_SUB_ID, -1);
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            File file = fileName == null ? null : new File(MmsFileProvider.directory(app), fileName);
            try {
                MmsPdu.RetrieveConf conf = null;
                if (ok && file != null && file.length() > 0) conf = MmsPdu.parseRetrieveConf(Files.readAllBytes(file.toPath()));
                if (conf == null) {
                    android.util.Log.w("VoiceCAP", "MMS download failed, result=" + ok);
                    MessageNotifier.notifyMmsFailed(app, from);
                    return;
                }
                if (conf.transactionId.isEmpty() && transactionId != null) conf.transactionId = transactionId;
                if (conf.from.isEmpty() && from != null) conf.from = from;
                if (!MmsStore.existsByTransactionId(app, conf.transactionId)) {
                    MmsStore.insertInbox(app, conf, contentLocation, subId);
                    if (!SmsReceiver.isBlocked(app, conf.from)) {
                        String preview = conf.bodyText();
                        MessageNotifier.notifyIncoming(app, conf.from, preview.isEmpty() ? "(사진 문자)" : preview);
                    }
                }
                acknowledge(app, conf.transactionId, subId);
                SyncScheduler.scheduleNow(app);
            } catch (Exception error) {
                android.util.Log.e("VoiceCAP", "MMS store failed", error);
                MessageNotifier.notifyMmsFailed(app, from);
            } finally {
                if (file != null && file.exists() && !file.delete()) android.util.Log.w("VoiceCAP", "mms file not deleted");
                pending.finish();
            }
        });
    }

    /** m-notifyresp-ind 전송. 실패해도 MMS 저장에는 영향 없음 (통신사가 알림을 다시 보낼 수 있으나 tr_id로 중복 저장 방지). */
    @SuppressWarnings("deprecation")
    private static void acknowledge(Context context, String transactionId, int subId) {
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
