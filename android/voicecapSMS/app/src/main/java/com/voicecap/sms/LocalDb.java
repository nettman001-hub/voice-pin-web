package com.voicecap.sms;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 업로드·발송 상태를 기기에 저장한다 (안드로이드 내장 SQLite, 의존성 없음). */
public final class LocalDb extends SQLiteOpenHelper {
    public static final String KIND_SMS_IN = "SMS_IN";
    public static final String KIND_MMS_IN = "MMS_IN";
    public static final String KIND_SMS_OUT = "SMS_OUT";
    /** 아직 받지 못한 MMS 알림(m-notification-ind). 다운로드·저장에 성공하면 지운다. */
    public static final String KIND_MMS_NOTICE = "MMS_NOTICE";

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

    private LocalDb(Context context) { super(context, "voicecap_local.db", null, 1); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("create table sync_items ("
                + "external_id text primary key, kind text not null, origin text not null, server_id text,"
                + "provider_uri text, payload text not null default '{}', state text not null,"
                + "attempts integer not null default 0, next_at integer not null default 0,"
                + "last_error text, created_at integer not null)");
        db.execSQL("create index sync_items_due on sync_items(state, next_at)");
        db.execSQL("create unique index sync_items_provider on sync_items(provider_uri)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

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

    /** now 이후로 잡힌 재시도 시각 중 가장 이른 값. 없으면 0. */
    public synchronized long nextRetryAt(long now) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "select min(next_at) from sync_items where state=? and next_at>?", new String[]{STATE_PENDING, String.valueOf(now)})) {
            return cursor.moveToFirst() && !cursor.isNull(0) ? cursor.getLong(0) : 0;
        }
    }

    /** 서버에 아직 저장되지 않은 업무 문자 수 (업로드 대기 + 실패). */
    public synchronized int unsyncedCount() {
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "select count(*) from sync_items where kind in (?,?) and state in (?,?)",
                new String[]{KIND_SMS_IN, KIND_MMS_IN, STATE_PENDING, STATE_FAILED})) {
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
