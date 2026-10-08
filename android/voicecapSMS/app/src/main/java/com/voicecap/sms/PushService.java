package com.voicecap.sms;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * 웹이 문자를 대기열에 넣으면 서버가 내용 없는 고우선순위 데이터 메시지(data.type=OUTBOX)를 보낸다.
 * 받으면 바로 outbox-claim → 발송한다. 고우선순위 처리 시간(약 20초) 안에 못 끝내면 기존 동기화 Job으로 넘긴다.
 */
public final class PushService extends FirebaseMessagingService {
    private static final long INLINE_LIMIT_SECONDS = 15;
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();

    @Override
    public void onNewToken(String token) {
        PushRegistration.onNewToken(getApplicationContext(), token);
        // 서버 등록은 동기화 Job에서 (네트워크·백오프 처리 공통).
        SyncScheduler.scheduleNow(getApplicationContext());
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        if (!PushLogic.isOutboxMessage(message.getData())) return;
        android.content.Context context = getApplicationContext();
        Future<Integer> work = WORKER.submit(() -> SmsSyncManager.sendOutboxIfAllowed(context));
        try {
            work.get(INLINE_LIMIT_SECONDS, TimeUnit.SECONDS);
        } catch (Exception timeoutOrError) {
            // 다른 동기화가 오래 걸리는 중이거나 네트워크가 느리다. 남은 일은 Job이 이어서 한다.
            SyncScheduler.scheduleNow(context);
        }
    }
}
