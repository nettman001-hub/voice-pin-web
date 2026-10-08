package com.voicecap.sms;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.Telephony;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 시스템 문자함(content://mms-sms) 읽기·쓰기. 화면 스레드가 아닌 곳에서 호출한다. */
final class ConversationStore {
    static final int PAGE_SIZE = 50;
    private static final Uri THREADS_URI = Uri.parse("content://mms-sms/conversations?simple=true");
    private static final Uri CANONICAL_URI = Uri.parse("content://mms-sms/canonical-addresses");
    private static final int MMS_ADDRESS_FROM = 137;
    private static final int MMS_ADDRESS_TO = 151;

    static final class Conversation {
        long id;
        long date;
        String snippet;
        List<String> addresses = new ArrayList<>();
        String name;
        int unread;
        boolean business;
        boolean blocked;

        String address() { return addresses.isEmpty() ? "" : addresses.get(0); }

        String title() {
            if (name != null && !name.isEmpty()) return name;
            if (addresses.isEmpty()) return "(번호 없음)";
            return addresses.size() == 1 ? addresses.get(0) : addresses.get(0) + " 외 " + (addresses.size() - 1) + "명";
        }
    }

    static final class Message {
        String providerUri;
        boolean mms;
        boolean outgoing;
        /** Telephony.Sms.TYPE (SMS) 또는 MESSAGE_BOX (MMS). */
        int box;
        long date;
        String address;
        String body;
        List<Uri> images = new ArrayList<>();

        boolean failed() { return outgoing && box == (mms ? Telephony.Mms.MESSAGE_BOX_FAILED : Telephony.Sms.MESSAGE_TYPE_FAILED); }

        boolean sending() {
            if (!outgoing) return false;
            if (mms) return box == Telephony.Mms.MESSAGE_BOX_OUTBOX;
            return box == Telephony.Sms.MESSAGE_TYPE_OUTBOX || box == Telephony.Sms.MESSAGE_TYPE_QUEUED;
        }
    }

    private final Context context;
    private final Map<String, String> names = new HashMap<>();
    private final Map<String, Boolean> blocked = new HashMap<>();
    private Map<Long, String> canonical;

    ConversationStore(Context context) { this.context = context.getApplicationContext(); }

    static boolean canReadContacts(Context context) {
        return context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED;
    }

    /** 이름·차단 캐시를 비운다 (연락처 권한이 바뀌었거나 새로 고칠 때). */
    void clearCaches() {
        names.clear();
        blocked.clear();
        canonical = null;
    }

    /**
     * 대화 목록 한 페이지(50개). simple=true 대화 목록은 정렬·LIMIT 인자를 무시하므로(날짜 내림차순 고정)
     * 커서를 offset으로 옮겨 50개만 이름·안 읽음 수를 채운다.
     */
    List<Conversation> threads(int offset, Map<Long, Integer> unreadCounts) {
        List<Conversation> result = new ArrayList<>();
        try (Cursor cursor = context.getContentResolver().query(THREADS_URI,
                new String[]{"_id", "date", "snippet", "recipient_ids"}, null, null, "date DESC")) {
            if (cursor == null || !cursor.moveToPosition(offset)) return result;
            do {
                Conversation thread = new Conversation();
                thread.id = cursor.getLong(0);
                thread.date = cursor.getLong(1);
                thread.snippet = cursor.getString(2) == null ? "" : cursor.getString(2);
                thread.addresses = addresses(cursor.getString(3));
                fill(thread);
                Integer unread = unreadCounts.get(thread.id);
                thread.unread = unread == null ? 0 : unread;
                result.add(thread);
            } while (result.size() < PAGE_SIZE && cursor.moveToNext());
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "thread list failed", error);
        }
        return result;
    }

    /** 대화 하나 (대화방 제목·배지 판정용). 없으면 null. */
    Conversation thread(long threadId) {
        try (Cursor cursor = context.getContentResolver().query(THREADS_URI,
                new String[]{"_id", "date", "snippet", "recipient_ids"}, "_id=?", new String[]{String.valueOf(threadId)}, null)) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            Conversation thread = new Conversation();
            thread.id = cursor.getLong(0);
            thread.date = cursor.getLong(1);
            thread.snippet = cursor.getString(2) == null ? "" : cursor.getString(2);
            thread.addresses = addresses(cursor.getString(3));
            fill(thread);
            return thread;
        } catch (RuntimeException error) {
            return null;
        }
    }

    private void fill(Conversation thread) {
        for (String address : thread.addresses) {
            if (thread.name == null) thread.name = contactName(address);
            thread.business |= BusinessContactStore.contains(context, address);
            thread.blocked |= isBlocked(address);
        }
        if (thread.addresses.size() > 1 && thread.name != null) thread.name = thread.name + " 외 " + (thread.addresses.size() - 1) + "명";
    }

    /** 대화별 안 읽은 문자 수 (받은 SMS + 받은 MMS). */
    Map<Long, Integer> unreadCounts() {
        Map<Long, Integer> counts = new HashMap<>();
        countUnread(counts, Telephony.Sms.Inbox.CONTENT_URI, Telephony.Sms.THREAD_ID, Telephony.Sms.READ);
        countUnread(counts, Telephony.Mms.Inbox.CONTENT_URI, Telephony.Mms.THREAD_ID, Telephony.Mms.READ);
        return counts;
    }

    private void countUnread(Map<Long, Integer> counts, Uri uri, String threadColumn, String readColumn) {
        try (Cursor cursor = context.getContentResolver().query(uri, new String[]{threadColumn}, readColumn + "=0", null, null)) {
            while (cursor != null && cursor.moveToNext()) {
                long id = cursor.getLong(0);
                Integer current = counts.get(id);
                counts.put(id, current == null ? 1 : current + 1);
            }
        } catch (RuntimeException ignored) { }
    }

    /** 본문에 검색어가 들어간 SMS·MMS의 대화 id. */
    Set<Long> threadsWithBody(String query) {
        Set<Long> ids = new HashSet<>();
        String like = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        try (Cursor cursor = context.getContentResolver().query(Telephony.Sms.CONTENT_URI, new String[]{Telephony.Sms.THREAD_ID},
                Telephony.Sms.BODY + " LIKE ? ESCAPE '\\'", new String[]{like}, null)) {
            while (cursor != null && cursor.moveToNext()) ids.add(cursor.getLong(0));
        } catch (RuntimeException ignored) { }
        // MMS 본문은 part 표에 있다. part → mid → thread_id.
        Set<String> mids = new HashSet<>();
        try (Cursor cursor = context.getContentResolver().query(Uri.parse("content://mms/part"), new String[]{"mid"},
                "ct='text/plain' AND text LIKE ? ESCAPE '\\'", new String[]{like}, null)) {
            while (cursor != null && cursor.moveToNext()) mids.add(cursor.getString(0));
        } catch (RuntimeException ignored) { }
        for (String mid : mids) {
            try (Cursor cursor = context.getContentResolver().query(Uri.parse("content://mms/" + mid), new String[]{Telephony.Mms.THREAD_ID}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) ids.add(cursor.getLong(0));
            } catch (RuntimeException ignored) { }
        }
        return ids;
    }

    /** 전체 대화 수 (검색할 때 페이지를 끝까지 읽기 위해). */
    int threadCount() {
        try (Cursor cursor = context.getContentResolver().query(THREADS_URI, new String[]{"_id"}, null, null, null)) {
            return cursor == null ? 0 : cursor.getCount();
        } catch (RuntimeException error) {
            return 0;
        }
    }

    /** 대화의 최근 문자 limit개 (오래된 것부터). SMS와 MMS를 날짜로 합친다. */
    List<Message> messages(long threadId, int limit) {
        List<Message> result = new ArrayList<>();
        String[] args = {String.valueOf(threadId)};
        try (Cursor cursor = context.getContentResolver().query(Telephony.Sms.CONTENT_URI,
                new String[]{Telephony.Sms._ID, Telephony.Sms.TYPE, Telephony.Sms.DATE, Telephony.Sms.ADDRESS, Telephony.Sms.BODY},
                Telephony.Sms.THREAD_ID + "=?", args, Telephony.Sms.DATE + " DESC LIMIT " + limit)) {
            while (cursor != null && cursor.moveToNext()) {
                Message message = new Message();
                message.providerUri = UploadQueue.smsProviderUri(cursor.getLong(0));
                message.box = cursor.getInt(1);
                message.outgoing = message.box != Telephony.Sms.MESSAGE_TYPE_INBOX;
                message.date = cursor.getLong(2);
                message.address = cursor.getString(3) == null ? "" : cursor.getString(3);
                message.body = cursor.getString(4) == null ? "" : cursor.getString(4);
                result.add(message);
            }
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "sms read failed", error);
        }
        try (Cursor cursor = context.getContentResolver().query(Telephony.Mms.CONTENT_URI,
                new String[]{Telephony.Mms._ID, Telephony.Mms.MESSAGE_BOX, Telephony.Mms.DATE, Telephony.Mms.SUBJECT},
                Telephony.Mms.THREAD_ID + "=?", args, Telephony.Mms.DATE + " DESC LIMIT " + limit)) {
            while (cursor != null && cursor.moveToNext()) {
                Message message = new Message();
                String id = cursor.getString(0);
                message.mms = true;
                message.providerUri = UploadQueue.mmsProviderUri(cursor.getLong(0));
                message.box = cursor.getInt(1);
                message.outgoing = message.box != Telephony.Mms.MESSAGE_BOX_INBOX;
                message.date = cursor.getLong(2) * 1000L;
                message.address = mmsAddress(id, message.outgoing);
                message.body = UploadQueue.readMmsText(context, id, cursor.getString(3));
                message.images = mmsImages(id);
                result.add(message);
            }
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "mms read failed", error);
        }
        Collections.sort(result, (a, b) -> Long.compare(a.date, b.date));
        return result.size() > limit ? new ArrayList<>(result.subList(result.size() - limit, result.size())) : result;
    }

    private String mmsAddress(String messageId, boolean outgoing) {
        try (Cursor cursor = context.getContentResolver().query(Uri.parse("content://mms/" + messageId + "/addr"),
                new String[]{"address", "type"}, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) {
                if (cursor.getInt(1) == (outgoing ? MMS_ADDRESS_TO : MMS_ADDRESS_FROM)) return cursor.getString(0) == null ? "" : cursor.getString(0);
            }
        } catch (RuntimeException ignored) { }
        return "";
    }

    private List<Uri> mmsImages(String messageId) {
        List<Uri> images = new ArrayList<>();
        try (Cursor cursor = context.getContentResolver().query(Uri.parse("content://mms/part"), new String[]{"_id", "ct"},
                "mid=?", new String[]{messageId}, "seq")) {
            while (cursor != null && cursor.moveToNext()) {
                String mime = cursor.getString(1);
                if (mime != null && mime.startsWith("image/")) images.add(Uri.parse("content://mms/part/" + cursor.getString(0)));
            }
        } catch (RuntimeException ignored) { }
        return images;
    }

    /** 대화를 열면 안 읽은 문자를 읽음(read=1, seen=1)으로 표시한다. */
    void markRead(long threadId) {
        ContentValues values = new ContentValues();
        values.put(Telephony.Sms.READ, 1);
        values.put(Telephony.Sms.SEEN, 1);
        String[] args = {String.valueOf(threadId)};
        try {
            context.getContentResolver().update(Telephony.Sms.Inbox.CONTENT_URI, values,
                    Telephony.Sms.THREAD_ID + "=? AND (" + Telephony.Sms.READ + "=0 OR " + Telephony.Sms.SEEN + "=0)", args);
            context.getContentResolver().update(Telephony.Mms.Inbox.CONTENT_URI, values,
                    Telephony.Mms.THREAD_ID + "=? AND (" + Telephony.Mms.READ + "=0 OR " + Telephony.Mms.SEEN + "=0)", args);
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "mark read failed", error);
        }
    }

    boolean deleteThread(long threadId) {
        try {
            return context.getContentResolver().delete(Uri.parse("content://mms-sms/conversations/" + threadId), null, null) > 0;
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "thread delete failed", error);
            return false;
        }
    }

    boolean deleteMessage(String providerUri) {
        try {
            return context.getContentResolver().delete(Uri.parse(providerUri), null, null) > 0;
        } catch (RuntimeException error) {
            android.util.Log.w("VoiceCAP", "message delete failed", error);
            return false;
        }
    }

    /** 연락처 이름. READ_CONTACTS가 없거나 찾지 못하면 null (화면은 번호를 보여 준다). */
    String contactName(String address) {
        if (address == null || address.isEmpty() || !canReadContacts(context)) return null;
        if (names.containsKey(address)) return names.get(address);
        String name = null;
        try (Cursor cursor = context.getContentResolver().query(
                Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(address)),
                new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        } catch (RuntimeException ignored) { }
        names.put(address, name);
        return name;
    }

    boolean isBlocked(String address) {
        Boolean cached = blocked.get(address);
        if (cached != null) return cached;
        boolean value = SmsReceiver.isBlocked(context, address);
        blocked.put(address, value);
        return value;
    }

    /** 새 문자 화면의 연락처 검색 (이름 또는 번호). 권한이 없으면 빈 목록. */
    List<String[]> searchContacts(String query, int limit) {
        List<String[]> result = new ArrayList<>();
        if (query == null || query.trim().isEmpty() || !canReadContacts(context)) return result;
        Set<String> seen = new HashSet<>();
        try (Cursor cursor = context.getContentResolver().query(
                Uri.withAppendedPath(ContactsContract.CommonDataKinds.Phone.CONTENT_FILTER_URI, Uri.encode(query.trim())),
                new String[]{ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER},
                null, null, null)) {
            while (cursor != null && cursor.moveToNext() && result.size() < limit) {
                String number = cursor.getString(1);
                if (number == null || !seen.add(BusinessContactStore.normalize(number))) continue;
                result.add(new String[]{cursor.getString(0) == null ? number : cursor.getString(0), number});
            }
        } catch (RuntimeException ignored) { }
        return result;
    }

    private List<String> addresses(String recipientIds) {
        List<String> result = new ArrayList<>();
        if (recipientIds == null || recipientIds.trim().isEmpty()) return result;
        if (canonical == null) canonical = loadCanonical();
        for (String id : recipientIds.trim().split(" ")) {
            try {
                String address = canonical.get(Long.parseLong(id));
                if (address != null && !address.isEmpty()) result.add(address);
            } catch (NumberFormatException ignored) { }
        }
        return result;
    }

    private Map<Long, String> loadCanonical() {
        Map<Long, String> map = new HashMap<>();
        try (Cursor cursor = context.getContentResolver().query(CANONICAL_URI, new String[]{"_id", "address"}, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) map.put(cursor.getLong(0), cursor.getString(1));
        } catch (RuntimeException ignored) { }
        return map;
    }
}
