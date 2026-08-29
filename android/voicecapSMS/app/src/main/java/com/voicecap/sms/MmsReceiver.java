package com.voicecap.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.util.concurrent.Executors;

public final class MmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        Context appContext = context.getApplicationContext();
        Executors.newSingleThreadExecutor().execute(() -> {
            try { SmsSyncManager.syncRecentMms(appContext); } finally { pending.finish(); }
        });
    }
}
