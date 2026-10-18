package com.voicecap.deposit;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.PersistableBundle;

/**
 * 입금 업로드와 그 예약. 문자 앱의 SmsSyncManager·SyncScheduler에서 입금 부분만 옮겼다.
 * 대기 중인 업로드는 sync_items의 next_at(백오프)으로 다시 시도하고, 앱 열기·부팅·네트워크 복구 때는 바로 시도한다(force).
 */
public final class DepositSync {
    static final String EXTRA_FORCE = "force";

    private static final int PERIODIC_JOB_ID = 4217;
    private static final int IMMEDIATE_JOB_ID = 4218;
    private static final int RETRY_JOB_ID = 4219;
    private static final int FORCE_JOB_ID = 4220;
    private static final int NETWORK_JOB_ID = 4221;

    private DepositSync() { }

    /** @param force true면 앱 열기·부팅·네트워크 복구처럼 백오프를 무시하고 바로 다시 시도한다. */
    public static synchronized String syncNow(Context context, boolean force) {
        try {
            if (!isOnline(context)) {
                scheduleOnNetworkRecovery(context);
                return "네트워크 연결이 없어 연결되는 즉시 다시 시도합니다.";
            }
            if (!DeviceLink.configured(context)) return "웹앱과 연결되지 않아 입금을 휴대폰에만 쌓아 둡니다.";
            if (!DepositSettings.hasConsent(context)) return "입금 정보 전송 동의가 필요합니다.";
            return "입금 " + PaymentUploader.uploadPending(context, force) + "건 업로드";
        } finally {
            scheduleNextRetry(context);
        }
    }

    /** 백오프 중인 항목이 있으면 가장 이른 시각에 다시 동기화한다. */
    private static void scheduleNextRetry(Context context) {
        long now = System.currentTimeMillis();
        long next = DepositDb.get(context).nextRetryAt(now);
        if (next > 0) scheduleRetry(context, next - now);
    }

    static boolean isOnline(Context context) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        if (manager == null) return true;
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /** 15분마다 남은 업로드를 다시 시도한다. */
    public static void schedule(Context context) {
        JobInfo job = new JobInfo.Builder(PERIODIC_JOB_ID, new ComponentName(context, DepositSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(15 * 60 * 1000L)
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }

    /** 새 입금 기록 등: 30초 안에 한 번 올린다 (백오프 중인 항목은 기다림). */
    public static void scheduleNow(Context context) {
        scheduleNow(context, false);
    }

    /** @param force true면 앱 열기·부팅처럼 백오프 중인 항목도 바로 다시 시도한다. */
    public static void scheduleNow(Context context, boolean force) {
        JobInfo job = new JobInfo.Builder(force ? FORCE_JOB_ID : IMMEDIATE_JOB_ID, new ComponentName(context, DepositSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(0)
                .setOverrideDeadline(30 * 1000L)
                .setExtras(extras(force))
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }

    /** 가장 이른 백오프 시각에 다시 올린다. 그때 네트워크가 없으면 연결되는 즉시 실행된다. */
    public static void scheduleRetry(Context context, long delayMillis) {
        JobInfo job = new JobInfo.Builder(RETRY_JOB_ID, new ComponentName(context, DepositSyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(Math.max(0, delayMillis))
                .setPersisted(true)
                .setExtras(extras(false))
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }

    /** 네트워크가 끊겨 있을 때: 다시 연결되는 즉시 백오프를 무시하고 올린다. */
    public static void scheduleOnNetworkRecovery(Context context) {
        JobInfo job = new JobInfo.Builder(NETWORK_JOB_ID, new ComponentName(context, DepositSyncJobService.class))
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
