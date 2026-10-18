package com.voicecap.deposit;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            DepositSync.schedule(context.getApplicationContext());
            // 재부팅 전에 남은 입금 업로드를 바로 이어서 처리한다.
            DepositSync.scheduleNow(context.getApplicationContext(), true);
        }
    }
}
