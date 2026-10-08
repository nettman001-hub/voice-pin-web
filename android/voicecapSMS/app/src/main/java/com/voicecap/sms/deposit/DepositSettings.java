package com.voicecap.sms.deposit;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

import java.util.HashSet;
import java.util.Set;

/** 입금확인 탭 설정: 고른 앱, 샘플 수집 모드, 입금 정보 전송 동의, 은행 입금 문자 읽기, 인식 실패 횟수. */
public final class DepositSettings {
    private static final String NAME = "voicecap_deposit";
    private static final String SELECTED = "selected_packages";
    private static final String SAMPLE_MODE = "sample_mode";
    private static final String CONSENT = "deposit_consent";
    private static final String BANK_SMS = "bank_sms_enabled";
    private static final String FAIL_PREFIX = "parse_fail_";
    /** 샘플 원문 보관 기간. */
    public static final long SAMPLE_RETENTION_MILLIS = 30L * 24 * 60 * 60 * 1000;

    private DepositSettings() { }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    public static Set<String> selectedPackages(Context context) {
        return new HashSet<>(prefs(context).getStringSet(SELECTED, new HashSet<>()));
    }

    public static boolean isSelected(Context context, String packageName) {
        return prefs(context).getStringSet(SELECTED, new HashSet<>()).contains(packageName);
    }

    public static void setSelected(Context context, String packageName, boolean selected) {
        Set<String> packages = selectedPackages(context);
        if (selected) packages.add(packageName);
        else packages.remove(packageName);
        prefs(context).edit().putStringSet(SELECTED, packages).apply();
    }

    public static boolean sampleMode(Context context) {
        return prefs(context).getBoolean(SAMPLE_MODE, false);
    }

    public static void setSampleMode(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(SAMPLE_MODE, enabled).apply();
    }

    /** 입금 정보(금액·입금자명·시각·은행·받는 계좌 별칭) 전송 동의. 문자 전송 동의와 따로 받는다. */
    public static boolean hasConsent(Context context) {
        return prefs(context).getBoolean(CONSENT, false);
    }

    /** 동의를 철회하면 은행 입금 문자 읽기도 함께 끈다. */
    public static void setConsent(Context context, boolean consent) {
        SharedPreferences.Editor editor = prefs(context).edit().putBoolean(CONSENT, consent);
        if (!consent) editor.putBoolean(BANK_SMS, false);
        editor.apply();
    }

    /** "은행 입금 문자도 읽기" (기본 꺼짐). 입금 정보 전송 동의가 없으면 저장값과 상관없이 꺼진 것으로 본다. */
    public static boolean bankSmsEnabled(Context context) {
        SharedPreferences preferences = prefs(context);
        return BankSmsDepositDetector.enabled(preferences.getBoolean(BANK_SMS, false), preferences.getBoolean(CONSENT, false));
    }

    /** 동의가 없으면 켤 수 없다 (false를 돌려준다). */
    public static boolean setBankSmsEnabled(Context context, boolean enabled) {
        if (enabled && !hasConsent(context)) return false;
        prefs(context).edit().putBoolean(BANK_SMS, enabled).apply();
        return true;
    }

    public static void countFailure(Context context, String packageName) {
        SharedPreferences preferences = prefs(context);
        preferences.edit().putInt(FAIL_PREFIX + packageName, preferences.getInt(FAIL_PREFIX + packageName, 0) + 1).apply();
    }

    public static int failureCount(Context context, String packageName) {
        return prefs(context).getInt(FAIL_PREFIX + packageName, 0);
    }

    /** 알림 접근이 허용되어 있는지 (설정 → 알림 접근에서 VoiceCAP이 켜져 있는지). */
    public static boolean hasNotificationAccess(Context context) {
        String enabled = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
        if (enabled == null || enabled.isEmpty()) return false;
        ComponentName mine = new ComponentName(context, BankNotificationListener.class);
        for (String item : enabled.split(":")) {
            ComponentName component = ComponentName.unflattenFromString(item);
            if (mine.equals(component)) return true;
        }
        return false;
    }
}
