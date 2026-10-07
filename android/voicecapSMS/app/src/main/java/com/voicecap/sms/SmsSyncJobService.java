package com.voicecap.sms;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.util.concurrent.Executors;

public final class SmsSyncJobService extends JobService {
    @Override public boolean onStartJob(JobParameters params) {
        boolean force = params.getExtras().getBoolean(SyncScheduler.EXTRA_FORCE, false);
        Executors.newSingleThreadExecutor().execute(() -> { SmsSyncManager.syncNow(getApplicationContext(), force); jobFinished(params, false); });
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}
