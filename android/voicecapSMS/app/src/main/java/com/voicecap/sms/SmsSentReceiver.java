package com.voicecap.sms;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Telephony;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 분할 문자 각 파트의 통신사 전송 결과를 모아 최종 SENT/FAILED를 확정한다. */
public final class SmsSentReceiver extends BroadcastReceiver {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override public void onReceive(Context context, Intent intent) {
        if (!SmsSender.ACTION_SENT.equals(intent.getAction())) return;
        String externalId = intent.getStringExtra(SmsSender.EXTRA_EXTERNAL_ID);
        if (externalId == null) return;
        boolean ok = getResultCode() == Activity.RESULT_OK;
        String error = ok ? null : "통신사 전송 실패 (코드 " + getResultCode() + ", errorCode " + intent.getIntExtra("errorCode", 0) + ")";
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            try {
                partResult(app, externalId, ok, error);
            } finally {
                pending.finish();
            }
        });
    }

    private static synchronized void partResult(Context context, String externalId, boolean ok, String error) {
        LocalDb db = LocalDb.get(context);
        LocalDb.Item item = db.find(externalId);
        if (item == null || !LocalDb.STATE_SENDING.equals(item.state)) return;
        try {
            int parts = item.payload.optInt("parts", 1);
            int done = item.payload.optInt("done") + (ok ? 1 : 0);
            int failed = item.payload.optInt("failed") + (ok ? 0 : 1);
            item.payload.put("done", done).put("failed", failed);
            if (error != null) item.payload.put("error", error);
            if (done + failed < parts) {
                db.update(item);
                return;
            }
        } catch (Exception ignored) { }
        db.update(item);
        finish(context, externalId, item.payload.optInt("failed") == 0, item.payload.optString("error", null));
    }

    /** 발송 결과를 문자함과 로컬 DB에 확정하고, 웹 발송분이면 서버 보고를 예약한다. */
    static synchronized void finish(Context context, String externalId, boolean sent, String error) {
        LocalDb db = LocalDb.get(context);
        LocalDb.Item item = db.find(externalId);
        if (item == null) return;
        if (item.providerUri != null) {
            ContentValues values = new ContentValues();
            values.put(Telephony.Sms.TYPE, sent ? Telephony.Sms.MESSAGE_TYPE_SENT : Telephony.Sms.MESSAGE_TYPE_FAILED);
            try {
                context.getContentResolver().update(Uri.parse(item.providerUri), values, null, null);
            } catch (RuntimeException ignored) { }
        }
        try {
            item.payload.put("status", sent ? "SENT" : "FAILED");
            if (error != null) item.payload.put("error", error);
        } catch (Exception ignored) { }
        if (LocalDb.ORIGIN_WEB.equals(item.origin)) {
            item.state = LocalDb.STATE_PENDING;
            item.nextAt = 0;
            db.update(item);
            SyncScheduler.scheduleNow(context);
        } else {
            // 폰에서 직접 보낸 문자: 업무 고객 번호에게 보낸 것만 outgoing으로 올린다 (개인 문자는 SKIPPED, 배지 없음).
            // 보낸편지함 기록이 없으면(문자함 id 없음) 서버에 올릴 원문도 없으므로 올리지 않는다.
            String phone = item.payload.optString("phone", "");
            boolean upload = item.providerUri != null && ConversationLogic.shouldUploadOutgoing(
                    item.origin, BusinessContactStore.contains(context, phone), SmsReceiver.isBlocked(context, phone));
            item.state = upload ? LocalDb.STATE_PENDING : LocalDb.STATE_SKIPPED;
            item.attempts = 0;
            item.nextAt = 0;
            db.update(item);
            if (upload) SyncScheduler.scheduleNow(context);
        }
        if (!sent) MessageNotifier.notifySendFailed(context, item.payload.optString("phone", ""));
    }
}
