package com.voicecap.sms;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** Required intent endpoint when the app is selected as the device SMS handler. */
public final class RespondViaMessageService extends Service {
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        stopSelf(startId);
        return START_NOT_STICKY;
    }
}
