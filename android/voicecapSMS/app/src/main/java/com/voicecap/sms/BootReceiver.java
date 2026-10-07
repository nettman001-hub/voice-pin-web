package com.voicecap.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            SyncScheduler.schedule(context.getApplicationContext());
            // 재부팅 전에 남은 업로드·MMS 다운로드를 바로 이어서 처리한다.
            SyncScheduler.scheduleNow(context.getApplicationContext(), true);
        }
    }
}
