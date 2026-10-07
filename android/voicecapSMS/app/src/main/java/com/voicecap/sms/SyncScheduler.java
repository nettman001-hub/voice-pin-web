package com.voicecap.sms;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.os.PersistableBundle;

/**
 * 동기화 작업 예약. 대기 중인 업로드·MMS 다운로드는 sync_items의 next_at(백오프)으로 다시 시도하고,
 * 앱 열기·부팅·네트워크 복구 때는 백오프를 무시하고 바로 시도한다(force).
 */
public final class SyncScheduler {
    static final String EXTRA_FORCE = "force";

    private static final int PERIODIC_JOB_ID = 3217;
    private static final int IMMEDIATE_JOB_ID = 3218;
    private static final int RETRY_JOB_ID = 3219;
    private static final int FORCE_JOB_ID = 3220;
    private static final int NETWORK_JOB_ID = 3221;

    private SyncScheduler() { }

    public static void schedule(Context context) {
        JobInfo job = new JobInfo.Builder(PERIODIC_JOB_ID, new ComponentName(context, SmsSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(15 * 60 * 1000L)
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }

    /** 새 문자 수신·발송 결과 등: 30초 안에 한 번 동기화 (백오프 중인 항목은 기다림). */
    public static void scheduleNow(Context context) {
        scheduleNow(context, false);
    }

    /** @param force true면 앱 열기·부팅처럼 백오프 중인 항목도 바로 다시 시도한다. */
    public static void scheduleNow(Context context, boolean force) {
        JobInfo job = new JobInfo.Builder(force ? FORCE_JOB_ID : IMMEDIATE_JOB_ID, new ComponentName(context, SmsSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(0)
                .setOverrideDeadline(30 * 1000L)
                .setExtras(extras(force))
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }

    /** 가장 이른 백오프 시각에 다시 동기화한다. 그때 네트워크가 없으면 연결되는 즉시 실행된다. */
    public static void scheduleRetry(Context context, long delayMillis) {
        JobInfo job = new JobInfo.Builder(RETRY_JOB_ID, new ComponentName(context, SmsSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(Math.max(0, delayMillis))
                .setPersisted(true)
                .setExtras(extras(false))
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }

    /** 네트워크가 끊겨 있을 때: 다시 연결되는 즉시 백오프를 무시하고 동기화한다. */
    public static void scheduleOnNetworkRecovery(Context context) {
        JobInfo job = new JobInfo.Builder(NETWORK_JOB_ID, new ComponentName(context, SmsSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setExtras(extras(true))
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }

    private static PersistableBundle extras(boolean force) {
        PersistableBundle extras = new PersistableBundle();
        extras.putBoolean(EXTRA_FORCE, force);
        return extras;
    }
}
