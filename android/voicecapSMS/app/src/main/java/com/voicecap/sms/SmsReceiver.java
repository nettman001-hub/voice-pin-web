package com.voicecap.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;

public final class SmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_DELIVER_ACTION.equals(intent.getAction())) return;
        // Android 8.0+에서는 브로드캐스트 수신기에서 긴 네트워크 작업을 실행하지 않는다.
        SyncScheduler.scheduleNow(context.getApplicationContext());
    }
}
