package com.voicecap.sms;

import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsManager;

import org.json.JSONObject;

import java.util.ArrayList;

/**
 * 모든 SMS 발송의 공통 경로: 보낸편지함에 먼저 기록하고, 통신사 결과(sentIntent)를 받아
 * {@link SmsSentReceiver}가 SENT/FAILED를 확정한다.
 */
public final class SmsSender {
    static final String ACTION_SENT = "com.voicecap.sms.SMS_SENT";
    static final String EXTRA_EXTERNAL_ID = "external_id";

    private SmsSender() { }

    public static String webExternalId(String serverMessageId) { return "web-out-" + serverMessageId; }

    /**
     * @param origin {@link LocalDb#ORIGIN_WEB}(웹 발송함) 또는 {@link LocalDb#ORIGIN_DEVICE}
     * @param serverMessageId 웹 발송분의 customer_messages.id, 기기 발송이면 null
     * @return sync_items의 external_id (웹: web-out-<id>, 폰: device-sms-sent-<문자함 id>)
     */
    public static String send(Context context, String phone, String body, int subId, String origin, String serverMessageId) throws Exception {
        if (phone == null || phone.trim().isEmpty()) throw new IllegalArgumentException("받는 번호가 없습니다.");
        if (body == null || body.isEmpty()) throw new IllegalArgumentException("보낼 내용이 없습니다.");
        SmsManager manager = smsManager(context, subId);
        ArrayList<String> parts = manager.divideMessage(body);
        Uri providerUri = recordOutbox(context, phone, body, subId);

        // 보낸편지함 기록에 실패하면(기본 문자앱 아님 등) 문자함 id가 없으므로 업로드할 수 없는 로컬 전용 id를 쓴다.
        String externalId = serverMessageId != null
                ? webExternalId(serverMessageId)
                : ConversationLogic.sentExternalId(providerUri != null ? providerUri.getLastPathSegment() : "local-" + System.currentTimeMillis());
        LocalDb.Item item = new LocalDb.Item();
        item.externalId = externalId;
        item.kind = LocalDb.KIND_SMS_OUT;
        item.origin = origin;
        item.serverId = serverMessageId;
        item.providerUri = providerUri == null ? null : providerUri.toString();
        item.payload = new JSONObject().put("phone", phone).put("parts", parts.size()).put("done", 0).put("failed", 0)
                .put("sentAt", System.currentTimeMillis());
        item.state = LocalDb.STATE_SENDING;
        LocalDb.get(context).insert(item);

        ArrayList<PendingIntent> sentIntents = new ArrayList<>();
        for (int index = 0; index < parts.size(); index++) {
            Intent intent = new Intent(context, SmsSentReceiver.class)
                    .setAction(ACTION_SENT)
                    .setData(Uri.parse("voicecap-sent://" + Uri.encode(externalId) + "/" + index))
                    .putExtra(EXTRA_EXTERNAL_ID, externalId);
            // 시스템이 결과 코드와 errorCode를 채워 넣으므로 수정 가능(MUTABLE)이어야 한다. 대상은 명시적 리시버다.
            sentIntents.add(PendingIntent.getBroadcast(context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0)));
        }
        try {
            manager.sendMultipartTextMessage(phone, null, parts, sentIntents, null);
        } catch (RuntimeException error) {
            SmsSentReceiver.finish(context, externalId, false, error.getMessage());
            throw error;
        }
        return externalId;
    }

    /**
     * 말풍선의 "전송 실패 · 다시 보내기": 실패한 보낸편지함 행을 지우고 같은 번호·내용으로 새로 보낸다.
     * 실패 기록이 서버에 이미 올라갔더라도 새 발송은 새 externalId로 따로 올라간다.
     */
    public static void resend(Context context, String providerUri, int subId) throws Exception {
        String phone;
        String body;
        try (android.database.Cursor cursor = context.getContentResolver().query(Uri.parse(providerUri),
                new String[]{Telephony.Sms.ADDRESS, Telephony.Sms.BODY}, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new IllegalStateException("다시 보낼 문자를 찾지 못했습니다.");
            phone = cursor.getString(0);
            body = cursor.getString(1);
        }
        send(context, phone, body, subId, LocalDb.ORIGIN_DEVICE, null);
        try {
            context.getContentResolver().delete(Uri.parse(providerUri), null, null);
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "failed SMS row delete failed", error);
        }
    }

    @SuppressWarnings("deprecation")
    static SmsManager smsManager(Context context, int subId) {
        if (subId < 0) return context.getSystemService(SmsManager.class);
        if (Build.VERSION.SDK_INT >= 31) return context.getSystemService(SmsManager.class).createForSubscriptionId(subId);
        return SmsManager.getSmsManagerForSubscriptionId(subId);
    }

    private static Uri recordOutbox(Context context, String phone, String body, int subId) {
        ContentValues values = new ContentValues();
        values.put(Telephony.Sms.ADDRESS, phone);
        values.put(Telephony.Sms.BODY, body);
        values.put(Telephony.Sms.DATE, System.currentTimeMillis());
        values.put(Telephony.Sms.READ, 1);
        values.put(Telephony.Sms.SEEN, 1);
        if (subId >= 0) values.put(Telephony.Sms.SUBSCRIPTION_ID, subId);
        try {
            return context.getContentResolver().insert(Telephony.Sms.Outbox.CONTENT_URI, values);
        } catch (RuntimeException error) {
            android.util.Log.e("VoiceCAP", "SMS outbox insert failed", error);
            return null;
        }
    }
}
