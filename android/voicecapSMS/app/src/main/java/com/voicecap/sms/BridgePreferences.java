package com.voicecap.sms;

import android.content.Context;
import android.content.SharedPreferences;

public final class BridgePreferences {
    private static final String NAME = "voicecap_sms_bridge";
    public static final String URL = "server_url";
    public static final String API_KEY = "api_key";
    public static final String SELLER_ID = "seller_id";
    public static final String DATA_TRANSFER_CONSENT = "data_transfer_consent";

    private BridgePreferences() { }

    public static SharedPreferences get(Context context) {
        return context.getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    public static String value(Context context, String key) {
        return get(context).getString(key, "").trim();
    }

    public static boolean configured(Context context) {
        return !value(context, URL).isEmpty() && !value(context, SELLER_ID).isEmpty();
    }

    public static boolean hasDataTransferConsent(Context context) {
        return get(context).getBoolean(DATA_TRANSFER_CONSENT, false);
    }
}
