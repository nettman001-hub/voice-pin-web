package com.voicecap.sms;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 문자 탭 ⚙ 설정 화면. 기존 문자연동 탭({@link SmsBridgeView}: 휴대폰 연결·전송 동의·기본 문자앱·권한)을
 * 그대로 옮겼다. 동의 → 기본 문자앱 → 권한 순서의 설정 흐름도 MainActivity에서 옮겨 왔다.
 */
public final class SettingsActivity extends Activity {
    private static final int PERMISSION_REQUEST = 901;
    private static final int ROLE_REQUEST = 902;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 904;

    private SmsBridgeView smsBridgeView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Ui.SLATE_50);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.SLATE_50);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.WHITE);
        bar.setElevation(Ui.dp(this, 3));
        bar.setPadding(Ui.dp(this, 4), Ui.dp(this, 4), Ui.dp(this, 16), Ui.dp(this, 4));
        TextView back = new TextView(this);
        back.setText("←");
        back.setTextSize(22);
        back.setTextColor(Ui.SLATE_900);
        back.setGravity(Gravity.CENTER);
        back.setContentDescription("뒤로");
        back.setOnClickListener(v -> finish());
        bar.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 48), Ui.dp(this, 48)));
        bar.addView(Ui.title(this, "문자 연동 설정", 18));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        smsBridgeView = new SmsBridgeView(this);
        root.addView(smsBridgeView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        Ui.applySystemBarInsets(root);
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        smsBridgeView.updateSetupStatus();
    }

    public void beginProtectedSetup() {
        if (!BridgePreferences.configured(this)) {
            smsBridgeView.setStatus("먼저 웹앱에서 만든 기기 연결 코드로 이 휴대폰을 연결해 주세요.", SmsBridgeView.TONE_WARNING);
            return;
        }
        if (BridgePreferences.hasDataTransferConsent(this)) {
            requestSmsRole();
            return;
        }
        showDataUseNotice(true);
    }

    public void showDataUseNotice(boolean continueSetup) {
        AlertDialog.Builder dialog = new AlertDialog.Builder(this)
            .setTitle(R.string.data_transfer_title)
            .setMessage(R.string.data_transfer_disclosure)
            .setCancelable(!continueSetup);
        if (continueSetup) {
            dialog.setNegativeButton(R.string.data_transfer_decline, (ignored, which) -> smsBridgeView.setStatus(R.string.status_consent_declined, SmsBridgeView.TONE_WARNING));
            dialog.setPositiveButton(R.string.data_transfer_accept, (ignored, which) -> {
                BridgePreferences.get(this).edit().putBoolean(BridgePreferences.DATA_TRANSFER_CONSENT, true).apply();
                requestSmsRole();
            });
        } else {
            dialog.setPositiveButton(android.R.string.ok, null);
        }
        dialog.show();
    }

    /** 기본 문자앱을 바꾸면 삼성 메시지 채팅+(RCS)가 꺼진다는 안내. */
    public void showRcsNotice() {
        new AlertDialog.Builder(this)
            .setTitle(R.string.rcs_notice_title)
            .setMessage(R.string.rcs_notice_body)
            .setPositiveButton(android.R.string.ok, null)
            .show();
    }

    private void requestSmsRole() {
        if (SmsRoleUtils.isDefaultSmsApp(this)) {
            requestSmsPermissions();
            return;
        }
        Intent intent = SmsRoleUtils.roleRequestIntent(this);
        if (intent == null) smsBridgeView.setStatus(R.string.status_role_unavailable, SmsBridgeView.TONE_ERROR);
        else startActivityForResult(intent, ROLE_REQUEST);
    }

    private void requestSmsPermissions() {
        if (!BridgePreferences.hasDataTransferConsent(this) || !SmsRoleUtils.isDefaultSmsApp(this)) {
            smsBridgeView.setStatus(R.string.status_setup_required, SmsBridgeView.TONE_WARNING);
            return;
        }
        if (SmsRoleUtils.hasSmsPermissions(this)) {
            smsBridgeView.setStatus(R.string.status_setup_complete, SmsBridgeView.TONE_SUCCESS);
            SyncScheduler.scheduleNow(getApplicationContext());
            // 문자 권한이 이미 있어도 알림 권한은 따로 확인한다.
            requestNotificationPermission();
            return;
        }
        List<String> wanted = new ArrayList<>(Arrays.asList(SmsRoleUtils.SMS_PERMISSIONS));
        // 기본 문자앱은 새 문자 알림을 직접 띄워야 한다 (Android 13+ 알림 권한).
        if (SmsRoleUtils.needsNotificationPermission(this)) wanted.add(Manifest.permission.POST_NOTIFICATIONS);
        requestPermissions(wanted.toArray(new String[0]), PERMISSION_REQUEST);
    }

    /** Android 13+: 새 문자 알림 권한을 SMS 권한과 별개로 확인·요청한다. */
    private void requestNotificationPermission() {
        if (SmsRoleUtils.needsNotificationPermission(this)) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != ROLE_REQUEST) return;
        if (SmsRoleUtils.isDefaultSmsApp(this)) requestSmsPermissions();
        else smsBridgeView.setStatus(R.string.status_role_cancelled, SmsBridgeView.TONE_WARNING);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            if (SmsRoleUtils.needsNotificationPermission(this)) smsBridgeView.setStatus("알림 권한이 없으면 새 문자 알림이 표시되지 않습니다.", SmsBridgeView.TONE_WARNING);
            return;
        }
        if (requestCode != PERMISSION_REQUEST) return;
        if (SmsRoleUtils.hasSmsPermissions(this)) {
            smsBridgeView.setStatus(R.string.status_sync_ready, SmsBridgeView.TONE_SUCCESS);
            SyncScheduler.scheduleNow(getApplicationContext());
        } else {
            smsBridgeView.setStatus("문자 권한이 모두 허용되지 않아 연동을 시작할 수 없습니다.", SmsBridgeView.TONE_ERROR);
        }
    }
}
