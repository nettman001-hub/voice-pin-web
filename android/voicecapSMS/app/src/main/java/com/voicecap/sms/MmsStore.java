package com.voicecap.sms;

import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;

import java.io.OutputStream;
import java.util.HashSet;
import java.util.Set;

/** 해석한 MMS를 시스템 문자함(Telephony.Mms)에 저장한다. */
public final class MmsStore {
    private static final int ADDRESS_FROM = 137;
    private static final int ADDRESS_TO = 151;
    private static final int CHARSET_UTF8 = 106;

    private MmsStore() { }

    public static boolean existsByTransactionId(Context context, String transactionId) {
        if (transactionId == null || transactionId.isEmpty()) return false;
        try (Cursor cursor = context.getContentResolver().query(Telephony.Mms.CONTENT_URI, new String[]{Telephony.Mms._ID},
                Telephony.Mms.TRANSACTION_ID + "=?", new String[]{transactionId}, null)) {
            return cursor != null && cursor.moveToFirst();
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    public static Uri insertInbox(Context context, MmsPdu.RetrieveConf conf, String contentLocation, int subId) throws Exception {
        Set<String> recipients = new HashSet<>();
        if (!conf.from.isEmpty()) recipients.add(conf.from);
        long threadId = Telephony.Threads.getOrCreateThreadId(context, recipients.isEmpty() ? java.util.Collections.singleton("unknown") : recipients);

        long nowSeconds = System.currentTimeMillis() / 1000L;
        ContentValues values = new ContentValues();
        values.put(Telephony.Mms.THREAD_ID, threadId);
        values.put(Telephony.Mms.DATE, nowSeconds);
        values.put(Telephony.Mms.DATE_SENT, conf.dateSeconds > 0 ? conf.dateSeconds : nowSeconds);
        values.put(Telephony.Mms.MESSAGE_BOX, Telephony.Mms.MESSAGE_BOX_INBOX);
        values.put(Telephony.Mms.READ, 0);
        values.put(Telephony.Mms.SEEN, 0);
        values.put(Telephony.Mms.MESSAGE_TYPE, MmsPdu.TYPE_RETRIEVE_CONF);
        values.put(Telephony.Mms.MMS_VERSION, conf.mmsVersion);
        values.put(Telephony.Mms.CONTENT_TYPE, conf.contentType);
        values.put(Telephony.Mms.TRANSACTION_ID, conf.transactionId);
        values.put(Telephony.Mms.MESSAGE_ID, conf.messageId);
        if (contentLocation != null) values.put(Telephony.Mms.CONTENT_LOCATION, contentLocation);
        if (!conf.subject.isEmpty()) {
            values.put(Telephony.Mms.SUBJECT, conf.subject);
            values.put(Telephony.Mms.SUBJECT_CHARSET, CHARSET_UTF8);
        }
        if (subId >= 0) values.put(Telephony.Mms.SUBSCRIPTION_ID, subId);
        Uri messageUri = context.getContentResolver().insert(Telephony.Mms.Inbox.CONTENT_URI, values);
        if (messageUri == null) throw new IllegalStateException("MMS insert failed");
        long messageId = ContentUris.parseId(messageUri);

        Uri addrUri = Uri.parse("content://mms/" + messageId + "/addr");
        insertAddress(context, addrUri, conf.from, ADDRESS_FROM);
        for (String to : conf.to) insertAddress(context, addrUri, to, ADDRESS_TO);

        Uri partsUri = Uri.parse("content://mms/" + messageId + "/part");
        int seq = 0;
        for (MmsPdu.Part part : conf.parts) {
            ContentValues partValues = new ContentValues();
            partValues.put(Telephony.Mms.Part.MSG_ID, messageId);
            partValues.put(Telephony.Mms.Part.SEQ, "application/smil".equals(part.contentType) ? -1 : seq++);
            partValues.put(Telephony.Mms.Part.CONTENT_TYPE, part.contentType);
            if (!part.name.isEmpty()) partValues.put(Telephony.Mms.Part.NAME, part.name);
            if (!part.contentId.isEmpty()) partValues.put(Telephony.Mms.Part.CONTENT_ID, "<" + part.contentId + ">");
            if (!part.contentLocation.isEmpty()) partValues.put(Telephony.Mms.Part.CONTENT_LOCATION, part.contentLocation);
            if (part.isText()) {
                // 문자셋을 해석해 UTF-8 텍스트로 저장한다 (EUC-KR 등 국내 통신사 대응).
                partValues.put(Telephony.Mms.Part.CHARSET, CHARSET_UTF8);
                partValues.put(Telephony.Mms.Part.TEXT, part.text());
                context.getContentResolver().insert(partsUri, partValues);
            } else {
                Uri partUri = context.getContentResolver().insert(partsUri, partValues);
                if (partUri == null) continue;
                try (OutputStream output = context.getContentResolver().openOutputStream(partUri)) {
                    if (output != null) output.write(part.data);
                }
            }
        }
        return messageUri;
    }

    private static void insertAddress(Context context, Uri addrUri, String address, int type) {
        if (address == null || address.isEmpty()) return;
        ContentValues values = new ContentValues();
        values.put(Telephony.Mms.Addr.ADDRESS, address);
        values.put(Telephony.Mms.Addr.TYPE, type);
        values.put(Telephony.Mms.Addr.CHARSET, CHARSET_UTF8);
        context.getContentResolver().insert(addrUri, values);
    }
}
