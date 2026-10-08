package com.voicecap.sms.deposit;

import android.content.Context;
import android.util.Log;

import com.voicecap.sms.LocalDb;
import com.voicecap.sms.SyncScheduler;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** 고른 은행앱의 알림 한 건을 파싱해 입금 피드·업로드 큐에 넣는다. */
public final class DepositRecorder {
    public static final String SOURCE_NOTIFICATION = "NOTIFICATION";
    public static final String SOURCE_SMS = "SMS";
    private static final String TAG = "VoiceCAP";
    private static BankRules rules;

    private DepositRecorder() { }

    /** assets/bank_rules.json. 읽지 못하면 규칙 0개 (아무것도 올리지 않음). */
    public static synchronized BankRules rules(Context context) {
        if (rules != null) return rules;
        try (InputStream input = context.getAssets().open("bank_rules.json")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            rules = BankRules.parse(new String(output.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception error) {
            Log.e(TAG, "bank_rules.json을 읽지 못함", error);
            try {
                rules = BankRules.parse("{\"version\":0,\"rules\":[]}");
            } catch (Exception impossible) {
                throw new IllegalStateException(impossible);
            }
        }
        return rules;
    }

    static void handle(Context context, String packageName, List<CharSequence> parts, long postTime) {
        try {
            String text = DepositParser.joinParts(parts);
            if (text.isEmpty()) return;
            DepositParser.Result result = new DepositParser(rules(context)).parse(packageName, text, postTime);
            LocalDb db = LocalDb.get(context);
            if (DepositSettings.sampleMode(context)) {
                long now = System.currentTimeMillis();
                db.purgeSamplesBefore(now - DepositSettings.SAMPLE_RETENTION_MILLIS);
                db.insertSample(packageName, text, SampleMasker.mask(text, result.ok() ? result.deposit.payerName : null), now);
            }
            if (!result.ok()) {
                DepositSettings.countFailure(context, packageName);
                return;
            }
            if (record(context, result.deposit, SOURCE_NOTIFICATION)) SyncScheduler.scheduleNow(context);
        } catch (RuntimeException error) {
            Log.w(TAG, "은행 알림 처리 실패", error);
        }
    }

    /**
     * 새 입금이면 true. 같은 externalId이거나 (잔액 없는 은행) 90초 창 안의 같은 입금이면 false.
     * @param source {@link #SOURCE_NOTIFICATION}(banknoti: id) 또는 {@link #SOURCE_SMS}(banksms: id)
     */
    static boolean record(Context context, DepositParser.Deposit deposit, String source) {
        String externalId = SOURCE_SMS.equals(source) ? DepositIds.smsExternalId(deposit) : DepositIds.externalId(deposit);
        LocalDb.DepositRow row = new LocalDb.DepositRow();
        row.externalId = externalId;
        row.packageName = deposit.packageName;
        row.bank = deposit.bank;
        row.payer = deposit.payerName;
        row.amount = deposit.amount;
        row.balance = deposit.balance;
        row.paidAt = deposit.postTime;
        row.source = source;

        LocalDb.Item item = new LocalDb.Item();
        item.externalId = externalId;
        item.kind = LocalDb.KIND_PAYMENT;
        item.origin = LocalDb.ORIGIN_DEVICE;
        item.state = LocalDb.STATE_PENDING;
        item.payload = new JSONObject();
        try {
            // 서버로 가는 값은 이것뿐이다. 알림·문자 원문과 잔액은 넣지 않는다.
            item.payload.put("amount", deposit.amount)
                    .put("payerName", deposit.payerName)
                    .put("paidAt", deposit.postTime)
                    .put("bank", deposit.bank)
                    .put("source", source);
            if (deposit.receiverName != null) item.payload.put("receiverName", deposit.receiverName);
        } catch (Exception ignored) { }
        return LocalDb.get(context).recordDeposit(row, item, DepositIds.usesDuplicateWindow(deposit), DepositIds.DUPLICATE_WINDOW_MILLIS);
    }
}
