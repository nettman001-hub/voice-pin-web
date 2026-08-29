package com.voicecap.sms;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.provider.Telephony;

public final class SmsRoleUtils {
    private SmsRoleUtils() { }

    public static boolean isDefaultSmsApp(Context context) {
        String defaultPackage = Telephony.Sms.getDefaultSmsPackage(context);
        return context.getPackageName().equals(defaultPackage);
    }

    public static boolean hasSmsPermissions(Context context) {
        return context.checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
                && context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
                && context.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
                && context.checkSelfPermission(Manifest.permission.RECEIVE_MMS) == PackageManager.PERMISSION_GRANTED
                && context.checkSelfPermission(Manifest.permission.RECEIVE_WAP_PUSH) == PackageManager.PERMISSION_GRANTED;
    }
}
