package com.voicecap.sms;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsManager;

import java.io.File;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** MMS 도착 알림(WAP Push)을 받아 본문 다운로드를 요청한다. 기본 문자앱이 하지 않으면 MMS가 도착하지 않는다. */
public final class MmsReceiver extends BroadcastReceiver {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.WAP_PUSH_DELIVER_ACTION.equals(intent.getAction())) return;
        MmsPdu.NotificationInd ind = MmsPdu.parseNotificationInd(intent.getByteArrayExtra("data"));
        if (ind == null) return;
        int subId = SmsReceiver.subscriptionId(intent);
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            try {
                if (MmsStore.existsByTransactionId(app, ind.transactionId)) return;
                download(app, ind, subId);
            } catch (Exception error) {
                android.util.Log.e("VoiceCAP", "MMS download request failed", error);
                MessageNotifier.notifyMmsFailed(app, ind.from);
            } finally {
                pending.finish();
            }
        });
    }

    @SuppressWarnings("deprecation")
    static void download(Context context, MmsPdu.NotificationInd ind, int subId) throws Exception {
        MmsFileProvider.cleanup(context);
        File file = new File(MmsFileProvider.directory(context), "dl-" + UUID.randomUUID() + ".pdu");
        if (!file.createNewFile()) throw new IllegalStateException("cannot create mms file");
        Intent result = new Intent(context, MmsDownloadReceiver.class)
                .setAction(MmsDownloadReceiver.ACTION_DOWNLOADED)
                .putExtra(MmsDownloadReceiver.EXTRA_FILE, file.getName())
                .putExtra(MmsDownloadReceiver.EXTRA_TRANSACTION_ID, ind.transactionId)
                .putExtra(MmsDownloadReceiver.EXTRA_CONTENT_LOCATION, ind.contentLocation)
                .putExtra(MmsDownloadReceiver.EXTRA_FROM, ind.from)
                .putExtra(MmsDownloadReceiver.EXTRA_SUB_ID, subId);
        PendingIntent downloaded = PendingIntent.getBroadcast(context, file.getName().hashCode(), result,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0));
        SmsManager manager = subId < 0 ? context.getSystemService(SmsManager.class)
                : Build.VERSION.SDK_INT >= 31 ? context.getSystemService(SmsManager.class).createForSubscriptionId(subId)
                : SmsManager.getSmsManagerForSubscriptionId(subId);
        manager.downloadMultimediaMessage(context, ind.contentLocation, MmsFileProvider.uriFor(context, file), null, downloaded);
    }
}
