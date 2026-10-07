package com.voicecap.sms;

import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.provider.BlockedNumberContract;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SmsReceiver extends BroadcastReceiver {
    static final String EXTRA_SUBSCRIPTION_INDEX = "android.telephony.extra.SUBSCRIPTION_INDEX";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_DELIVER_ACTION.equals(intent.getAction())) return;
        SmsMessage[] pdus = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (pdus == null || pdus.length == 0) return;
        List<SmsAssembler.Segment> segments = new ArrayList<>();
        String serviceCenter = null;
        for (SmsMessage pdu : pdus) {
            if (pdu == null) continue;
            segments.add(new SmsAssembler.Segment(pdu.getDisplayOriginatingAddress(), pdu.getDisplayMessageBody(), pdu.getTimestampMillis()));
            if (serviceCenter == null) serviceCenter = pdu.getServiceCenterAddress();
        }
        int subId = subscriptionId(intent);
        String finalServiceCenter = serviceCenter;
        Context app = context.getApplicationContext();
        // 기본 문자앱은 받은 문자를 직접 문자함에 저장해야 한다. 저장하지 않으면 문자가 사라진다.
        PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            try {
                for (SmsAssembler.Message message : SmsAssembler.assemble(segments)) {
                    store(app, message, subId, finalServiceCenter);
                    if (!isBlocked(app, message.address)) MessageNotifier.notifyIncoming(app, message.address, message.body);
                }
                SyncScheduler.scheduleNow(app);
            } finally {
                pending.finish();
            }
        });
    }

    static int subscriptionId(Intent intent) {
        int subId = intent.getIntExtra(EXTRA_SUBSCRIPTION_INDEX, -1);
        return subId >= 0 ? subId : intent.getIntExtra("subscription", -1);
    }

    private static void store(Context context, SmsAssembler.Message message, int subId, String serviceCenter) {
        ContentValues values = new ContentValues();
        values.put(Telephony.Sms.ADDRESS, message.address);
        values.put(Telephony.Sms.BODY, message.body);
        values.put(Telephony.Sms.DATE, System.currentTimeMillis());
        if (message.sentAtMillis > 0) values.put(Telephony.Sms.DATE_SENT, message.sentAtMillis);
        values.put(Telephony.Sms.READ, 0);
        values.put(Telephony.Sms.SEEN, 0);
        if (serviceCenter != null) values.put(Telephony.Sms.SERVICE_CENTER, serviceCenter);
        if (subId >= 0) values.put(Telephony.Sms.SUBSCRIPTION_ID, subId);
        try {
            context.getContentResolver().insert(Telephony.Sms.Inbox.CONTENT_URI, values);
        } catch (RuntimeException error) {
            android.util.Log.e("VoiceCAP", "SMS inbox insert failed", error);
        }
    }

    /** 차단 번호는 저장만 하고 알림·업로드는 하지 않는다. */
    static boolean isBlocked(Context context, String address) {
        if (address == null || address.isEmpty()) return false;
        try {
            return BlockedNumberContract.isBlocked(context, address);
        } catch (RuntimeException ignored) {
            return false;
        }
    }
}
