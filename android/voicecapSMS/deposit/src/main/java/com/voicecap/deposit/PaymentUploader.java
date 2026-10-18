package com.voicecap.deposit;

import android.content.Context;

import java.util.List;

/** sync_items의 PAYMENT 행을 payment-incoming으로 올린다. 다른 업로드와 같은 백오프·배지를 쓴다. */
public final class PaymentUploader {
    private static final int PAGE_SIZE = 50;
    private static final int MAX_CONSECUTIVE_RETRIES = 3;

    private PaymentUploader() { }

    /** 올린 건수. force면 백오프 중인 행도 바로 시도한다. */
    public static int uploadPending(Context context, boolean force) {
        DepositDb db = DepositDb.get(context);
        int uploaded = 0;
        int consecutiveRetries = 0;
        long afterRowId = 0;
        while (true) {
            List<DepositDb.Item> page = db.page(DepositDb.KIND_PAYMENT, DepositDb.STATE_PENDING, afterRowId, PAGE_SIZE);
            if (page.isEmpty()) return uploaded;
            for (DepositDb.Item item : page) {
                afterRowId = item.rowId;
                long now = System.currentTimeMillis();
                if (!force && item.nextAt > now) continue;
                DeviceLink.PaymentReport report = DeviceLink.postPayment(context, item.externalId,
                        item.payload.optLong("amount"), item.payload.optString("payerName", DepositParser.UNKNOWN_PAYER),
                        item.payload.optLong("paidAt", item.createdAt),
                        item.payload.has("receiverName") ? item.payload.optString("receiverName") : null,
                        item.payload.optString("bank", null), item.payload.optString("source", DepositRecorder.SOURCE_NOTIFICATION));
                if (report.result == DeviceLink.ReportResult.REPORTED) {
                    item.state = DepositDb.STATE_SYNCED;
                    item.lastError = null;
                    uploaded++;
                    consecutiveRetries = 0;
                    if (report.matchStatus != null && !report.matchStatus.isEmpty()) db.setDepositMatch(item.externalId, report.matchStatus);
                } else if (report.result == DeviceLink.ReportResult.RETRY) {
                    item.attempts++;
                    item.nextAt = now + SyncBackoff.delayMillis(item.attempts);
                    item.lastError = "업로드 실패 (네트워크·서버), 다시 시도 예정";
                    consecutiveRetries++;
                } else {
                    item.state = DepositDb.STATE_FAILED;
                    item.lastError = "서버가 입금 업로드를 거절함";
                    consecutiveRetries = 0;
                }
                db.update(item);
                if (consecutiveRetries >= MAX_CONSECUTIVE_RETRIES) return uploaded;
            }
        }
    }
}
