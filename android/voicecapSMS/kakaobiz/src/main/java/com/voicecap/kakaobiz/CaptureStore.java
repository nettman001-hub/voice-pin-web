package com.voicecap.kakaobiz;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 읽은 알림과 "알림을 보낸 앱" 목록을 휴대폰 안에만 저장한다(최근 {@link #MAX_ENTRIES}건).
 * 알림 내용은 사용자가 고른 앱(selected)의 것만 저장하고, 고르지 않은 앱은 앱 이름·패키지명만 기억한다.
 */
final class CaptureStore {
    static final int MAX_ENTRIES = 100;
    private static final String PREFS = "kakaobiz_capture";
    private static final String KEY_ENTRIES = "entries";
    private static final String KEY_APPS = "apps";
    private static final String KEY_SELECTED = "selected";
    private static final String KEY_KNOWN = "known";

    private static final Object LOCK = new Object();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static List<CapturedNotification> entries;
    private static Map<String, String> apps;
    private static Set<String> selected;
    private static Set<String> known;
    private static Runnable listener;

    private CaptureStore() { }

    static void setListener(Runnable l) {
        listener = l;
    }

    private static void ensureLoaded(Context context) {
        if (entries != null) return;
        SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        entries = new ArrayList<>();
        apps = new LinkedHashMap<>();
        selected = new HashSet<>(prefs.getStringSet(KEY_SELECTED, new HashSet<>()));
        known = new HashSet<>(prefs.getStringSet(KEY_KNOWN, new HashSet<>()));
        try {
            JSONArray array = new JSONArray(prefs.getString(KEY_ENTRIES, "[]"));
            for (int i = 0; i < array.length(); i++) entries.add(CapturedNotification.fromJson(array.getJSONObject(i)));
            JSONObject appJson = new JSONObject(prefs.getString(KEY_APPS, "{}"));
            java.util.Iterator<String> it = appJson.keys();
            while (it.hasNext()) {
                String pkg = it.next();
                apps.put(pkg, appJson.optString(pkg));
            }
        } catch (JSONException ignored) {
            // 저장본이 깨졌으면 빈 목록으로 시작한다.
        }
    }

    private static void persist(Context context) {
        try {
            JSONArray array = new JSONArray();
            for (CapturedNotification entry : entries) array.put(entry.toJson());
            JSONObject appJson = new JSONObject();
            for (Map.Entry<String, String> app : apps.entrySet()) appJson.put(app.getKey(), app.getValue());
            context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_ENTRIES, array.toString())
                .putString(KEY_APPS, appJson.toString())
                .putStringSet(KEY_SELECTED, new HashSet<>(selected))
                .putStringSet(KEY_KNOWN, new HashSet<>(known))
                .apply();
        } catch (JSONException ignored) {
            // 저장 실패는 화면 표시에 영향 없음
        }
    }

    private static void notifyChanged() {
        Runnable l = listener;
        if (l != null) MAIN.post(l);
    }

    /** 이 앱의 알림이 처음 보이면 앱 이름을 기억하고, 파트너센터면 자동으로 고른다. 내용을 저장해도 되는 앱이면 true. */
    static boolean seenApp(Context context, String pkg, String label) {
        synchronized (LOCK) {
            ensureLoaded(context);
            boolean changed = !label.equals(apps.get(pkg));
            apps.put(pkg, label);
            if (known.add(pkg)) {
                changed = true;
                if (AppMatcher.isPartnerCenter(pkg, label)) selected.add(pkg);
            }
            if (changed) {
                persist(context);
                notifyChanged();
            }
            return selected.contains(pkg);
        }
    }

    static boolean add(Context context, CapturedNotification entry) {
        synchronized (LOCK) {
            ensureLoaded(context);
            String fingerprint = entry.fingerprint();
            for (CapturedNotification existing : entries) if (existing.fingerprint().equals(fingerprint)) return false;
            entries.add(0, entry);
            while (entries.size() > MAX_ENTRIES) entries.remove(entries.size() - 1);
            persist(context);
        }
        notifyChanged();
        return true;
    }

    static List<CapturedNotification> entries(Context context) {
        synchronized (LOCK) {
            ensureLoaded(context);
            return new ArrayList<>(entries);
        }
    }

    static Map<String, String> apps(Context context) {
        synchronized (LOCK) {
            ensureLoaded(context);
            return new LinkedHashMap<>(apps);
        }
    }

    static boolean isSelected(Context context, String pkg) {
        synchronized (LOCK) {
            ensureLoaded(context);
            return selected.contains(pkg);
        }
    }

    static void setSelected(Context context, String pkg, boolean on) {
        synchronized (LOCK) {
            ensureLoaded(context);
            if (on) selected.add(pkg); else selected.remove(pkg);
            persist(context);
        }
        notifyChanged();
    }

    static void clear(Context context) {
        synchronized (LOCK) {
            ensureLoaded(context);
            entries.clear();
            persist(context);
        }
        notifyChanged();
    }
}
