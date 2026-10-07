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
