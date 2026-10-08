package com.voicecap.sms;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 업로드·발송 상태를 기기에 저장한다 (안드로이드 내장 SQLite, 의존성 없음). */
public final class LocalDb extends SQLiteOpenHelper {
    public static final String KIND_SMS_IN = "SMS_IN";
    public static final String KIND_MMS_IN = "MMS_IN";
    public static final String KIND_SMS_OUT = "SMS_OUT";
    /** 폰에서 보낸 MMS (Phase 6). external_id = device-mms-sent-&lt;문자함 id&gt;. */
    public static final String KIND_MMS_OUT = "MMS_OUT";
    /** 아직 받지 못한 MMS 알림(m-notification-ind). 다운로드·저장에 성공하면 지운다. */
    public static final String KIND_MMS_NOTICE = "MMS_NOTICE";
    /** 은행 알림에서 읽은 입금 (payment-incoming). external_id = banknoti:<package>:<hash>. */
    public static final String KIND_PAYMENT = "PAYMENT";

    public static final String ORIGIN_DEVICE = "DEVICE";
    public static final String ORIGIN_WEB = "WEB";

    /** 서버 보고가 필요함. */
    public static final String STATE_PENDING = "PENDING";
    /** 통신사 발송 결과를 기다리는 중. */
    public static final String STATE_SENDING = "SENDING";
    public static final String STATE_SYNCED = "SYNCED";
    public static final String STATE_FAILED = "FAILED";
    /** 서버 업로드 대상이 아님. */
    public static final String STATE_SKIPPED = "SKIPPED";

    private static final String LEGACY_UPLOADED_PREFIX = "uploaded_";
    private static final String LEGACY_MIGRATED_KEY = "local_db_legacy_migrated";

    private static LocalDb instance;

    public static final class Item {
        public String externalId;
        public String kind;
        public String origin;
        public String serverId;
        public String providerUri;
        public JSONObject payload;
        public String state;
        public int attempts;
        public long nextAt;
        public String lastError;
        public long createdAt;
        /** {@link #page}로 읽었을 때만 채워진다. */
        public long rowId;
    }

    public static synchronized LocalDb get(Context context) {
        if (instance == null) {
            instance = new LocalDb(context.getApplicationContext());
            instance.migrateLegacyUploaded(BridgePreferences.get(context));
        }
        return instance;
    }

