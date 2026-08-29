package com.voicecap.sms;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.os.PersistableBundle;

public final class SyncScheduler {
    private static final int JOB_ID = 3217;
    private SyncScheduler() { }
    public static void schedule(Context context) {
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, SmsSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(15 * 60 * 1000L)
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }
}
