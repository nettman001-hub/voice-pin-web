package com.voicecap.sms;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
public final class SyncScheduler {
    private static final int PERIODIC_JOB_ID = 3217;
    private static final int IMMEDIATE_JOB_ID = 3218;
    private SyncScheduler() { }
    public static void schedule(Context context) {
        JobInfo job = new JobInfo.Builder(PERIODIC_JOB_ID, new ComponentName(context, SmsSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(15 * 60 * 1000L)
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }

    public static void scheduleNow(Context context) {
        JobInfo job = new JobInfo.Builder(IMMEDIATE_JOB_ID, new ComponentName(context, SmsSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(0)
                .setOverrideDeadline(30 * 1000L)
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }
}