    private LocalDb(Context context) { super(context, "voicecap_local.db", null, 3); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("create table sync_items ("
                + "external_id text primary key, kind text not null, origin text not null, server_id text,"
                + "provider_uri text, payload text not null default '{}', state text not null,"
                + "attempts integer not null default 0, next_at integer not null default 0,"
                + "last_error text, created_at integer not null)");
        db.execSQL("create index sync_items_due on sync_items(state, next_at)");
        db.execSQL("create unique index sync_items_provider on sync_items(provider_uri)");
        createDepositTables(db);
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) migrateSentPrefix(db);
        if (oldVersion < 3) createDepositTables(db);
    }

    /**
     * 입금 피드 + 잔액 없는 은행의 90초 중복 창(deposits), 샘플 수집 모드의 알림 원문(notif_samples, 폰에만 30일).
     * deposits.state는 서버 대조 결과(MATCHED / NEEDS_REVIEW / UNMATCHED), 아직 모르면 null,
     * 다른 경로(은행 알림↔은행 입금 문자)의 같은 입금이라 올리지 않은 건은 LOCAL_DUPLICATE.
     */
    static void createDepositTables(SQLiteDatabase db) {
        db.execSQL("create table if not exists deposits ("
                + "external_id text primary key, package text, bank text, payer text, amount integer,"
                + "balance integer, paid_at integer, source text, state text, created_at integer)");
        db.execSQL("create index if not exists deposits_window on deposits(package, amount, payer, paid_at)");
        db.execSQL("create table if not exists notif_samples ("
                + "id integer primary key, package text, raw_text text, masked_text text, created_at integer)");
    }

    /** Phase 0의 device-send-<id> 행을 device-sms-sent-<id>로 바꾼다 (서버 outgoing externalId와 같게). */
    static void migrateSentPrefix(SQLiteDatabase db) {
        String legacy = ConversationLogic.LEGACY_SENT_PREFIX;
        db.execSQL("update or ignore sync_items set external_id=? || substr(external_id, ?) where substr(external_id, 1, ?)=?",
                new Object[]{ConversationLogic.SENT_PREFIX, legacy.length() + 1, legacy.length(), legacy});
        // 같은 새 id가 이미 있어 바꾸지 못한 행은 중복이므로 지운다.
        db.execSQL("delete from sync_items where substr(external_id, 1, ?)=?", new Object[]{legacy.length(), legacy});
    }

    public synchronized boolean exists(String externalId) {
        try (Cursor cursor = getReadableDatabase().rawQuery("select 1 from sync_items where external_id=?", new String[]{externalId})) {
            return cursor.moveToFirst();
        }
    }

    public synchronized boolean isSynced(String externalId) {
        Item item = find(externalId);
        return item != null && STATE_SYNCED.equals(item.state);
    }

    public synchronized void insert(Item item) {
        ContentValues values = new ContentValues();
        values.put("external_id", item.externalId);
        values.put("kind", item.kind);
        values.put("origin", item.origin);
        values.put("server_id", item.serverId);
        values.put("provider_uri", item.providerUri);
        values.put("payload", item.payload == null ? "{}" : item.payload.toString());
        values.put("state", item.state);
        values.put("attempts", item.attempts);
        values.put("next_at", item.nextAt);
        values.put("last_error", item.lastError);
        values.put("created_at", item.createdAt == 0 ? System.currentTimeMillis() : item.createdAt);
        getWritableDatabase().insertWithOnConflict("sync_items", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public synchronized void markSynced(String externalId, String kind) {
        Item existing = find(externalId);
        if (existing == null) {
            Item item = new Item();
            item.externalId = externalId;
            item.kind = kind;
            item.origin = ORIGIN_DEVICE;
            item.state = STATE_SYNCED;
            insert(item);
            return;
        }
        existing.state = STATE_SYNCED;
        existing.lastError = null;
        update(existing);
    }

    /** 같은 external_id나 provider_uri 행이 이미 있으면 아무것도 하지 않는다. 새로 넣었으면 true. */
    public synchronized boolean insertIfAbsent(Item item) {
        ContentValues values = new ContentValues();
        values.put("external_id", item.externalId);
        values.put("kind", item.kind);
        values.put("origin", item.origin);
        values.put("server_id", item.serverId);
        values.put("provider_uri", item.providerUri);
        values.put("payload", item.payload == null ? "{}" : item.payload.toString());
        values.put("state", item.state);
        values.put("attempts", item.attempts);
        values.put("next_at", item.nextAt);
        values.put("last_error", item.lastError);
        values.put("created_at", item.createdAt == 0 ? System.currentTimeMillis() : item.createdAt);
        return getWritableDatabase().insertWithOnConflict("sync_items", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1;
    }

    public synchronized void delete(String externalId) {
        getWritableDatabase().delete("sync_items", "external_id=?", new String[]{externalId});
    }

    /**
     * kind·state가 맞는 행을 rowid 순서로 limit개씩 읽는다. 처리에 실패해 그대로 남은 행 때문에
     * 같은 페이지를 반복하지 않도록, 다음 호출에는 마지막 행의 {@link Item#rowId}를 afterRowId로 넘긴다.
     */
    public synchronized List<Item> page(String kind, String state, long afterRowId, int limit) {
        List<Item> items = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "select rowid as row_id, * from sync_items where kind=? and state=? and rowid>? order by rowid limit " + limit,
                new String[]{kind, state, String.valueOf(afterRowId)})) {
            while (cursor.moveToNext()) items.add(read(cursor));
        }
        return items;
    }

    /** {@link #page}와 같지만 origin도 맞는 행만 (폰 발신 업로드에서 웹 발송분을 빼기 위해). */
    public synchronized List<Item> page(String kind, String origin, String state, long afterRowId, int limit) {
        List<Item> items = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "select rowid as row_id, * from sync_items where kind=? and origin=? and state=? and rowid>? order by rowid limit " + limit,
                new String[]{kind, origin, state, String.valueOf(afterRowId)})) {
            while (cursor.moveToNext()) items.add(read(cursor));
        }
        return items;
    }

    /** 말풍선 배지용: provider_uri → 행. 없는 uri는 빠진다. */
    public synchronized Map<String, Item> findByProviderUris(List<String> providerUris) {
        Map<String, Item> result = new HashMap<>();
        SQLiteDatabase db = getReadableDatabase();
        for (int start = 0; start < providerUris.size(); start += 200) {
            List<String> chunk = providerUris.subList(start, Math.min(providerUris.size(), start + 200));
            StringBuilder marks = new StringBuilder();
            for (int index = 0; index < chunk.size(); index++) marks.append(index == 0 ? "?" : ",?");
            try (Cursor cursor = db.rawQuery("select * from sync_items where provider_uri in (" + marks + ")", chunk.toArray(new String[0]))) {
                while (cursor.moveToNext()) {
                    Item item = read(cursor);
                    result.put(item.providerUri, item);
                }
            }
        }
        return result;
    }

    /** 🔴 배지를 눌렀을 때: 실패한 업로드를 바로 다시 시도하도록 되돌린다. */
    public synchronized void retryNow(String externalId) {
        ContentValues values = new ContentValues();
        values.put("state", STATE_PENDING);
        values.put("attempts", 0);
        values.put("next_at", 0);
        values.putNull("last_error");
        getWritableDatabase().update("sync_items", values, "external_id=? and state=?", new String[]{externalId, STATE_FAILED});
    }

    /** now 이후로 잡힌 재시도 시각 중 가장 이른 값. 없으면 0. */
    public synchronized long nextRetryAt(long now) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "select min(next_at) from sync_items where state=? and next_at>?", new String[]{STATE_PENDING, String.valueOf(now)})) {
            return cursor.moveToFirst() && !cursor.isNull(0) ? cursor.getLong(0) : 0;
        }
    }

    /** 서버에 아직 저장되지 않은 업무 문자 수 (받은 문자·폰에서 보낸 문자의 업로드 대기 + 실패). */
    public synchronized int unsyncedCount() {
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "select count(*) from sync_items where state in (?,?) and (kind in (?,?) or (kind in (?,?) and origin=?))",
                new String[]{STATE_PENDING, STATE_FAILED, KIND_SMS_IN, KIND_MMS_IN, KIND_SMS_OUT, KIND_MMS_OUT, ORIGIN_DEVICE})) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        }
    }

    /** 다른 칸은 건드리지 않고 last_error만 바꾼다 (발송 결과 콜백과 겹쳐도 상태를 덮어쓰지 않게). */
    public synchronized void setLastError(String externalId, String error) {
        ContentValues values = new ContentValues();
        values.put("last_error", error);
        getWritableDatabase().update("sync_items", values, "external_id=?", new String[]{externalId});
    }

    public synchronized void update(Item item) {
        ContentValues values = new ContentValues();
        values.put("payload", item.payload == null ? "{}" : item.payload.toString());
        values.put("state", item.state);
        values.put("attempts", item.attempts);
        values.put("next_at", item.nextAt);
        values.put("last_error", item.lastError);
        values.put("provider_uri", item.providerUri);
        getWritableDatabase().update("sync_items", values, "external_id=?", new String[]{item.externalId});
    }

    public synchronized Item find(String externalId) {
        try (Cursor cursor = getReadableDatabase().rawQuery("select * from sync_items where external_id=?", new String[]{externalId})) {
            return cursor.moveToFirst() ? read(cursor) : null;
        }
    }

    public synchronized List<Item> list(String kind, String origin, String state) {
        List<Item> items = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "select * from sync_items where kind=? and origin=? and state=? order by created_at limit 200",
                new String[]{kind, origin, state})) {
            while (cursor.moveToNext()) items.add(read(cursor));
        }
        return items;
    }

    /** 입금 피드 한 줄 (sync_items 업로드 상태를 붙여 읽음). */
    public static final class DepositRow {
        public String externalId;
        public String packageName;
        public String bank;
        public String payer;
        public long amount;
        public Long balance;
        public long paidAt;
        public String source;
        /** 서버 대조 결과. 서버가 아직 대조하지 않았거나 응답에 없으면 null. */
        public String matchState;
        /** sync_items.state (PENDING / SYNCED / FAILED). */
        public String syncState;
        public String lastError;
    }

    public static final class Sample {
        public long id;
        public String packageName;
        public String rawText;
        public String maskedText;
        public long createdAt;
    }

    /**
     * 입금 한 건과 업로드 큐 행을 한 번에 넣는다. 이미 같은 externalId가 있거나, useWindow일 때 같은 패키지·금액·입금자의
     * 잔액 없는 입금이 windowMillis 안에 있으면 아무것도 넣지 않고 false.
     */
    public synchronized boolean recordDeposit(DepositRow row, Item syncItem, boolean useWindow, long windowMillis) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (useWindow) {
                try (Cursor cursor = db.rawQuery("select 1 from deposits where package=? and amount=? and payer=? and balance is null"
                                + " and paid_at between ? and ? limit 1",
                        new String[]{row.packageName, String.valueOf(row.amount), row.payer,
                                String.valueOf(row.paidAt - windowMillis), String.valueOf(row.paidAt + windowMillis)})) {
                    if (cursor.moveToFirst()) return false;
                }
            }
            // 은행 알림과 은행 입금 문자를 둘 다 켰을 때 다른 경로로 이미 기록된 같은 입금이면 올리지 않고 짝 표시만 남긴다.
            boolean duplicate = com.voicecap.sms.deposit.DepositDedupe.isDuplicate(row, nearbyDeposits(db, row));
            ContentValues values = new ContentValues();
            values.put("external_id", row.externalId);
            values.put("package", row.packageName);
            values.put("bank", row.bank);
            values.put("payer", row.payer);
            values.put("amount", row.amount);
            if (row.balance == null) values.putNull("balance");
            else values.put("balance", row.balance);
            values.put("paid_at", row.paidAt);
            values.put("source", row.source);
            if (duplicate) values.put("state", com.voicecap.sms.deposit.DepositDedupe.STATE_LOCAL_DUPLICATE);
            else values.putNull("state");
            values.put("created_at", System.currentTimeMillis());
            if (db.insertWithOnConflict("deposits", null, values, SQLiteDatabase.CONFLICT_IGNORE) == -1) return false;
            if (duplicate) {
                db.setTransactionSuccessful();
                return false;
            }
            if (!insertIfAbsent(syncItem)) return false;
            db.setTransactionSuccessful();
            return true;
        } finally {
            db.endTransaction();
        }
    }

    /** 같은 은행·금액으로 다른 경로 짝 후보가 될 수 있는 최근 입금 (짝 표시된 것 포함). */
    private static List<DepositRow> nearbyDeposits(SQLiteDatabase db, DepositRow row) {
        List<DepositRow> rows = new ArrayList<>();
        if (row.bank == null) return rows;
        long window = com.voicecap.sms.deposit.DepositDedupe.CROSS_SOURCE_WINDOW_MILLIS;
        try (Cursor cursor = db.rawQuery("select external_id, bank, payer, amount, balance, paid_at, source from deposits"
                        + " where bank=? and amount=? and paid_at between ? and ?",
                new String[]{row.bank, String.valueOf(row.amount), String.valueOf(row.paidAt - 2 * window), String.valueOf(row.paidAt + 2 * window)})) {
            while (cursor.moveToNext()) {
                DepositRow nearby = new DepositRow();
                nearby.externalId = cursor.getString(0);
                nearby.bank = cursor.getString(1);
                nearby.payer = cursor.getString(2);
                nearby.amount = cursor.getLong(3);
                nearby.balance = cursor.isNull(4) ? null : cursor.getLong(4);
                nearby.paidAt = cursor.getLong(5);
                nearby.source = cursor.getString(6);
                rows.add(nearby);
            }
        }
        return rows;
    }

    public synchronized void setDepositMatch(String externalId, String matchState) {
        ContentValues values = new ContentValues();
        values.put("state", matchState);
        getWritableDatabase().update("deposits", values, "external_id=?", new String[]{externalId});
    }

    public synchronized List<DepositRow> recentDeposits(int limit) {
        List<DepositRow> rows = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "select d.*, s.state as sync_state, s.last_error as sync_error from deposits d"
                        + " left join sync_items s on s.external_id=d.external_id"
                        + " where d.state is null or d.state != '" + com.voicecap.sms.deposit.DepositDedupe.STATE_LOCAL_DUPLICATE + "'"
                        + " order by d.paid_at desc limit " + limit, null)) {
            while (cursor.moveToNext()) {
                DepositRow row = new DepositRow();
                row.externalId = cursor.getString(cursor.getColumnIndexOrThrow("external_id"));
                row.packageName = cursor.getString(cursor.getColumnIndexOrThrow("package"));
                row.bank = cursor.getString(cursor.getColumnIndexOrThrow("bank"));
                row.payer = cursor.getString(cursor.getColumnIndexOrThrow("payer"));
                row.amount = cursor.getLong(cursor.getColumnIndexOrThrow("amount"));
                int balance = cursor.getColumnIndexOrThrow("balance");
                row.balance = cursor.isNull(balance) ? null : cursor.getLong(balance);
                row.paidAt = cursor.getLong(cursor.getColumnIndexOrThrow("paid_at"));
                row.source = cursor.getString(cursor.getColumnIndexOrThrow("source"));
                row.matchState = cursor.getString(cursor.getColumnIndexOrThrow("state"));
                row.syncState = cursor.getString(cursor.getColumnIndexOrThrow("sync_state"));
                row.lastError = cursor.getString(cursor.getColumnIndexOrThrow("sync_error"));
                rows.add(row);
            }
        }
        return rows;
    }

    public synchronized void insertSample(String packageName, String rawText, String maskedText, long createdAt) {
        ContentValues values = new ContentValues();
        values.put("package", packageName);
        values.put("raw_text", rawText);
        values.put("masked_text", maskedText);
        values.put("created_at", createdAt);
        getWritableDatabase().insert("notif_samples", null, values);
    }

    public synchronized List<Sample> recentSamples(int limit) {
        List<Sample> samples = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "select id, package, raw_text, masked_text, created_at from notif_samples order by created_at desc limit " + limit, null)) {
            while (cursor.moveToNext()) {
                Sample sample = new Sample();
                sample.id = cursor.getLong(0);
                sample.packageName = cursor.getString(1);
                sample.rawText = cursor.getString(2);
                sample.maskedText = cursor.getString(3);
                sample.createdAt = cursor.getLong(4);
                samples.add(sample);
            }
        }
        return samples;
    }

    /** 보관 기간이 지난 샘플 원문을 지운다. */
    public synchronized void purgeSamplesBefore(long cutoff) {
        getWritableDatabase().delete("notif_samples", "created_at<?", new String[]{String.valueOf(cutoff)});
    }

    public synchronized void deleteAllSamples() {
        getWritableDatabase().delete("notif_samples", null, null);
    }

    private static Item read(Cursor cursor) {
        Item item = new Item();
        item.externalId = cursor.getString(cursor.getColumnIndexOrThrow("external_id"));
        item.kind = cursor.getString(cursor.getColumnIndexOrThrow("kind"));
        item.origin = cursor.getString(cursor.getColumnIndexOrThrow("origin"));
        item.serverId = cursor.getString(cursor.getColumnIndexOrThrow("server_id"));
        item.providerUri = cursor.getString(cursor.getColumnIndexOrThrow("provider_uri"));
        try {
            item.payload = new JSONObject(cursor.getString(cursor.getColumnIndexOrThrow("payload")));
        } catch (Exception ignored) {
            item.payload = new JSONObject();
        }
        item.state = cursor.getString(cursor.getColumnIndexOrThrow("state"));
        item.attempts = cursor.getInt(cursor.getColumnIndexOrThrow("attempts"));
        item.nextAt = cursor.getLong(cursor.getColumnIndexOrThrow("next_at"));
        item.lastError = cursor.getString(cursor.getColumnIndexOrThrow("last_error"));
        item.createdAt = cursor.getLong(cursor.getColumnIndexOrThrow("created_at"));
        int rowId = cursor.getColumnIndex("row_id");
        if (rowId >= 0) item.rowId = cursor.getLong(rowId);
        return item;
    }

    /** 예전 SharedPreferences의 uploaded_<externalId> 표시를 한 번만 옮기고 지운다. */
    private void migrateLegacyUploaded(SharedPreferences preferences) {
        if (preferences.getBoolean(LEGACY_MIGRATED_KEY, false)) return;
        SQLiteDatabase db = getWritableDatabase();
        SharedPreferences.Editor editor = preferences.edit();
        db.beginTransaction();
        try {
            for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
                String key = entry.getKey();
                if (!key.startsWith(LEGACY_UPLOADED_PREFIX)) continue;
                String externalId = key.substring(LEGACY_UPLOADED_PREFIX.length());
                if (Boolean.TRUE.equals(entry.getValue())) {
                    ContentValues values = new ContentValues();
                    values.put("external_id", externalId);
                    values.put("kind", externalId.startsWith("device-mms-") ? KIND_MMS_IN : KIND_SMS_IN);
                    values.put("origin", ORIGIN_DEVICE);
                    values.put("payload", "{}");
                    values.put("state", STATE_SYNCED);
                    values.put("created_at", System.currentTimeMillis());
                    db.insertWithOnConflict("sync_items", null, values, SQLiteDatabase.CONFLICT_IGNORE);
                }
                editor.remove(key);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        editor.putBoolean(LEGACY_MIGRATED_KEY, true).apply();
    }
}
