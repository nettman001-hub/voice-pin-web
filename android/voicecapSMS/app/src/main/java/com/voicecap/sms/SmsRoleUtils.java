package com.voicecap.sms;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Telephony;

public final class SmsRoleUtils {
    public static final String[] SMS_PERMISSIONS = {
            Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_MMS, Manifest.permission.RECEIVE_WAP_PUSH};

    private SmsRoleUtils() { }

    public static boolean isDefaultSmsApp(Context context) {
        String defaultPackage = Telephony.Sms.getDefaultSmsPackage(context);
        return context.getPackageName().equals(defaultPackage);
    }

    public static boolean hasSmsPermissions(Context context) {
        for (String permission : SMS_PERMISSIONS) {
            if (context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    /** Android 13+에서 새 문자 알림 권한이 아직 없으면 true. */
    public static boolean needsNotificationPermission(Context context) {
        return Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
    }

    /** 기본 문자앱 지정 화면을 여는 인텐트. 이 기기에서 SMS 역할을 쓸 수 없으면 null. */
    public static Intent roleRequestIntent(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager manager = activity.getSystemService(RoleManager.class);
            if (manager == null || !manager.isRoleAvailable(RoleManager.ROLE_SMS)) return null;
            return manager.createRequestRoleIntent(RoleManager.ROLE_SMS);
        }
        Intent intent = new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT);
        intent.putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, activity.getPackageName());
        return intent;
    }
}
