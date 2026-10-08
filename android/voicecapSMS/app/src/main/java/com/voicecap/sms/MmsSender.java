package com.voicecap.sms;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.telephony.SmsManager;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.security.SecureRandom;
import java.util.List;

/**
 * 사진 문자(MMS) 발송: m-send-req PDU 조립 → 보낸편지함(content://mms, OUTBOX) 기록 → 앱 내부 저장소의 PDU 파일을
 * {@link MmsFileProvider}로 넘겨 {@link SmsManager#sendMultimediaMessage} → 결과(sentIntent)는 {@link SmsSentReceiver}가
 * 보냄/실패로 확정한다. 받는 사람이 여러 명이면 호출한 쪽이 한 명씩 따로 부른다 (그룹 MMS 아님).
 */
public final class MmsSender {
    static final String ACTION_MMS_SENT = "com.voicecap.sms.MMS_SENT";
    static final String EXTRA_PDU_FILE = "pdu_file";
    private static final SecureRandom RANDOM = new SecureRandom();

    /** recorded=false면 보내기는 했지만 휴대폰 문자함에 기록하지 못했다 (대화에 안 보일 수 있음, 업로드 안 함). */
    public static final class Result {
        public final String externalId;
        public final boolean recorded;

        Result(String externalId, boolean recorded) {
            this.externalId = externalId;
            this.recorded = recorded;
        }
    }

    private MmsSender() { }

    /**
     * @param jpegImages {@link MmsImages#prepare}로 줄인 사진
     */
    public static Result send(Context context, String phone, String text, List<byte[]> jpegImages, int subId) throws Exception {
        MmsOutgoing message = MmsOutgoing.create(phone, text, jpegImages);
        long now = System.currentTimeMillis();
        String transactionId = MmsOutgoing.newTransactionId(now, RANDOM);
        byte[] pdu = message.toPdu(now / 1000L, transactionId);
        int maxBytes = MmsImages.maxMessageBytes(context, subId);
        if (pdu.length > maxBytes) throw new IllegalArgumentException("사진 문자가 통신사 한도(" + (maxBytes / 1024) + "KB)보다 큽니다.");
        SmsManager manager = SmsSender.smsManager(context, subId);

        Uri providerUri;
        try {
            providerUri = MmsStore.insertOutbox(context, message, transactionId, subId, now);
        } catch (Exception error) {
            android.util.Log.e("VoiceCAP", "MMS outbox insert failed", error);
            providerUri = null;
        }
        // 보낸편지함 기록에 실패하면 문자함 id가 없으므로 업로드할 수 없는 로컬 전용 id를 쓴다 (SMS와 같은 규칙).
        String externalId = ConversationLogic.mmsSentExternalId(providerUri != null ? providerUri.getLastPathSegment() : "local-" + now);
        LocalDb.Item item = new LocalDb.Item();
        item.externalId = externalId;
        item.kind = LocalDb.KIND_MMS_OUT;
        item.origin = LocalDb.ORIGIN_DEVICE;
        item.providerUri = providerUri == null ? null : providerUri.toString();
        item.payload = new JSONObject().put("phone", message.to).put("images", message.imageCount()).put("sentAt", now);
        item.state = LocalDb.STATE_SENDING;
        LocalDb.get(context).insert(item);

        File file = new File(MmsFileProvider.directory(context), "send-" + transactionId + ".pdu");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(pdu);
        }
        Intent intent = new Intent(context, SmsSentReceiver.class)
                .setAction(ACTION_MMS_SENT)
                .setData(Uri.parse("voicecap-mms-sent://" + Uri.encode(externalId)))
                .putExtra(SmsSender.EXTRA_EXTERNAL_ID, externalId)
                .putExtra(EXTRA_PDU_FILE, file.getName());
        // 시스템이 결과 코드와 EXTRA_MMS_DATA(m-send-conf)를 채워 넣으므로 수정 가능(MUTABLE)이어야 한다. 대상은 명시적 리시버다.
        PendingIntent sentIntent = PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0));
        try {
            manager.sendMultimediaMessage(context, MmsFileProvider.uriFor(context, file), null, null, sentIntent);
        } catch (RuntimeException error) {
            deletePduFile(context, file.getName());
            SmsSentReceiver.finish(context, externalId, false, error.getMessage());
            throw error;
        }
        return new Result(externalId, providerUri != null);
    }

    static void deletePduFile(Context context, String name) {
        if (name == null || !name.matches("[A-Za-z0-9._-]+")) return;
        File file = new File(MmsFileProvider.directory(context), name);
        if (file.exists() && !file.delete()) android.util.Log.w("VoiceCAP", "sent MMS pdu not deleted");
    }
}
