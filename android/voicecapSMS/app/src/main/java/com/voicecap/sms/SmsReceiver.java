package com.voicecap.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.util.concurrent.Executors;

public final class SmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        final Context appContext = context.getApplicationContext();
        Executors.newSingleThreadExecutor().execute(() -> {
            try { SmsSyncManager.syncRecentSms(appContext); } finally { pending.finish(); }
        });
    }
}
