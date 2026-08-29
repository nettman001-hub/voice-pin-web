package com.voicecap.sms;

import android.content.Context;

import java.util.HashSet;
import java.util.Set;

public final class BusinessContactStore {
    private static final String KEY = "business_contact_numbers";

    private BusinessContactStore() { }

    public static String normalize(String phoneNumber) {
        if (phoneNumber == null) return "";
        String digits = phoneNumber.replaceAll("[^0-9+]", "");
        if (digits.startsWith("+82")) digits = "0" + digits.substring(3);
        else if (digits.startsWith("82") && digits.length() >= 11) digits = "0" + digits.substring(2);
        return digits.replaceAll("[^0-9]", "");
    }

    public static void register(Context context, String phoneNumber) {
        String normalized = normalize(phoneNumber);
        if (normalized.isEmpty()) return;
        Set<String> numbers = new HashSet<>(BridgePreferences.get(context).getStringSet(KEY, new HashSet<>()));
        if (numbers.add(normalized)) BridgePreferences.get(context).edit().putStringSet(KEY, numbers).apply();
    }

    public static boolean contains(Context context, String phoneNumber) {
        String normalized = normalize(phoneNumber);
        return !normalized.isEmpty() && BridgePreferences.get(context).getStringSet(KEY, new HashSet<>()).contains(normalized);
    }
}
