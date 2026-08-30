package com.voicecap.sms;

import android.content.Context;
import android.content.SharedPreferences;

public final class BridgePreferences {
    private static final String NAME = "voicecap_sms_bridge";
    public static final String DEVICE_ID = "device_id";
    public static final String DEVICE_TOKEN = "device_token";
    public static final String WORKSPACE_ID = "workspace_id";
    public static final String DEVICE_NAME = "device_name";
    public static final String DATA_TRANSFER_CONSENT = "data_transfer_consent";

    private BridgePreferences() { }

    public static SharedPreferences get(Context context) {
        return context.getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    public static String value(Context context, String key) {
        return get(context).getString(key, "").trim();
    }

    public static String apiBaseUrl() {
        return BuildConfig.VOICECAP_API_BASE_URL.replaceAll("/+$", "");
    }

    public static boolean configured(Context context) {
        return !value(context, DEVICE_ID).isEmpty()
                && !value(context, DEVICE_TOKEN).isEmpty()
                && !value(context, WORKSPACE_ID).isEmpty();
    }

    public static boolean hasDataTransferConsent(Context context) {
        return get(context).getBoolean(DATA_TRANSFER_CONSENT, false);
    }

    public static void clearDevice(Context context) {
        get(context).edit()
                .remove(DEVICE_ID)
                .remove(DEVICE_TOKEN)
                .remove(WORKSPACE_ID)
                .remove(DEVICE_NAME)
                .apply();
    }
}
