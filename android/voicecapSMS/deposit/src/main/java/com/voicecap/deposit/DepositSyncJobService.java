package com.voicecap.deposit;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.util.concurrent.Executors;

public final class DepositSyncJobService extends JobService {
    @Override public boolean onStartJob(JobParameters params) {
        boolean force = params.getExtras().getBoolean(DepositSync.EXTRA_FORCE, false);
        Executors.newSingleThreadExecutor().execute(() -> { DepositSync.syncNow(getApplicationContext(), force); jobFinished(params, false); });
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}
