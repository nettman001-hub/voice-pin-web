package com.voicecap.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class MmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        // MMS 이미지 읽기와 업로드는 Android 8.0의 백그라운드 제한을 지키도록 JobService에서 처리한다.
        SyncScheduler.scheduleNow(context.getApplicationContext());
    }
}
